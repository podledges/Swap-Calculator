"""
app.py
The main Flask REST API and web server.
Acts as the bridge connecting the frontend UI (HTML/JS) to the backend quant engine.
It serves static web assets and handles the /api/calculate endpoints for curve generation and portfolio pricing.
"""
import os
import sys
import datetime
import numpy as np
import traceback
from flask import Flask, request, jsonify, send_from_directory
from data.market_data import AssetPriceOracle # Pointing to your specific data folder
from quant.swap_legs import InterestRateLeg, AssetReturnLeg


# Ensure that the 'src' directory (or current directory) is in the python path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from dateutil.relativedelta import relativedelta
from quant.futures_curve_builder import FuturesCurveBuilder
from quant.treasury_curve_builder import TreasuryCurveBuilder
from quant.cubic_spline import CubicSplineCurve
from quant.day_counter import calculate_year_fraction
from quant.swap_pricer import SwapPricer
from quant.cashflow_engine import CashflowEngine
from quant.swap_legs import InterestRateLeg
from quant.currency_swap_pricer import CurrencySwapPricer

app = Flask(__name__, static_folder='web', static_url_path='')

def resolve_liquidity_overlaps(market_data_records, curve_type, trade_date, day_count_convention, config):
    """
    Scans the market data records for instruments that have overlapping maturity dates.
    If an overlap is found (i.e. maturity difference < 0.05 years), it selects the one
    with the higher liquidity (lower Spread in bps).
    Sets 'skipped' and 'skipped_reason' on the rejected records.
    """
    # Create helper instance just to use tenor parsing
    if curve_type == 'Treasury':
        builder = TreasuryCurveBuilder([], config)
    else:
        builder = FuturesCurveBuilder([], config)
        
    records_with_t = []
    for idx, rec in enumerate(market_data_records):
        inst = rec['Instrument']
        tenor = rec['Tenor']
        
        try:
            if curve_type == 'Treasury':
                mat_date = builder._tenor_to_date(tenor)
            else:
                if inst in ['Cash', 'Swap']:
                    mat_date = builder._tenor_to_date(tenor)
                else: # Future
                    _, mat_date = builder._parse_imm_future(tenor)
            
            t = calculate_year_fraction(trade_date, mat_date, day_count_convention)
            
            # Read spread or default to 9999.0 (highest illiquidity)
            spread_val = rec.get('Spread')
            spread = float(spread_val) if spread_val is not None else 9999.0
            
            records_with_t.append({
                'index': idx,
                'record': rec,
                't': t,
                'spread': spread
            })
        except Exception:
            # If date parsing fails, skip overlap check for this record (it will fail in standard build validation anyway)
            continue
            
    # Sort records by maturity time
    records_with_t.sort(key=lambda x: x['t'])
    
    # Flag to skip overlaps
    skipped_indices = {}
    overlap_threshold = 0.05 # ~18 days window for maturity overlap
    
    i = 0
    while i < len(records_with_t):
        j = i + 1
        overlaps = [records_with_t[i]]
        
        # Collect all records that overlap with the current one within the threshold
        while j < len(records_with_t) and (records_with_t[j]['t'] - records_with_t[i]['t']) < overlap_threshold:
            overlaps.append(records_with_t[j])
            j += 1
            
        if len(overlaps) > 1:
            # Sort overlaps by spread (lowest spread first = most liquid)
            overlaps.sort(key=lambda x: x['spread'])
            winner = overlaps[0]
            
            # Reject all others
            for loser in overlaps[1:]:
                loser_inst = loser['record']['Instrument']
                loser_tenor = loser['record']['Tenor']
                winner_inst = winner['record']['Instrument']
                winner_tenor = winner['record']['Tenor']
                
                skipped_indices[loser['index']] = (
                    f"Skipped (Overlap with {winner_inst} {winner_tenor}; "
                    f"spread {loser['spread']} bps > {winner['spread']} bps)"
                )
            i = j
        else:
            i += 1
            
    # Apply results back to the original records list
    for idx, rec in enumerate(market_data_records):
        if idx in skipped_indices:
            rec['skipped'] = True
            rec['skipped_reason'] = skipped_indices[idx]
        else:
            rec['skipped'] = False
            rec['skipped_reason'] = None
            
    return market_data_records


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/calculate', methods=['POST'])
def calculate():
    try:
        req_data = request.get_json() or {}
        
        # 1. Parse configuration
        config_data = req_data.get('config', {})
        curve_type = config_data.get('curve_type', 'OIS') # 'OIS' or 'Treasury'
        trade_date_str = config_data.get('trade_date', '28-05-2026')
        day_count_convention = config_data.get('day_count_convention', 'ACT/365')
        payment_frequency = int(config_data.get('payment_frequency', 2))
        interpolation_method = config_data.get('interpolation_method', 'Cubic Spline')
        futures_cutoff_years = float(config_data.get('futures_cutoff_years', 2.0))
        
        # Parse trade date to datetime.date
        try:
            trade_date = datetime.datetime.strptime(trade_date_str, "%d-%m-%Y").date()
        except ValueError:
            return jsonify({
                'success': False,
                'error': f"Invalid Trade Date format: '{trade_date_str}'. Expected DD-MM-YYYY."
            }), 400
            
        # Clean config dictionary
        config = {
            'trade_date': trade_date_str,
            'day_count_convention': day_count_convention,
            'payment_frequency': payment_frequency,
            'interpolation_method': interpolation_method,
            'futures_cutoff_years': futures_cutoff_years
        }
        
        # 2. Parse and validate market data
        market_data_raw = req_data.get('market_data', [])
        if not market_data_raw:
            return jsonify({
                'success': False,
                'error': 'Market data is empty. Please load or add at least one instrument.'
            }), 400
            
        market_data_records = []
        for idx, row in enumerate(market_data_raw):
            inst = row.get('Instrument', '').strip().capitalize()
            tenor = row.get('Tenor', '').strip().upper()
            
            # Parse Spread optionally
            spread_val = row.get('Spread')
            spread = None
            if spread_val is not None and str(spread_val).strip() != '':
                try:
                    spread = float(spread_val)
                except ValueError:
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1} ({tenor}): Spread must be a valid number. Got '{spread_val}'"
                    }), 400
            
            if curve_type == 'Treasury':
                # Treasury curve validation
                if not inst or inst not in ['Bill', 'Note', 'Bond']:
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1}: Instrument must be 'Bill', 'Note', or 'Bond' for Treasury Curve. Got '{inst}'"
                    }), 400
                    
                if not tenor:
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1}: Tenor must be specified (e.g., '3M', '2Y', '10Y')."
                    }), 400
                    
                price_val = row.get('Price')
                try:
                    price = float(price_val)
                except (ValueError, TypeError):
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1} ({tenor}): Price must be a valid number. Got '{price_val}'"
                    }), 400
                    
                coupon_val = row.get('Coupon', 0.0)
                if coupon_val == '' or coupon_val is None:
                    coupon = 0.0
                else:
                    try:
                        coupon = float(coupon_val)
                    except ValueError:
                        return jsonify({
                            'success': False,
                            'error': f"Row {idx + 1} ({tenor}): Coupon must be a valid number. Got '{coupon_val}'"
                        }), 400
                        
                market_data_records.append({
                    'Instrument': inst,
                    'Tenor': tenor,
                    'Coupon': coupon,
                    'Price': price,
                    'Spread': spread
                })
            else:
                # OIS curve validation
                if not inst or inst not in ['Cash', 'Future', 'Swap']:
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1}: Instrument must be 'Cash', 'Future', or 'Swap' for OIS Curve. Got '{inst}'"
                    }), 400
                    
                if not tenor:
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1}: Tenor must be specified (e.g., 'O/N', '1M', 'SR3M6')."
                    }), 400
                    
                quote_type = row.get('QuoteType', '').strip().upper()
                if not quote_type or quote_type not in ['RATE', 'PRICE']:
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1}: QuoteType must be 'RATE' or 'PRICE'."
                    }), 400
                    
                quote_val = row.get('Quote')
                try:
                    quote = float(quote_val)
                except (ValueError, TypeError):
                    return jsonify({
                        'success': False,
                        'error': f"Row {idx + 1} ({tenor}): Quote value must be a valid number. Got '{quote_val}'"
                    }), 400
                    
                market_data_records.append({
                    'Instrument': inst,
                    'Tenor': tenor,
                    'QuoteType': quote_type,
                    'Quote': quote,
                    'Spread': spread
                })

        # 3. Resolve maturity overlaps using the Liquidity Auto-Selector
        market_data_records = resolve_liquidity_overlaps(
            market_data_records=market_data_records,
            curve_type=curve_type,
            trade_date=trade_date,
            day_count_convention=day_count_convention,
            config=config
        )
        
        # Filter active instruments for builders
        active_records = [r for r in market_data_records if not r.get('skipped', False)]
        if not active_records:
            return jsonify({
                'success': False,
                'error': 'All loaded instruments were flagged as skipped by the liquidity overlap filter.'
            }), 400

        # 4. Build interest rate curve
        if curve_type == 'Treasury':
            builder = TreasuryCurveBuilder(market_data=active_records, config=config)
        else:
            builder = FuturesCurveBuilder(market_data=active_records, config=config)
            
        discount_factors = builder.build_curve()
        
        # --- MULTI-SWAP PORTFOLIO PRICING LOGIC ---
        portfolio_data = req_data.get('portfolio', [])

        print("RAW PORTFOLIO PAYLOAD:", portfolio_data)

        if isinstance(portfolio_data, dict):
            portfolio_data = [portfolio_data]
        if not isinstance(portfolio_data, list):
            portfolio_data = []

        portfolio_results = None
        
        # NEW: We need a dedicated list to hold the formatted tuples for the CashflowEngine
        portfolio_tuples_for_engine = []

        if portfolio_data:
            pricer = SwapPricer(builder)

            total_base_npv = 0.0
            total_bumped_npv = 0.0
            priced_count = 0 

            for idx, pos in enumerate(portfolio_data):
                try:
                    notional = float(pos.get('notional', 0) or 0)
                    fixed_rate = float(pos.get('fixed_rate', 0) or 0) / 100.0
                    tenor_years = int(float(pos.get('tenor_years', 0) or 0))
                    position = str(pos.get('position', 'payer')).strip().lower()
                except (ValueError, TypeError) as conv_err:
                    print(f"Portfolio row {idx + 1}: skipped (bad values) -> {conv_err}")
                    continue

                if notional <= 0 or tenor_years <= 0:
                    continue

                is_payer = (position == 'payer')
                maturity_date = builder.trade_date + datetime.timedelta(days=tenor_years * 365)

                # 1. BUILD THE SWAP LEG OBJECTS
                fixed_leg = InterestRateLeg(
                    notional=notional, 
                    rate_type='fixed', 
                    frequency=payment_frequency, 
                    fixed_rate=fixed_rate
                )
                
                float_leg = InterestRateLeg(
                    notional=notional, 
                    rate_type='float', 
                    frequency=payment_frequency
                )

                # 2. ASSIGN PAYING/RECEIVING BASED ON POSITION
                if is_payer:
                    paying_leg = fixed_leg
                    receiving_leg = float_leg
                else:
                    paying_leg = float_leg
                    receiving_leg = fixed_leg

                # 3. PREP DATA FOR CASHFLOW ENGINE
                # The engine expects tuples of: (SwapLeg, tenor_years, is_payer)
                # We package the fixed leg here, as it drives the primary cashflow schedule
                portfolio_tuples_for_engine.append((fixed_leg, tenor_years, is_payer))

                # 4. PRICE THE SWAP
                try:
                    # Pass the OBJECTS to the pricer, not the raw numbers
                    results = pricer.calculate_dv01(paying_leg, receiving_leg, maturity_date)
                except Exception as price_err:
                    print(f"Portfolio row {idx + 1}: pricing failed -> {price_err}")
                    continue

                total_base_npv += float(results['base_npv'])
                total_bumped_npv += float(results['bumped_npv'])
                priced_count += 1

            net_pvbp = abs(total_bumped_npv - total_base_npv)

            if priced_count > 0:
                portfolio_results = {
                    "base_npv": round(total_base_npv, 2),
                    "bumped_npv": round(total_bumped_npv, 2),
                    "pvbp": round(net_pvbp, 2),
                    "positions_priced": priced_count
                }

        print("COMPUTED PORTFOLIO RESULTS:", portfolio_results)

        # --- PORTFOLIO CASHFLOW TIMESERIES ---
        cashflow_timeseries = []
        try:
            engine = CashflowEngine(builder)
            # Pass our nicely formatted list of tuples to the engine, NOT the raw JSON
            cashflow_timeseries = engine.generate_portfolio_cashflows(portfolio_tuples_for_engine)
        except Exception as cf_err:
            print(f"Cashflow engine failed: {cf_err}")
            cashflow_timeseries = []
        # 5. Generate results knots for output display (evaluating both active & skipped)
        knots = []
        for item in market_data_records:
            inst = item['Instrument']
            tenor = item['Tenor']
            skipped = item.get('skipped', False)
            skipped_reason = item.get('skipped_reason')
            
            try:
                if curve_type == 'Treasury':
                    mat_date = builder._tenor_to_date(tenor)
                else:
                    if inst in ['Cash', 'Swap']:
                        mat_date = builder._tenor_to_date(tenor)
                    else: # Future
                        _, mat_date = builder._parse_imm_future(tenor)
                        
                t = calculate_year_fraction(builder.trade_date, mat_date, builder.convention)
                df = builder._get_discount_factor(t)
                zero_rate = 0.0 if t == 0 else (-np.log(df) / t) * 100.0
                
                # Check OIS cutoff rules on active nodes
                if curve_type == 'OIS' and not skipped:
                    if inst == 'Future' and t > builder.futures_cutoff_years + 0.1:
                        skipped = True
                        skipped_reason = f"Skipped (Future beyond {builder.futures_cutoff_years}Y cutoff)"
                    elif inst == 'Swap' and t <= builder.futures_cutoff_years + 0.1:
                        skipped = True
                        skipped_reason = f"Skipped (Swap overlaps with futures within {builder.futures_cutoff_years}Y cutoff)"
                
                knot_info = {
                    'instrument': inst,
                    'tenor': tenor,
                    'maturity_date': mat_date.strftime('%Y-%m-%d'),
                    't': round(t, 6),
                    'df': round(df, 6),
                    'zero_rate': round(zero_rate, 4),
                    'skipped': skipped,
                    'skipped_reason': skipped_reason
                }
                
                if curve_type == 'Treasury':
                    knot_info['price'] = item['Price']
                    knot_info['coupon'] = item['Coupon']
                else:
                    knot_info['quote_type'] = item['QuoteType']
                    knot_info['quote'] = item['Quote']
                    
                if item.get('Spread') is not None:
                    knot_info['spread'] = item['Spread']
                    
                knots.append(knot_info)
            except Exception as e:
                knot_err = {
                    'instrument': inst,
                    'tenor': tenor,
                    'error': str(e)
                }
                if curve_type == 'Treasury':
                    knot_err['price'] = item['Price']
                    knot_err['coupon'] = item['Coupon']
                else:
                    knot_err['quote_type'] = item['QuoteType']
                    knot_err['quote'] = item['Quote']
                knots.append(knot_err)

        # Sort knots by year fraction
        knots.sort(key=lambda x: x.get('t', 9999.0))
        
        # 6. Interpolate smooth curve points for visualization
        valid_knots = [k for k in knots if 'error' not in k and not k.get('skipped', False) and k.get('t', 0.0) > 0]
        if len(valid_knots) < 1:
            return jsonify({
                'success': False,
                'error': 'No active instruments remaining after applying filters and cutoff rules.'
            }), 400
            
        times = np.array([k['t'] for k in valid_knots])
        dfs = np.array([k['df'] for k in valid_knots])
        rates = np.array([k['zero_rate'] for k in valid_knots])
        
        min_time = float(times.min())
        max_time = float(times.max())
        
        if min_time <= 0:
            min_time = 0.0001
            
        times_smooth = np.linspace(min_time, max_time, 200)
        
        zero_rates_smooth = []
        dfs_smooth = []
        
        if interpolation_method == 'Cubic Spline' and len(times) >= 3:
            try:
                zero_spline = CubicSplineCurve(times, rates)
                zero_rates_smooth = zero_spline.evaluate(times_smooth).tolist()
                
                df_spline = CubicSplineCurve(times, dfs)
                dfs_smooth = df_spline.evaluate(times_smooth).tolist()
            except Exception as spline_err:
                interpolation_method = 'Linear (Fallback)'
                zero_rates_smooth = np.interp(times_smooth, times, rates).tolist()
                dfs_smooth = np.interp(times_smooth, times, dfs).tolist()
        else:
            zero_rates_smooth = np.interp(times_smooth, times, rates).tolist()
            dfs_smooth = np.interp(times_smooth, times, dfs).tolist()
            
        # --- CALCULATE IMPLIED FORWARD RATES ---
        # 1. Smooth forward rate curve for the chart: f(t) = - (ln(df(t+eps)) - ln(df(t))) / eps
        epsilon = 0.005
        times_smooth_plus = times_smooth + epsilon
        
        if interpolation_method == 'Cubic Spline' and len(times) >= 3:
            try:
                dfs_smooth_plus = df_spline.evaluate(times_smooth_plus)
            except Exception:
                dfs_smooth_plus = np.interp(times_smooth_plus, times, dfs)
        else:
            dfs_smooth_plus = np.interp(times_smooth_plus, times, dfs)
            
        forward_rates_smooth = []
        for i in range(len(times_smooth)):
            df_t = dfs_smooth[i]
            df_t_plus = dfs_smooth_plus[i]
            if df_t > 0 and df_t_plus > 0:
                f_rate = -(np.log(df_t_plus) - np.log(df_t)) / epsilon
            else:
                f_rate = 0.0
            forward_rates_smooth.append(round(float(f_rate) * 100.0, 4))
            
        # 2. Implied simple forward rates table between consecutive active knots
        forward_rates_table = []
        active_knots = sorted([k for k in knots if 'error' not in k and not k.get('skipped', False)], key=lambda x: x['t'])
        
        prev_t = 0.0
        prev_df = 1.0
        prev_date_str = trade_date.strftime('%Y-%m-%d')
        prev_tenor = 'Spot'
        
        for knot in active_knots:
            t_curr = knot['t']
            df_curr = knot['df']
            tenor_curr = knot['tenor']
            date_curr_str = knot['maturity_date']
            
            if t_curr > prev_t:
                dt = t_curr - prev_t
                if df_curr > 0:
                    f_rate = (prev_df / df_curr - 1.0) / dt
                else:
                    f_rate = 0.0
                    
                forward_rates_table.append({
                    'period': f"{prev_tenor} to {tenor_curr}",
                    'start_tenor': prev_tenor,
                    'end_tenor': tenor_curr,
                    'start_date': prev_date_str,
                    'end_date': date_curr_str,
                    'dt': round(dt, 4),
                    'forward_rate': round(float(f_rate) * 100.0, 4)
                })
                
            prev_t = t_curr
            prev_df = df_curr
            prev_date_str = date_curr_str
            prev_tenor = tenor_curr

        return jsonify({
            'success': True,
            'config': config,
            'knots': knots,
            'portfolio_results': portfolio_results,
            'cashflows': cashflow_timeseries,
            'forward_rates_table': forward_rates_table,
            'curves': {
                'times': times_smooth.tolist(),
                'zero_rates': zero_rates_smooth,
                'discount_factors': dfs_smooth,
                'forward_rates': forward_rates_smooth,
                'method': interpolation_method
            }
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f"Curve building error: {str(e)}"
        }), 500

