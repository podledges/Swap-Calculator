// src/web/cross_asset.js
// Standalone controller for the Cross-Asset Swap tab.
// Deliberately self-contained: it shares CSS classes with the Curve Builder
// but keeps its OWN in-memory state, so editing data here never affects
// the Curve Builder tab (and vice-versa). main.js is not loaded on this page.

// ---------- App State (isolated to this page) ----------
let marketQuotes = [];
let calculationResults = null;
let currentChartType = 'zero_rate';
let yieldChart = null;
let cashflowChart = null;

// ---------- DOM refs ----------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const marketTableBody = document.getElementById('market-table-body');
const marketTableHead = document.getElementById('market-table-head');
const outputTableHead = document.getElementById('output-table-head');
const outputTableBody = document.getElementById('output-table-body');
const addRowBtn = document.getElementById('add-row');
const clearTableBtn = document.getElementById('clear-table');
const calculateBtn = document.getElementById('calculate-btn');
const resultsContainer = document.getElementById('results-container');
const alertContainer = document.getElementById('alert-container');
const themeToggleBtn = document.getElementById('theme-toggle');
const downloadTemplateBtn = document.getElementById('download-template');
const loadSampleBtn = document.getElementById('load-sample');
const showZeroRateBtn = document.getElementById('show-zero-rate');
const showDfBtn = document.getElementById('show-df');
const curveTypeSelect = document.getElementById('curve-type');

// ============================================================
// FIX (Phase 1.3): derive the active nav link from the current URL
// instead of trusting a hardcoded class. This guarantees the highlight
// always matches the visible page, even if markup drifts.
// ============================================================
function syncActiveNav() {
    const here = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach(a => {
        const href = (a.getAttribute('href') || '').split('/').pop();
        a.classList.toggle('active', href === here);
    });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    syncActiveNav();
    updateTableHeaders();
    loadSampleData();

    // Present Date defaults to today (DD-MM-YYYY).
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const presentEl = document.getElementById('ca-present-date');
    if (presentEl && !presentEl.value) presentEl.value = `${dd}-${mm}-${yyyy}`;
});

// ---------- Theme ----------
themeToggleBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
    if (calculationResults) renderCharts();
});