# --- CROSS-CURRENCY SWAP PRICER EXTENSION ENDPOINTS & HELPERS ---

USD_FALLBACK_MARKET_DATA = [
    { 'Instrument': 'Cash', 'Tenor': 'O/N', 'QuoteType': 'RATE', 'Quote': 3.550, 'Spread': 1.0 },
    { 'Instrument': 'Cash', 'Tenor': '1M', 'QuoteType': 'RATE', 'Quote': 3.608, 'Spread': 1.2 },
    { 'Instrument': 'Cash', 'Tenor': '3M', 'QuoteType': 'RATE', 'Quote': 3.649, 'Spread': 1.5 },
    { 'Instrument': 'Future', 'Tenor': 'SR3M6', 'QuoteType': 'PRICE', 'Quote': 96.330, 'Spread': 0.5 },
    { 'Instrument': 'Future', 'Tenor': 'SR3U6', 'QuoteType': 'PRICE', 'Quote': 96.250, 'Spread': 0.6 },
    { 'Instrument': 'Future', 'Tenor': 'SR3Z6', 'QuoteType': 'PRICE', 'Quote': 96.155, 'Spread': 0.5 },
    { 'Instrument': 'Future', 'Tenor': 'SR3H7', 'QuoteType': 'PRICE', 'Quote': 96.080, 'Spread': 0.8 },
    { 'Instrument': 'Future', 'Tenor': 'SR3M7', 'QuoteType': 'PRICE', 'Quote': 96.065, 'Spread': 0.7 },
    { 'Instrument': 'Future', 'Tenor': 'SR3U7', 'QuoteType': 'PRICE', 'Quote': 96.095, 'Spread': 0.9 },
    { 'Instrument': 'Future', 'Tenor': 'SR3Z7', 'QuoteType': 'PRICE', 'Quote': 96.140, 'Spread': 0.8 },
    { 'Instrument': 'Future', 'Tenor': 'SR3H8', 'QuoteType': 'PRICE', 'Quote': 96.170, 'Spread': 1.1 },
    { 'Instrument': 'Future', 'Tenor': 'SR3M8', 'QuoteType': 'PRICE', 'Quote': 96.180, 'Spread': 1.0 },
    { 'Instrument': 'Swap', 'Tenor': '1Y', 'QuoteType': 'RATE', 'Quote': 3.849, 'Spread': 2.0 },
    { 'Instrument': 'Swap', 'Tenor': '2Y', 'QuoteType': 'RATE', 'Quote': 3.899, 'Spread': 2.2 },
    { 'Instrument': 'Swap', 'Tenor': '3Y', 'QuoteType': 'RATE', 'Quote': 3.889, 'Spread': 2.5 },
    { 'Instrument': 'Swap', 'Tenor': '5Y', 'QuoteType': 'RATE', 'Quote': 3.906, 'Spread': 2.8 },
    { 'Instrument': 'Swap', 'Tenor': '7Y', 'QuoteType': 'RATE', 'Quote': 3.975, 'Spread': 3.2 },
    { 'Instrument': 'Swap', 'Tenor': '10Y', 'QuoteType': 'RATE', 'Quote': 4.089, 'Spread': 3.5 },
    { 'Instrument': 'Swap', 'Tenor': '15Y', 'QuoteType': 'RATE', 'Quote': 4.264, 'Spread': 4.0 },
    { 'Instrument': 'Swap', 'Tenor': '30Y', 'QuoteType': 'RATE', 'Quote': 4.308, 'Spread': 5.0 }
]

EUR_FALLBACK_MARKET_DATA = [
    { 'Instrument': 'Cash', 'Tenor': 'O/N', 'QuoteType': 'RATE', 'Quote': 2.250, 'Spread': 1.0 },
    { 'Instrument': 'Cash', 'Tenor': '1M', 'QuoteType': 'RATE', 'Quote': 2.300, 'Spread': 1.2 },
    { 'Instrument': 'Cash', 'Tenor': '3M', 'QuoteType': 'RATE', 'Quote': 2.350, 'Spread': 1.5 },
    { 'Instrument': 'Future', 'Tenor': 'SR3M6', 'QuoteType': 'PRICE', 'Quote': 97.650, 'Spread': 0.5 },
    { 'Instrument': 'Future', 'Tenor': 'SR3U6', 'QuoteType': 'PRICE', 'Quote': 97.600, 'Spread': 0.6 },
    { 'Instrument': 'Future', 'Tenor': 'SR3Z6', 'QuoteType': 'PRICE', 'Quote': 97.550, 'Spread': 0.5 },
    { 'Instrument': 'Future', 'Tenor': 'SR3H7', 'QuoteType': 'PRICE', 'Quote': 97.500, 'Spread': 0.8 },
    { 'Instrument': 'Future', 'Tenor': 'SR3M7', 'QuoteType': 'PRICE', 'Quote': 97.450, 'Spread': 0.7 },
    { 'Instrument': 'Future', 'Tenor': 'SR3U7', 'QuoteType': 'PRICE', 'Quote': 97.400, 'Spread': 0.9 },
    { 'Instrument': 'Future', 'Tenor': 'SR3Z7', 'QuoteType': 'PRICE', 'Quote': 97.350, 'Spread': 0.8 },
    { 'Instrument': 'Future', 'Tenor': 'SR3H8', 'QuoteType': 'PRICE', 'Quote': 97.300, 'Spread': 1.1 },
    { 'Instrument': 'Future', 'Tenor': 'SR3M8', 'QuoteType': 'PRICE', 'Quote': 97.250, 'Spread': 1.0 },
    { 'Instrument': 'Swap', 'Tenor': '1Y', 'QuoteType': 'RATE', 'Quote': 2.800, 'Spread': 2.0 },
    { 'Instrument': 'Swap', 'Tenor': '2Y', 'QuoteType': 'RATE', 'Quote': 2.850, 'Spread': 2.2 },
    { 'Instrument': 'Swap', 'Tenor': '3Y', 'QuoteType': 'RATE', 'Quote': 2.900, 'Spread': 2.5 },
    { 'Instrument': 'Swap', 'Tenor': '5Y', 'QuoteType': 'RATE', 'Quote': 3.000, 'Spread': 2.8 },
    { 'Instrument': 'Swap', 'Tenor': '7Y', 'QuoteType': 'RATE', 'Quote': 3.050, 'Spread': 3.2 },
    { 'Instrument': 'Swap', 'Tenor': '10Y', 'QuoteType': 'RATE', 'Quote': 3.100, 'Spread': 3.5 },
    { 'Instrument': 'Swap', 'Tenor': '15Y', 'QuoteType': 'RATE', 'Quote': 3.150, 'Spread': 4.0 },
    { 'Instrument': 'Swap', 'Tenor': '30Y', 'QuoteType': 'RATE', 'Quote': 3.200, 'Spread': 5.0 }
]