function updateThemeIcon(theme) {
    const icon = themeToggleBtn.querySelector('i');
    icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

// ---------- Curve type ----------
if (curveTypeSelect) {
    curveTypeSelect.addEventListener('change', () => {
        updateTableHeaders();
        loadSampleData();
    });
}

function updateTableHeaders() {
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
    if (curveType === 'Treasury') {
        marketTableHead.innerHTML = `
            <tr>
                <th style="width: 25%">Instrument</th>
                <th style="width: 15%">Tenor</th>
                <th style="width: 20%">Coupon (%)</th>
                <th style="width: 20%">Price</th>
                <th style="width: 15%">Spread (bps)</th>
                <th style="width: 5%">Actions</th>
            </tr>`;
        outputTableHead.innerHTML = `
            <tr><th>Instrument</th><th>Tenor</th><th>Coupon</th><th>Price</th>
                <th>Maturity</th><th>t (Years)</th><th>Discount Factor</th><th>Zero Rate</th><th>Status</th></tr>`;
    } else {
        marketTableHead.innerHTML = `
            <tr>
                <th style="width: 20%">Instrument</th>
                <th style="width: 15%">Tenor</th>
                <th style="width: 25%">Quote Type</th>
                <th style="width: 20%">Quote</th>
                <th style="width: 15%">Spread (bps)</th>
                <th style="width: 5%">Actions</th>
            </tr>`;
        outputTableHead.innerHTML = `
            <tr><th>Instrument</th><th>Tenor</th><th>Quote Type</th><th>Quote</th>
                <th>Maturity</th><th>t (Years)</th><th>Discount Factor</th><th>Zero Rate</th><th>Status</th></tr>`;
    }
}

// ---------- Sample data (own copy) ----------
const sampleData = [
    { Instrument: 'Cash', Tenor: 'O/N', QuoteType: 'RATE', Quote: 3.550, Spread: 1.0 },
    { Instrument: 'Cash', Tenor: '1M', QuoteType: 'RATE', Quote: 3.608, Spread: 1.2 },
    { Instrument: 'Cash', Tenor: '3M', QuoteType: 'RATE', Quote: 3.649, Spread: 1.5 },
    { Instrument: 'Future', Tenor: 'SR3M6', QuoteType: 'PRICE', Quote: 96.330, Spread: 0.5 },
    { Instrument: 'Future', Tenor: 'SR3U6', QuoteType: 'PRICE', Quote: 96.250, Spread: 0.6 },
    { Instrument: 'Future', Tenor: 'SR3Z6', QuoteType: 'PRICE', Quote: 96.155, Spread: 0.5 },
    { Instrument: 'Swap', Tenor: '1Y', QuoteType: 'RATE', Quote: 3.849, Spread: 2.0 },
    { Instrument: 'Swap', Tenor: '2Y', QuoteType: 'RATE', Quote: 3.899, Spread: 2.2 },
    { Instrument: 'Swap', Tenor: '5Y', QuoteType: 'RATE', Quote: 3.906, Spread: 2.8 },
    { Instrument: 'Swap', Tenor: '10Y', QuoteType: 'RATE', Quote: 4.089, Spread: 3.5 },
];

const treasurySampleData = [
    { Instrument: 'Bill', Tenor: '3M', Coupon: 0.0, Price: 98.710, Spread: 1.2 },
    { Instrument: 'Bill', Tenor: '6M', Coupon: 0.0, Price: 97.450, Spread: 1.5 },
    { Instrument: 'Note', Tenor: '2Y', Coupon: 4.250, Price: 99.300, Spread: 1.8 },
    { Instrument: 'Note', Tenor: '5Y', Coupon: 4.000, Price: 98.500, Spread: 2.5 },
    { Instrument: 'Bond', Tenor: '10Y', Coupon: 4.250, Price: 100.250, Spread: 1.5 },
];

function loadSampleData() {
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
    marketQuotes = JSON.parse(JSON.stringify(curveType === 'Treasury' ? treasurySampleData : sampleData));
    renderTable();
    showAlert(`Sample ${curveType} market data loaded for this tab.`, 'success');
}
loadSampleBtn.addEventListener('click', loadSampleData);

// ---------- Template download ----------
downloadTemplateBtn.addEventListener('click', () => {
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
    const csv = curveType === 'Treasury'
        ? "Instrument,Tenor,Coupon,Price,Spread\nBill,3M,0,98.71,1.2\nNote,2Y,4.25,99.30,1.8\nBond,10Y,4.25,100.25,1.5"
        : "Instrument,Tenor,QuoteType,Quote,Spread\nCash,O/N,RATE,3.55,1.0\nFuture,SR3M6,PRICE,96.33,0.5\nSwap,5Y,RATE,3.906,2.8";
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `crossasset_${curveType.toLowerCase()}_template.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// ---------- Market table render ----------
function renderTable() {
    marketTableBody.innerHTML = '';
    if (marketQuotes.length === 0) {
        marketTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px;">
            No market quotes. Add a row, load sample, or drop a file.</td></tr>`;
        return;
    }
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';

    marketQuotes.forEach((q, idx) => {
        const tr = document.createElement('tr');
        if (curveType === 'Treasury') {
            tr.innerHTML = `
                <td><select class="row-instrument" data-index="${idx}">
                    <option value="Bill" ${q.Instrument === 'Bill' ? 'selected' : ''}>Bill</option>
                    <option value="Note" ${q.Instrument === 'Note' ? 'selected' : ''}>Note</option>
                    <option value="Bond" ${q.Instrument === 'Bond' ? 'selected' : ''}>Bond</option>
                </select></td>
                <td><input type="text" class="row-tenor" value="${q.Tenor || ''}" data-index="${idx}" placeholder="10Y"></td>
                <td><input type="number" class="row-coupon" value="${q.Coupon ?? 0.0}" step="0.001" data-index="${idx}"></td>
                <td><input type="number" class="row-price" value="${q.Price ?? 100.0}" step="0.001" data-index="${idx}"></td>
                <td><input type="number" class="row-spread" value="${q.Spread ?? ''}" step="0.1" data-index="${idx}" placeholder="bps"></td>
                <td style="text-align:center;"><button class="btn btn-danger btn-sm del-row" data-index="${idx}"><i class="fa-solid fa-trash-can"></i></button></td>`;
        } else {
            tr.innerHTML = `
                <td><select class="row-instrument" data-index="${idx}">
                    <option value="Cash" ${q.Instrument === 'Cash' ? 'selected' : ''}>Cash</option>
                    <option value="Future" ${q.Instrument === 'Future' ? 'selected' : ''}>Future</option>
                    <option value="Swap" ${q.Instrument === 'Swap' ? 'selected' : ''}>Swap</option>
                </select></td>
                <td><input type="text" class="row-tenor" value="${q.Tenor || ''}" data-index="${idx}" placeholder="3M"></td>
                <td><select class="row-quotetype" data-index="${idx}">
                    <option value="RATE" ${q.QuoteType === 'RATE' ? 'selected' : ''}>RATE (yield %)</option>
                    <option value="PRICE" ${q.QuoteType === 'PRICE' ? 'selected' : ''}>PRICE (futures)</option>
                </select></td>
                <td><input type="number" class="row-quote" value="${q.Quote ?? 0.0}" step="0.001" data-index="${idx}"></td>
                <td><input type="number" class="row-spread" value="${q.Spread ?? ''}" step="0.1" data-index="${idx}" placeholder="bps"></td>
                <td style="text-align:center;"><button class="btn btn-danger btn-sm del-row" data-index="${idx}"><i class="fa-solid fa-trash-can"></i></button></td>`;
        }
        marketTableBody.appendChild(tr);
    });

    // Bind row inputs back to state.
    const bind = (sel, field, cast) => document.querySelectorAll(sel).forEach(el =>
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', e => {
            const i = parseInt(e.target.dataset.index);
            marketQuotes[i][field] = cast ? cast(e.target.value) : e.target.value;
        }));
    bind('.row-instrument', 'Instrument');
    bind('.row-tenor', 'Tenor');
    bind('.row-quotetype', 'QuoteType');
    bind('.row-quote', 'Quote', parseFloat);
    bind('.row-coupon', 'Coupon', parseFloat);
    bind('.row-price', 'Price', parseFloat);
    bind('.row-spread', 'Spread', v => (v === '' ? null : parseFloat(v)));

    document.querySelectorAll('.del-row').forEach(el =>
        el.addEventListener('click', e => {
            marketQuotes.splice(parseInt(e.currentTarget.dataset.index), 1);
            renderTable();
        }));
}