def _parse_and_validate_market_data(market_data_raw, curve_type):
    records = []
    for idx, row in enumerate(market_data_raw):
        inst = row.get('Instrument', '').strip().capitalize()
        tenor = row.get('Tenor', '').strip().upper()
        
        # Parse Spread optionally
        spread_val = row.get('Spread')
        spread = None
        if spread_val is not None and str(spread_val).strip() != '':
            try:
                spread = float(spread_val)
            except ValueError:
                return None, f"Row {idx + 1} ({tenor}): Spread must be a valid number. Got '{spread_val}'"
        
        if not inst or inst not in ['Cash', 'Future', 'Swap']:
            return None, f"Row {idx + 1}: Instrument must be 'Cash', 'Future', or 'Swap'. Got '{inst}'"
            
        if not tenor:
            return None, f"Row {idx + 1}: Tenor must be specified (e.g., 'O/N', '1M', 'SR3M6')."
            
        quote_type = row.get('QuoteType', '').strip().upper()
        if not quote_type or quote_type not in ['RATE', 'PRICE']:
            return None, f"Row {idx + 1}: QuoteType must be 'RATE' or 'PRICE'."
            
        quote_val = row.get('Quote')
        try:
            quote = float(quote_val)
        except (ValueError, TypeError):
            return None, f"Row {idx + 1} ({tenor}): Quote value must be a valid number. Got '{quote_val}'"
            
        records.append({
            'Instrument': inst,
            'Tenor': tenor,
            'QuoteType': quote_type,
            'Quote': quote,
            'Spread': spread
        })
    return records, None

def _generate_curve_knots(market_data_records, builder, config):
    knots = []
    for item in market_data_records:
        inst = item['Instrument']
        tenor = item['Tenor']
        skipped = item.get('skipped', False)
        skipped_reason = item.get('skipped_reason')
        
        try:
            if inst in ['Cash', 'Swap']:
                mat_date = builder._tenor_to_date(tenor)
            else: # Future
                _, mat_date = builder._parse_imm_future(tenor)
                
            t = calculate_year_fraction(builder.trade_date, mat_date, builder.convention)
            df = builder._get_discount_factor(t)
            zero_rate = 0.0 if t == 0 else (-np.log(df) / t) * 100.0
            
            # Check OIS cutoff rules on active nodes
            if inst == 'Future' and t > builder.futures_cutoff_years + 0.1:
                skipped = True
                skipped_reason = f"Skipped (Future beyond {builder.futures_cutoff_years}Y cutoff)"
            elif inst == 'Swap' and t <= builder.futures_cutoff_years + 0.1:
                skipped = True
                skipped_reason = f"Skipped (Swap overlaps with futures within {builder.futures_cutoff_years}Y cutoff)"
            
            knot_info = {
                'instrument': inst,
                'tenor': tenor,
                'maturity_date': mat_date.strftime('%Y-%m-%d'),
                't': round(t, 6),
                'df': round(df, 6),
                'zero_rate': round(zero_rate, 4),
                'skipped': skipped,
                'skipped_reason': skipped_reason,
                'quote_type': item['QuoteType'],
                'quote': item['Quote']
            }
            
            if item.get('Spread') is not None:
                knot_info['spread'] = item['Spread']
                
            knots.append(knot_info)
        except Exception as e:
            knot_err = {
                'instrument': inst,
                'tenor': tenor,
                'error': str(e),
                'quote_type': item['QuoteType'],
                'quote': item['Quote']
            }
            knots.append(knot_err)
            
    knots.sort(key=lambda x: x.get('t', 9999.0))
    return knots