addRowBtn.addEventListener('click', () => {
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
    marketQuotes.push(curveType === 'Treasury'
        ? { Instrument: 'Note', Tenor: '', Coupon: 0.0, Price: 100.0, Spread: null }
        : { Instrument: 'Cash', Tenor: '', QuoteType: 'RATE', Quote: 0.0, Spread: null });
    renderTable();
});

clearTableBtn.addEventListener('click', () => { marketQuotes = []; renderTable(); });

// ---------- File import (CSV / XLSX) ----------
dropzone.addEventListener('click', () => fileInput.click());
['dragover', 'dragenter'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));
dropzone.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

function handleFile(file) {
    const name = file.name.toLowerCase();
    const reader = new FileReader();
    if (name.endsWith('.csv')) {
        reader.onload = e => { ingestRows(parseCSV(e.target.result)); };
        reader.readAsText(file);
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        reader.onload = e => {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            ingestRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
        };
        reader.readAsArrayBuffer(file);
    } else {
        showAlert('Unsupported file type. Use CSV or Excel.', 'danger');
    }
}

function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
        const cells = line.split(',');
        const row = {};
        headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
        return row;
    });
}

function ingestRows(rows) {
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
    marketQuotes = rows.map(r => {
        const base = { Instrument: (r.Instrument || '').trim(), Tenor: (r.Tenor || '').trim(),
                       Spread: r.Spread === '' || r.Spread == null ? null : parseFloat(r.Spread) };
        if (curveType === 'Treasury') return { ...base, Coupon: parseFloat(r.Coupon) || 0.0, Price: parseFloat(r.Price) || 0.0 };
        return { ...base, QuoteType: (r.QuoteType || 'RATE').trim().toUpperCase(), Quote: parseFloat(r.Quote) || 0.0 };
    }).filter(r => r.Tenor);
    renderTable();
    showAlert(`Imported ${marketQuotes.length} quotes.`, 'success');
}

// ---------- Alerts ----------
function showAlert(message, type = 'info') {
    if (!alertContainer) return;
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.textContent = message;
    alertContainer.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

// ============================================================
// Multi-position portfolio table (Phase 3). Each row is one
// cross-asset swap; the two global date inputs above the table
// apply to every row.
// ============================================================
const portfolioTableBody = document.getElementById('portfolio-table-body');
const addPortfolioRowBtn = document.getElementById('add-portfolio-row');
const clearPortfolioBtn = document.getElementById('clear-portfolio');

function formatWithCommas(value) {
    const raw = String(value).replace(/,/g, '');
    if (raw === '' || isNaN(raw)) return value;
    return Number(raw).toLocaleString('en-US');
}

function addPortfolioRow(notional = 10000000, rate = '3.50', ticker = 'MU', assetClass = 'auto', tenor = 1, freq = 2, position = 'receiver') {
    if (!portfolioTableBody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><input type="text" class="port-notional" value="${formatWithCommas(notional)}" placeholder="10,000,000"></td>
        <td><input type="text" class="port-rate" value="${rate}" placeholder="3.5"></td>
        <td><input type="text" class="port-ticker" value="${ticker}" placeholder="MU / CL=F"></td>
        <td>
            <select class="port-asset-class">
                <option value="auto" ${assetClass === 'auto' ? 'selected' : ''}>Auto</option>
                <option value="equity" ${assetClass === 'equity' ? 'selected' : ''}>Equity</option>
                <option value="commodity" ${assetClass === 'commodity' ? 'selected' : ''}>Commodity</option>
            </select>
        </td>
        <td><input type="number" class="port-tenor" value="${tenor}" step="1" min="1"></td>
        <td>
            <select class="port-frequency">
                <option value="1" ${freq === 1 ? 'selected' : ''}>1x</option>
                <option value="2" ${freq === 2 ? 'selected' : ''}>2x</option>
                <option value="4" ${freq === 4 ? 'selected' : ''}>4x</option>
                <option value="12" ${freq === 12 ? 'selected' : ''}>12x</option>
            </select>
        </td>
        <td>
            <select class="port-position">
                <option value="payer" ${position === 'payer' ? 'selected' : ''}>Payer</option>
                <option value="receiver" ${position === 'receiver' ? 'selected' : ''}>Receiver</option>
            </select>
        </td>
        <td style="text-align:center;"><button class="btn btn-danger btn-sm del-port-row" title="Delete"><i class="fa-solid fa-trash-can"></i></button></td>`;

    tr.querySelector('.port-notional').addEventListener('input', e => { e.target.value = formatWithCommas(e.target.value); });
    tr.querySelector('.del-port-row').addEventListener('click', () => tr.remove());
    portfolioTableBody.appendChild(tr);
}

if (portfolioTableBody) addPortfolioRow(); // seed one row
if (addPortfolioRowBtn) addPortfolioRowBtn.addEventListener('click', () => addPortfolioRow(0, '0', '', 'auto', 1, 2, 'receiver'));
if (clearPortfolioBtn) clearPortfolioBtn.addEventListener('click', () => {
    portfolioTableBody.innerHTML = '';
    addPortfolioRow(0, '0', '', 'auto', 1, 2, 'receiver');
});

// Gather every row into the portfolio array, stamping the two global dates.
function gatherPortfolioData(assetTradeDate, presentDate) {
    if (!portfolioTableBody) return [];
    const out = [];
    portfolioTableBody.querySelectorAll('tr').forEach(row => {
        const ticker = row.querySelector('.port-ticker').value.trim().toUpperCase();
        if (!ticker) return; // skip blank rows
        out.push({
            notional: parseFloat(row.querySelector('.port-notional').value.replace(/,/g, '')) || 0,
            fixed_rate: parseFloat(row.querySelector('.port-rate').value) || 0,
            tenor_years: parseInt(row.querySelector('.port-tenor').value) || 0,
            frequency: parseInt(row.querySelector('.port-frequency').value) || 2,
            position: row.querySelector('.port-position').value,
            ticker: ticker,
            asset_class: row.querySelector('.port-asset-class').value,
            asset_trade_date: assetTradeDate,   // global, DD-MM-YYYY (blank -> curve date)
            present_date: presentDate           // global, DD-MM-YYYY (blank -> today)
        });
    });
    return out;
}

// ============================================================
// Calculate: build the SAME payload schema app.py expects; the
// portfolio array now carries N cross-asset positions.
// ============================================================
calculateBtn.addEventListener('click', async () => {
    if (marketQuotes.length === 0) { showAlert('Market quotes table is empty.', 'danger'); return; }

    const tradeDate = document.getElementById('trade-date').value.trim();
    if (!/^\d{2}-\d{2}-\d{4}$/.test(tradeDate)) { showAlert('Curve Date must be DD-MM-YYYY.', 'danger'); return; }

    const assetTradeDate = document.getElementById('ca-trade-date').value.trim();
    const presentDate = document.getElementById('ca-present-date').value.trim();
    const portfolio = gatherPortfolioData(assetTradeDate, presentDate);
    if (portfolio.length === 0) { showAlert('Add at least one position with a ticker.', 'danger'); return; }

    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
    const payload = {
        config: {
            curve_type: curveType,
            trade_date: tradeDate,
            day_count_convention: document.getElementById('day-count').value,
            payment_frequency: parseInt(document.getElementById('payment-freq').value),
            interpolation_method: document.getElementById('interpolation').value,
            futures_cutoff_years: parseFloat(document.getElementById('cutoff-years').value)
        },
        market_data: marketQuotes,
        portfolio: portfolio
    };

    calculateBtn.disabled = true;
    calculateBtn.innerHTML = `<span class="spinner"></span> Fetching live data...`;

    try {
        const res = await fetch('/api/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (!data.success) {
            showAlert(data.error || 'Unknown server error.', 'danger');
            resultsContainer.style.display = 'none';
            return;
        }

        calculationResults = data;
        resultsContainer.style.display = 'grid';
        renderOutputTable();
        renderCharts();
        renderValuationPanel(data.portfolio_results);
        drawCashflowChart(data.cashflows);
        showAlert(`Priced ${portfolio.length} position(s) (${data.curves.method}).`, 'success');
        resultsContainer.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        showAlert(`Network error: ${err.message}. Is the Flask server running?`, 'danger');
    } finally {
        calculateBtn.disabled = false;
        calculateBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Calculate Cross-Asset NPV`;
    }
});