def _generate_smooth_curve(knots, interpolation_method):
    valid_knots = [k for k in knots if 'error' not in k and not k.get('skipped', False) and k.get('t', 0.0) > 0]
    if len(valid_knots) < 1:
        return {'times': [], 'zero_rates': [], 'discount_factors': []}
        
    times = np.array([k['t'] for k in valid_knots])
    dfs = np.array([k['df'] for k in valid_knots])
    rates = np.array([k['zero_rate'] for k in valid_knots])
    
    min_time = float(times.min())
    max_time = float(times.max())
    
    if min_time <= 0:
        min_time = 0.0001
        
    times_smooth = np.linspace(min_time, max_time, 200)
    
    zero_rates_smooth = []
    dfs_smooth = []
    
    if interpolation_method == 'Cubic Spline' and len(times) >= 3:
        try:
            zero_spline = CubicSplineCurve(times, rates)
            zero_rates_smooth = zero_spline.evaluate(times_smooth).tolist()
            
            df_spline = CubicSplineCurve(times, dfs)
            dfs_smooth = df_spline.evaluate(times_smooth).tolist()
        except Exception:
            zero_rates_smooth = np.interp(times_smooth, times, rates).tolist()
            dfs_smooth = np.interp(times_smooth, times, dfs).tolist()
    else:
        zero_rates_smooth = np.interp(times_smooth, times, rates).tolist()
        dfs_smooth = np.interp(times_smooth, times, dfs).tolist()
        
    return {
        'times': times_smooth.tolist(),
        'zero_rates': zero_rates_smooth,
        'discount_factors': dfs_smooth,
        'method': interpolation_method
    }