function renderValuationPanel(pr) {
    if (!pr) return;
    const panel = document.getElementById('portfolio-results');
    const fmt = v => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    document.getElementById('out-npv').textContent = fmt(pr.base_npv);
    document.getElementById('out-pvbp').textContent = fmt(pr.pvbp);

    const assets = pr.asset_details || [];
    const initEl = document.getElementById('ca-initial-price');
    const curEl = document.getElementById('ca-current-price');
    const sumEl = document.getElementById('ca-asset-summary');

    if (assets.length === 1) {
        const a = assets[0];
        initEl.textContent = '$' + a.initial_price.toLocaleString();
        curEl.textContent = '$' + a.current_price.toLocaleString();
        const ret = ((a.current_price / a.initial_price - 1) * 100).toFixed(2);
        sumEl.textContent = `${a.ticker} · spot return ${ret}% · div yield ${(a.dividend_yield * 100).toFixed(2)}%`;
    } else if (assets.length > 1) {
        // Multi-position: collapse the per-asset price cells, summarise tickers.
        initEl.textContent = `${assets.length} legs`;
        curEl.textContent = '—';
        sumEl.textContent = assets.map(a =>
            `${a.ticker} ${((a.current_price / a.initial_price - 1) * 100).toFixed(1)}%`).join('  ·  ');
    } else {
        initEl.textContent = '—'; curEl.textContent = '—'; sumEl.textContent = `${pr.positions_priced} position(s) priced`;
    }
    panel.style.display = 'flex';
}