@app.route('/api/calculate_currency_swap', methods=['POST'])
def calculate_currency_swap():
    try:
        req_data = request.get_json() or {}
        
        trade_date_str = req_data.get('trade_date', '28-05-2026')
        spot_fx_rate = float(req_data.get('spot_fx_rate', 1.08))
        
        leg1 = req_data.get('leg1', {})
        leg2 = req_data.get('leg2', {})
        
        leg1_market_raw = req_data.get('leg1_market_data', [])
        leg2_market_raw = req_data.get('leg2_market_data', [])
        
        curve_config1 = req_data.get('curve_config1', {})
        curve_config2 = req_data.get('curve_config2', {})
        
        # If empty, use fallbacks
        if not leg1_market_raw:
            leg1_market_raw = USD_FALLBACK_MARKET_DATA
        if not leg2_market_raw:
            leg2_market_raw = EUR_FALLBACK_MARKET_DATA
            
        # Parse trade date
        try:
            trade_date = datetime.datetime.strptime(trade_date_str, "%d-%m-%Y").date()
        except ValueError:
            return jsonify({
                'success': False,
                'error': f"Invalid Trade Date format: '{trade_date_str}'. Expected DD-MM-YYYY."
            }), 400
            
        # Parse market data for Leg 1
        leg1_records, err = _parse_and_validate_market_data(leg1_market_raw, 'OIS')
        if err:
            return jsonify({'success': False, 'error': f"Leg 1 Curve: {err}"}), 400
            
        # Parse market data for Leg 2
        leg2_records, err = _parse_and_validate_market_data(leg2_market_raw, 'OIS')
        if err:
            return jsonify({'success': False, 'error': f"Leg 2 Curve: {err}"}), 400
            
        # Resolve overlaps for both
        config1 = {
            'trade_date': trade_date_str,
            'day_count_convention': curve_config1.get('day_count_convention', 'ACT/365'),
            'payment_frequency': int(curve_config1.get('payment_frequency', 2)),
            'interpolation_method': curve_config1.get('interpolation_method', 'Cubic Spline'),
            'futures_cutoff_years': float(curve_config1.get('futures_cutoff_years', 2.0))
        }
        config2 = {
            'trade_date': trade_date_str,
            'day_count_convention': curve_config2.get('day_count_convention', 'ACT/365'),
            'payment_frequency': int(curve_config2.get('payment_frequency', 2)),
            'interpolation_method': curve_config2.get('interpolation_method', 'Cubic Spline'),
            'futures_cutoff_years': float(curve_config2.get('futures_cutoff_years', 2.0))
        }
        
        leg1_records = resolve_liquidity_overlaps(
            market_data_records=leg1_records,
            curve_type='OIS',
            trade_date=trade_date,
            day_count_convention=config1['day_count_convention'],
            config=config1
        )
        
        leg2_records = resolve_liquidity_overlaps(
            market_data_records=leg2_records,
            curve_type='OIS',
            trade_date=trade_date,
            day_count_convention=config2['day_count_convention'],
            config=config2
        )
        
        active_records1 = [r for r in leg1_records if not r.get('skipped', False)]
        active_records2 = [r for r in leg2_records if not r.get('skipped', False)]
        
        if not active_records1 or not active_records2:
            return jsonify({
                'success': False,
                'error': 'All loaded instruments were flagged as skipped by the liquidity overlap filter.'
            }), 400
            
        # Build curves
        builder1 = FuturesCurveBuilder(market_data=active_records1, config=config1)
        builder1.build_curve()
        
        builder2 = FuturesCurveBuilder(market_data=active_records2, config=config2)
        builder2.build_curve()
        
        # Determine swap maturity
        tenor_years = int(leg1.get('tenor_years', 5))
        maturity_date = trade_date + relativedelta(years=tenor_years)
        
        # Instantiate pricer and value swap
        pricer = CurrencySwapPricer(
            trade_date=trade_date,
            maturity_date=maturity_date,
            spot_fx_rate=spot_fx_rate,
            leg1_config=leg1,
            leg2_config=leg2,
            curve_builder1=builder1,
            curve_builder2=builder2
        )
        
        cashflows, npv_results = pricer.price_swap()
        
        # Generate knots outputs for visualization
        knots1 = _generate_curve_knots(leg1_records, builder1, config1)
        knots2 = _generate_curve_knots(leg2_records, builder2, config2)
        
        # Generate smooth curves
        smooth_curve1 = _generate_smooth_curve(knots1, config1['interpolation_method'])
        smooth_curve2 = _generate_smooth_curve(knots2, config2['interpolation_method'])
        
        # Generate FX Forward Curve at standard tenors
        std_tenors = ['O/N', '1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '15Y', '30Y']
        fx_forward_curve = []
        for tenor in std_tenors:
            try:
                # Convert tenor to date
                t_date = builder1._tenor_to_date(tenor)
                t1 = calculate_year_fraction(trade_date, t_date, config1['day_count_convention'])
                t2 = calculate_year_fraction(trade_date, t_date, config2['day_count_convention'])
                df1 = builder1._get_discount_factor(t1)
                df2 = builder2._get_discount_factor(t2)
                f_rate = spot_fx_rate * (df2 / df1) if df1 > 0 else spot_fx_rate
                fx_forward_curve.append({
                    'tenor': tenor,
                    't': round(t1, 4),
                    'forward_rate': round(f_rate, 6)
                })
            except Exception:
                continue
                
        return jsonify({
            'success': True,
            'leg1_knots': knots1,
            'leg2_knots': knots2,
            'leg1_curve': smooth_curve1,
            'leg2_curve': smooth_curve2,
            'fx_forward_curve': fx_forward_curve,
            'cashflows': cashflows,
            'npv_results': npv_results
        })
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f"Currency swap calculation error: {str(e)}"
        }), 500

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)