// ---------- Output knots table ----------
function renderOutputTable() {
    outputTableBody.innerHTML = '';
    if (!calculationResults || !calculationResults.knots) return;
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';

    calculationResults.knots.forEach(k => {
        const tr = document.createElement('tr');
        let badge = k.skipped
            ? `<span class="status-badge" style="opacity:.6;" title="${k.skipped_reason || ''}">Skipped</span>`
            : `<span class="status-badge active">Active</span>`;
        if (k.error) badge = `<span class="status-badge" style="color:#ef4444;">Error</span>`;

        const c2 = curveType === 'Treasury'
            ? `<td>${k.coupon ?? '--'}</td><td>${k.price ?? '--'}</td>`
            : `<td>${k.quote_type ?? '--'}</td><td>${k.quote ?? '--'}</td>`;

        tr.innerHTML = `<td>${k.instrument}</td><td>${k.tenor}</td>${c2}
            <td>${k.maturity_date ?? '--'}</td><td>${k.t ?? '--'}</td>
            <td>${k.df ?? '--'}</td><td>${k.zero_rate != null ? k.zero_rate + '%' : '--'}</td><td>${badge}</td>`;
        outputTableBody.appendChild(tr);
    });
}

// ---------- Yield / DF chart ----------
function renderCharts() {
    if (!calculationResults || !calculationResults.curves) return;
    const ctx = document.getElementById('yield-chart').getContext('2d');
    if (yieldChart) yieldChart.destroy();

    const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
    const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const text = isDark ? '#94a3b8' : '#475569';

    const curves = calculationResults.curves;
    const knots = calculationResults.knots.filter(k => !k.error && !k.skipped && k.t > 0);

    let smooth, knotData, lineColor, knotColor, yLabel;
    if (currentChartType === 'zero_rate') {
        smooth = curves.times.map((t, i) => ({ x: t, y: curves.zero_rates[i] }));
        knotData = knots.map(k => ({ x: k.t, y: k.zero_rate }));
        lineColor = '#3b82f6'; knotColor = '#06b6d4'; yLabel = 'Continuous Zero Rate (%)';
    } else {
        smooth = curves.times.map((t, i) => ({ x: t, y: curves.discount_factors[i] }));
        knotData = knots.map(k => ({ x: k.t, y: k.df }));
        smooth.unshift({ x: 0, y: 1.0 });
        lineColor = '#10b981'; knotColor = '#f59e0b'; yLabel = 'Discount Factor D(0, T)';
    }

    yieldChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Smoothed Curve', data: smooth, showLine: true, borderColor: lineColor, borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0.1 },
                { label: 'Bootstrapped Knots', data: knotData, backgroundColor: knotColor, pointRadius: 5, pointHoverRadius: 7 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Tenor (Years)', color: text }, grid: { color: grid }, ticks: { color: text } },
                y: { title: { display: true, text: yLabel, color: text }, grid: { color: grid }, ticks: { color: text } }
            },
            plugins: { legend: { labels: { color: text } } }
        }
    });
}

if (showZeroRateBtn) showZeroRateBtn.addEventListener('click', () => {
    currentChartType = 'zero_rate';
    showZeroRateBtn.classList.add('active'); showDfBtn.classList.remove('active');
    renderCharts();
});
if (showDfBtn) showDfBtn.addEventListener('click', () => {
    currentChartType = 'discount_factor';
    showDfBtn.classList.add('active'); showZeroRateBtn.classList.remove('active');
    renderCharts();
});

// ---------- Cashflow chart (ported from main.js) ----------
// Reads the engine's actual fields: date / net_cashflow / cumulative.
let currentCashflowData = null;

function drawCashflowChart(cashflowData) {
    const canvas = document.getElementById('cashflow-chart');
    if (!canvas) return;
    currentCashflowData = cashflowData;

    if (!cashflowData || cashflowData.length === 0) {
        if (cashflowChart) { cashflowChart.destroy(); cashflowChart = null; }
        return;
    }

    const ctx = canvas.getContext('2d');
    if (cashflowChart) cashflowChart.destroy();

    const labels = cashflowData.map(d => d.date);
    const netFlows = cashflowData.map(d => d.net_cashflow);
    const cumulativeFlows = cashflowData.map(d => d.cumulative);

    const isCombined = document.getElementById('axis-toggle')?.checked || false;

    const maxCumulative = Math.max(...cumulativeFlows.map(Math.abs), 0);
    const maxNet = Math.max(...netFlows.map(Math.abs), 0);
    let cumulativeBound = maxCumulative === 0 ? 100 : maxCumulative * 1.15;
    let netBound = maxNet === 0 ? 100 : maxNet * 1.15;
    if (isCombined) { const u = Math.max(cumulativeBound, netBound); cumulativeBound = u; netBound = u; }

    const scales = {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
        y: {
            type: 'linear', display: true, position: 'left',
            title: { display: true, text: isCombined ? 'Financial Value ($)' : 'Cumulative ($)', color: '#94a3b8' },
            grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' },
            min: -cumulativeBound, max: cumulativeBound
        }
    };
    if (!isCombined) {
        scales.y1 = {
            type: 'linear', display: true, position: 'right',
            title: { display: true, text: 'Net Cashflow ($)', color: '#94a3b8' },
            grid: {
                drawOnChartArea: true,
                color: (c) => c.tick.value === 0 ? 'rgba(255,255,255,0.25)' : 'transparent',
                lineWidth: (c) => c.tick.value === 0 ? 2 : 1
            },
            ticks: { color: '#94a3b8' }, min: -netBound, max: netBound
        };
    }

    cashflowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'line', label: 'Cumulative PnL', data: cumulativeFlows,
                    borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)',
                    borderWidth: 3, tension: 0.3, fill: true, yAxisID: 'y'
                },
                {
                    type: 'bar', label: 'Net Period Cashflow', data: netFlows,
                    backgroundColor: netFlows.map(v => v >= 0 ? '#10b981' : '#ef4444'),
                    barThickness: 6, yAxisID: isCombined ? 'y' : 'y1'
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, resizeDelay: 200,
            interaction: { mode: 'index', intersect: false },
            scales,
            plugins: { legend: { labels: { color: '#94a3b8' } } }
        }
    });
}

// Re-render on axis toggle (mirrors main.js handleAxisToggle).
const axisToggleEl = document.getElementById('axis-toggle');
if (axisToggleEl) axisToggleEl.addEventListener('change', () => {
    if (currentCashflowData) drawCashflowChart(currentCashflowData);
});