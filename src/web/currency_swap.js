// App State
let curve1MarketQuotes = [];
let curve2MarketQuotes = [];
let calculationResults = null;
let currentChartType = 'zero_rate'; // 'zero_rate' or 'discount_factor'
let curvesChart = null;
let timelineChart = null;

// DOM Elements
const themeToggleBtn = document.getElementById('theme-toggle');
const tradeDateInput = document.getElementById('trade-date');
const spotFxInput = document.getElementById('spot-fx-rate');
const calculateBtn = document.getElementById('calculate-btn');
const resetCurvesBtn = document.getElementById('reset-curves-btn');
const resultsContainer = document.getElementById('results-container');
const alertContainer = document.getElementById('alert-container');

// Leg 1 Elements
const leg1Currency = document.getElementById('leg1-currency');
const leg1Position = document.getElementById('leg1-position');
const leg1Type = document.getElementById('leg1-type');
const leg1Rate = document.getElementById('leg1-rate');
const leg1RateLabel = document.getElementById('leg1-rate-label');
const leg1Notional = document.getElementById('leg1-notional');
const leg1Frequency = document.getElementById('leg1-frequency');
const leg1Daycount = document.getElementById('leg1-daycount');
const leg1Tenor = document.getElementById('leg1-tenor');

// Leg 2 Elements
const leg2Currency = document.getElementById('leg2-currency');
const leg2Position = document.getElementById('leg2-position');
const leg2Type = document.getElementById('leg2-type');
const leg2Rate = document.getElementById('leg2-rate');
const leg2RateLabel = document.getElementById('leg2-rate-label');
const leg2Notional = document.getElementById('leg2-notional');
const leg2Frequency = document.getElementById('leg2-frequency');
const leg2Daycount = document.getElementById('leg2-daycount');
const leg2Tenor = document.getElementById('leg2-tenor');

// Recalc & Label Elements
const recalcNotionalBtn = document.getElementById('recalc-notional-btn');
const fxPairLabel = document.getElementById('fx-pair-label');
const curve1Name = document.getElementById('curve1-name');
const curve2Name = document.getElementById('curve2-name');
const curve1NodesTitle = document.getElementById('curve1-nodes-title');
const curve2NodesTitle = document.getElementById('curve2-nodes-title');
const curve1Dropzone = document.getElementById('curve1-dropzone');
const curve1FileInput = document.getElementById('curve1-file');
const curve1Status = document.getElementById('curve1-status');
const curve2Dropzone = document.getElementById('curve2-dropzone');
const curve2FileInput = document.getElementById('curve2-file');
const curve2Status = document.getElementById('curve2-status');

// Output Tables & Toggles
const showZeroRateBtn = document.getElementById('show-zero-rate');
const showDfBtn = document.getElementById('show-df');
const showFxForwardBtn = document.getElementById('show-fx-forward');
const cashflowsTbody = document.getElementById('cashflows-tbody');
const curve1KnotsTbody = document.getElementById('curve1-knots-tbody');
const curve2KnotsTbody = document.getElementById('curve2-knots-tbody');
const fxForwardTbody = document.getElementById('fx-forward-tbody');
const exportCashflowsBtn = document.getElementById('export-cashflows');

const showCurve1TableBtn = document.getElementById('show-curve1-table');
const showCurve2TableBtn = document.getElementById('show-curve2-table');
const showFxTableBtn = document.getElementById('show-fx-table');
const curve1TableWrapper = document.getElementById('curve1-table-wrapper');
const curve2TableWrapper = document.getElementById('curve2-table-wrapper');
const fxTableWrapper = document.getElementById('fx-table-wrapper');
const curve1TabLabel = document.getElementById('curve1-tab-label');
const curve2TabLabel = document.getElementById('curve2-tab-label');

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
    // Theme sync
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    
    // Formatting & Sync listeners
    initNotionalFormatting(leg1Notional);
    initNotionalFormatting(leg2Notional);
    initSyncingListeners();
    updateLabelStates();
    
    // Automatically price on page load to show beautiful results immediately
    triggerCalculation();
});

// Comma Formatting Utilities
function formatWithCommas(value) {
    let num = value.replace(/[^0-9.]/g, ''); 
    if (!num) return '';
    let parts = num.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

function stripCommas(value) {
    return parseFloat(value.replace(/,/g, '')) || 0.0;
}

function initNotionalFormatting(input) {
    input.addEventListener('input', (e) => {
        e.target.value = formatWithCommas(e.target.value);
    });
    input.value = formatWithCommas(input.value);
}

// UI Label Syncing
function updateLabelStates() {
    const c1 = leg1Currency.value;
    const c2 = leg2Currency.value;
    
    // Label pairs
    fxPairLabel.textContent = `${c1}/${c2}`;
    curve1Name.textContent = c1;
    curve2Name.textContent = c2;
    curve1NodesTitle.textContent = c1;
    curve2NodesTitle.textContent = c2;
    
    document.querySelectorAll('.leg1-curr-label').forEach(el => el.textContent = c1);
    document.querySelectorAll('.leg2-curr-label').forEach(el => el.textContent = c2);
    
    if (curve1TabLabel) curve1TabLabel.textContent = `${c1} Nodes`;
    if (curve2TabLabel) curve2TabLabel.textContent = `${c2} Nodes`;
    
    // Leg 1 type label
    if (leg1Type.value === 'fixed') {
        leg1RateLabel.textContent = 'Fixed Rate (%)';
    } else {
        leg1RateLabel.textContent = 'Spread (%)';
    }
    
    // Leg 2 type label
    if (leg2Type.value === 'fixed') {
        leg2RateLabel.textContent = 'Fixed Rate (%)';
    } else {
        leg2RateLabel.textContent = 'Spread (%)';
    }
}

function initSyncingListeners() {
    leg1Currency.addEventListener('change', updateLabelStates);
    leg2Currency.addEventListener('change', updateLabelStates);
    
    leg1Type.addEventListener('change', updateLabelStates);
    leg2Type.addEventListener('change', updateLabelStates);
    
    // Leg 1 Position controls Leg 2 Position
    leg1Position.addEventListener('change', (e) => {
        leg2Position.value = e.target.value === 'receiver' ? 'payer' : 'receiver';
    });
    
    // Leg 1 Tenor controls Leg 2 Tenor
    leg1Tenor.addEventListener('input', (e) => {
        leg2Tenor.value = e.target.value;
    });
    
    // Recalc Notional Button
    recalcNotionalBtn.addEventListener('click', () => {
        const spotFx = parseFloat(spotFxInput.value) || 1.0;
        const n1 = stripCommas(leg1Notional.value);
        if (n1 > 0 && spotFx > 0) {
            const n2 = n1 / spotFx;
            leg2Notional.value = formatWithCommas(n2.toFixed(2));
            showAlert('Leg 2 notional successfully synced with Leg 1 notional and Spot FX rate.', 'success');
        }
    });
}

// Drag & Drop / File Uploads Curve 1
curve1Dropzone.addEventListener('click', () => curve1FileInput.click());
curve1Dropzone.addEventListener('dragover', (e) => { e.preventDefault(); curve1Dropzone.classList.add('dragover'); });
curve1Dropzone.addEventListener('dragleave', () => curve1Dropzone.classList.remove('dragover'));
curve1Dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    curve1Dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleCurveFile(e.dataTransfer.files[0], 1);
});
curve1FileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleCurveFile(e.target.files[0], 1);
});

// Drag & Drop / File Uploads Curve 2
curve2Dropzone.addEventListener('click', () => curve2FileInput.click());
curve2Dropzone.addEventListener('dragover', (e) => { e.preventDefault(); curve2Dropzone.classList.add('dragover'); });
curve2Dropzone.addEventListener('dragleave', () => curve2Dropzone.classList.remove('dragover'));
curve2Dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    curve2Dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleCurveFile(e.dataTransfer.files[0], 2);
});
curve2FileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleCurveFile(e.target.files[0], 2);
});

function handleCurveFile(file, curveNum) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const parsed = parseCSV(e.target.result);
            if (parsed.length > 0) {
                if (curveNum === 1) {
                    curve1MarketQuotes = parsed;
                    curve1Status.innerHTML = `<span style="color: var(--success); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Loaded ${parsed.length} quotes from ${file.name}</span>`;
                } else {
                    curve2MarketQuotes = parsed;
                    curve2Status.innerHTML = `<span style="color: var(--success); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Loaded ${parsed.length} quotes from ${file.name}</span>`;
                }
                showAlert(`Curve ${curveNum} market data successfully loaded!`, 'success');
            } else {
                showAlert('CSV file was empty or missing required columns.', 'danger');
            }
        } catch (err) {
            showAlert(`CSV parsing error: ${err.message}`, 'danger');
        }
    };
    reader.readAsText(file);
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const instIdx = headers.findIndex(h => h.toLowerCase() === 'instrument');
    const tenorIdx = headers.findIndex(h => h.toLowerCase() === 'tenor');
    const typeIdx = headers.findIndex(h => h.toLowerCase() === 'quotetype');
    const quoteIdx = headers.findIndex(h => h.toLowerCase() === 'quote');
    const spreadIdx = headers.findIndex(h => h.toLowerCase() === 'spread');
    
    if (instIdx === -1 || tenorIdx === -1 || typeIdx === -1 || quoteIdx === -1) {
        throw new Error('CSV headers must include: Instrument, Tenor, QuoteType, Quote');
    }
    
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length <= Math.max(instIdx, tenorIdx, typeIdx, quoteIdx)) continue;
        
        const spreadVal = spreadIdx !== -1 ? cols[spreadIdx] : '';
        const spread = spreadVal !== '' && !isNaN(parseFloat(spreadVal)) ? parseFloat(spreadVal) : null;
        
        records.push({
            Instrument: cols[instIdx].charAt(0).toUpperCase() + cols[instIdx].slice(1).toLowerCase(),
            Tenor: cols[tenorIdx].toUpperCase(),
            QuoteType: cols[typeIdx].toUpperCase(),
            Quote: parseFloat(cols[quoteIdx]) || 0.0,
            Spread: spread
        });
    }
    return records;
}

resetCurvesBtn.addEventListener('click', () => {
    curve1MarketQuotes = [];
    curve2MarketQuotes = [];
    curve1Status.textContent = 'Using default USD OIS curve sample data.';
    curve2Status.textContent = 'Using default EUR curve sample data.';
    curve1FileInput.value = '';
    curve2FileInput.value = '';
    showAlert('Reset back to default sample curves.', 'info');
    triggerCalculation();
});

// Alert Handler
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    let iconClass = 'fa-circle-info';
    if (type === 'danger') iconClass = 'fa-circle-xmark';
    if (type === 'success') iconClass = 'fa-circle-check';
    
    alertDiv.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <span>${message}</span>
    `;
    alertContainer.innerHTML = '';
    alertContainer.appendChild(alertDiv);
    
    if (type !== 'danger') {
        setTimeout(() => {
            alertDiv.style.opacity = '0';
            alertDiv.style.transform = 'translateY(-10px)';
            alertDiv.style.transition = 'all 0.5s ease';
            setTimeout(() => alertDiv.remove(), 500);
        }, 5000);
    }
}

// Theme Toggle
themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
    
    if (calculationResults) {
        renderCurvesChart();
        renderTimelineChart();
    }
});

function updateThemeIcon(theme) {
    const icon = themeToggleBtn.querySelector('i');
    icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

// Calculate Action
calculateBtn.addEventListener('click', triggerCalculation);

 async function triggerCalculation() {
    calculateBtn.disabled = true;
    calculateBtn.innerHTML = `<span class="spinner"></span> Pricing Swap...`;
    
    const tradeDate = tradeDateInput.value.trim();
    const spotFx = parseFloat(spotFxInput.value) || 1.0;
    
    const leg1 = {
        currency: leg1Currency.value,
        notional: stripCommas(leg1Notional.value),
        rate_type: leg1Type.value,
        rate_or_spread: parseFloat(leg1Rate.value) || 0.0,
        frequency: parseInt(leg1Frequency.value),
        day_count: leg1Daycount.value,
        tenor_years: parseInt(leg1Tenor.value),
        is_payer: leg1Position.value === 'payer'
    };
    
    const leg2 = {
        currency: leg2Currency.value,
        notional: stripCommas(leg2Notional.value),
        rate_type: leg2Type.value,
        rate_or_spread: parseFloat(leg2Rate.value) || 0.0,
        frequency: parseInt(leg2Frequency.value),
        day_count: leg2Daycount.value,
        tenor_years: parseInt(leg1Tenor.value), // Matched
        is_payer: leg2Position.value === 'payer'
    };
    
    const curve_config1 = {
        day_count_convention: leg1Daycount.value,
        payment_frequency: parseInt(leg1Frequency.value),
        interpolation_method: document.getElementById('curve1-interpolation').value,
        futures_cutoff_years: parseFloat(document.getElementById('curve1-cutoff').value) || 2.0
    };
    
    const curve_config2 = {
        day_count_convention: leg2Daycount.value,
        payment_frequency: parseInt(leg2Frequency.value),
        interpolation_method: document.getElementById('curve2-interpolation').value,
        futures_cutoff_years: parseFloat(document.getElementById('curve2-cutoff').value) || 2.0
    };
    
    try {
        const response = await fetch('/api/calculate_currency_swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trade_date: tradeDate,
                spot_fx_rate: spotFx,
                leg1: leg1,
                leg2: leg2,
                curve_config1: curve_config1,
                curve_config2: curve_config2,
                leg1_market_data: curve1MarketQuotes,
                leg2_market_data: curve2MarketQuotes
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            showAlert(data.error || 'Pricing calculation failed.', 'danger');
            resultsContainer.style.display = 'none';
        } else {
            calculationResults = data;
            resultsContainer.style.display = 'grid';
            showAlert('Cross-currency swap valued successfully!', 'success');
            
            updateNPVDisplays(data.npv_results);
            renderCashflowTable(data.cashflows);
            renderKnotTables(data.leg1_knots, data.leg2_knots);
            renderFXForwardTable(data.fx_forward_curve);
            
            renderCurvesChart();
            renderTimelineChart();
            
            resultsContainer.scrollIntoView({ behavior: 'smooth' });
        }
    } catch (err) {
        showAlert(`Server connection error: ${err.message}`, 'danger');
    } finally {
        calculateBtn.disabled = false;
        calculateBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Calculate Swap Price & NPV`;
    }
}

function updateNPVDisplays(results) {
    const c1 = leg1Currency.value;
    
    document.getElementById('leg1-interest-pv-display').textContent = `Interest PV: ${c1} ${results.leg1_interest_pv.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('leg1-notional-pv-display').textContent = `Notional PV: ${c1} ${results.leg1_notional_pv.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('leg1-total-pv-display').textContent = `${c1} ${results.leg1_total_pv.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    document.getElementById('leg2-interest-pv-display').textContent = `Interest PV: ${c1} ${results.leg2_interest_pv.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('leg2-notional-pv-display').textContent = `Notional PV: ${c1} ${results.leg2_notional_pv.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('leg2-total-pv-display').textContent = `${c1} ${results.leg2_total_pv.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const netNPV = document.getElementById('net-npv-display');
    netNPV.textContent = `${c1} ${results.total_net_npv.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    // Style Net NPV based on sign
    if (results.total_net_npv >= 0.0) {
        netNPV.style.color = 'var(--success)';
        netNPV.style.textShadow = '0 0 10px rgba(16,185,129,0.25)';
    } else {
        netNPV.style.color = 'var(--danger)';
        netNPV.style.textShadow = '0 0 10px rgba(239,68,68,0.25)';
    }
}

function renderCashflowTable(cashflows) {
    cashflowsTbody.innerHTML = '';
    cashflows.forEach(cf => {
        const tr = document.createElement('tr');
        
        // Highlight maturity principal exchange row
        if (cf.type === 'principal') {
            tr.style.background = 'rgba(255, 255, 255, 0.04)';
            tr.style.fontWeight = 'bold';
        }
        
        // Colors for positive/negative cashflows
        const l1Color = cf.leg1_amount >= 0 ? 'color: var(--success);' : 'color: var(--danger);';
        const l2Color = cf.leg2_amount >= 0 ? 'color: var(--success);' : 'color: var(--danger);';
        const netColor = cf.net_cashflow >= 0 ? 'color: var(--success);' : 'color: var(--danger);';
        
        tr.innerHTML = `
            <td>${cf.date}</td>
            <td><span class="status-badge ${cf.type === 'principal' ? 'active' : 'skipped'}">${cf.type.toUpperCase()}</span></td>
            <td style="${l1Color}">${cf.leg1_amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td style="${l2Color}">${cf.leg2_amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td>${cf.fx_forward.toFixed(6)}</td>
            <td style="${l2Color}">${cf.leg2_converted.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td style="${netColor}">${cf.net_cashflow.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td>${cf.df.toFixed(6)}</td>
            <td style="${netColor} font-weight: bold;">${cf.pv.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
        `;
        cashflowsTbody.appendChild(tr);
    });
}

function renderKnotTables(knots1, knots2) {
    curve1KnotsTbody.innerHTML = '';
    knots1.forEach(k => {
        const tr = document.createElement('tr');
        let badge = `<span class="status-badge active">Active</span>`;
        if (k.skipped) badge = `<span class="status-badge skipped">Skipped</span>`;
        if (k.error) badge = `<span class="status-badge error">Error</span>`;
        
        tr.innerHTML = `
            <td><strong>${k.tenor}</strong></td>
            <td>${k.df !== undefined ? k.df.toFixed(5) : '-'}</td>
            <td>${k.zero_rate !== undefined ? k.zero_rate.toFixed(3) + '%' : '-'}</td>
            <td>${badge}</td>
        `;
        curve1KnotsTbody.appendChild(tr);
    });
    
    curve2KnotsTbody.innerHTML = '';
    knots2.forEach(k => {
        const tr = document.createElement('tr');
        let badge = `<span class="status-badge active">Active</span>`;
        if (k.skipped) badge = `<span class="status-badge skipped">Skipped</span>`;
        if (k.error) badge = `<span class="status-badge error">Error</span>`;
        
        tr.innerHTML = `
            <td><strong>${k.tenor}</strong></td>
            <td>${k.df !== undefined ? k.df.toFixed(5) : '-'}</td>
            <td>${k.zero_rate !== undefined ? k.zero_rate.toFixed(3) + '%' : '-'}</td>
            <td>${badge}</td>
        `;
        curve2KnotsTbody.appendChild(tr);
    });
}

function renderFXForwardTable(fxForward) {
    fxForwardTbody.innerHTML = '';
    fxForward.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${item.tenor}</strong></td>
            <td>${item.t.toFixed(4)}</td>
            <td style="font-family: monospace; font-weight: 600; color: var(--accent);">${item.forward_rate.toFixed(6)}</td>
        `;
        fxForwardTbody.appendChild(tr);
    });
}

// Chart.js render zero rate, discount factor, or FX forward curves
showZeroRateBtn.addEventListener('click', () => {
    if (currentChartType === 'zero_rate') return;
    currentChartType = 'zero_rate';
    showZeroRateBtn.classList.add('active');
    showDfBtn.classList.remove('active');
    if (showFxForwardBtn) showFxForwardBtn.classList.remove('active');
    renderCurvesChart();
});

showDfBtn.addEventListener('click', () => {
    if (currentChartType === 'discount_factor') return;
    currentChartType = 'discount_factor';
    showDfBtn.classList.add('active');
    showZeroRateBtn.classList.remove('active');
    if (showFxForwardBtn) showFxForwardBtn.classList.remove('active');
    renderCurvesChart();
});

if (showFxForwardBtn) {
    showFxForwardBtn.addEventListener('click', () => {
        if (currentChartType === 'fx_forward') return;
        currentChartType = 'fx_forward';
        showFxForwardBtn.classList.add('active');
        showZeroRateBtn.classList.remove('active');
        showDfBtn.classList.remove('active');
        renderCurvesChart();
    });
}

function renderCurvesChart() {
    if (!calculationResults) return;
    const canvas = document.getElementById('curves-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (curvesChart) curvesChart.destroy();
    
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isDark = theme === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#475569';
    
    const c1 = leg1Currency.value;
    const c2 = leg2Currency.value;
    
    let chartTitle = '';
    let yLabel = '';
    let datasets = [];
    
    const activeKnots1 = calculationResults.leg1_knots.filter(k => !k.error && !k.skipped && k.t > 0);
    const activeKnots2 = calculationResults.leg2_knots.filter(k => !k.error && !k.skipped && k.t > 0);
    
    if (currentChartType === 'zero_rate') {
        chartTitle = 'Interest Rate Zero Curves (Smooth Spline)';
        yLabel = 'Continuous Zero Rate (%)';
        
        const dataset1 = calculationResults.leg1_curve.times.map((t, idx) => ({ x: t, y: calculationResults.leg1_curve.zero_rates[idx] }));
        const dataset2 = calculationResults.leg2_curve.times.map((t, idx) => ({ x: t, y: calculationResults.leg2_curve.zero_rates[idx] }));
        
        const knotsData1 = activeKnots1.map(k => ({ x: k.t, y: k.zero_rate, label: k.tenor }));
        const knotsData2 = activeKnots2.map(k => ({ x: k.t, y: k.zero_rate, label: k.tenor }));
        
        datasets = [
            {
                label: `${c1} Curve`,
                data: dataset1,
                showLine: true,
                borderColor: '#3b82f6', // USD blue
                borderWidth: 2.5,
                pointRadius: 0,
                fill: false,
                tension: 0.1
            },
            {
                label: `${c1} Nodes`,
                data: knotsData1,
                showLine: false,
                pointBackgroundColor: '#06b6d4',
                pointBorderColor: isDark ? '#070913' : '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: 5,
                z: 5
            },
            {
                label: `${c2} Curve`,
                data: dataset2,
                showLine: true,
                borderColor: '#f59e0b', // EUR orange
                borderWidth: 2.5,
                pointRadius: 0,
                fill: false,
                tension: 0.1
            },
            {
                label: `${c2} Nodes`,
                data: knotsData2,
                showLine: false,
                pointBackgroundColor: '#ef4444',
                pointBorderColor: isDark ? '#070913' : '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: 5,
                z: 5
            }
        ];
    } else if (currentChartType === 'discount_factor') {
        chartTitle = 'Discount Factor Curves';
        yLabel = 'Discount Factor D(0, T)';
        
        const dataset1 = calculationResults.leg1_curve.times.map((t, idx) => ({ x: t, y: calculationResults.leg1_curve.discount_factors[idx] }));
        const dataset2 = calculationResults.leg2_curve.times.map((t, idx) => ({ x: t, y: calculationResults.leg2_curve.discount_factors[idx] }));
        
        dataset1.unshift({ x: 0, y: 1.0 });
        dataset2.unshift({ x: 0, y: 1.0 });
        
        const knotsData1 = activeKnots1.map(k => ({ x: k.t, y: k.df, label: k.tenor }));
        const knotsData2 = activeKnots2.map(k => ({ x: k.t, y: k.df, label: k.tenor }));
        knotsData1.unshift({ x: 0, y: 1.0, label: 'Origin' });
        knotsData2.unshift({ x: 0, y: 1.0, label: 'Origin' });
        
        datasets = [
            {
                label: `${c1} Curve`,
                data: dataset1,
                showLine: true,
                borderColor: '#3b82f6',
                borderWidth: 2.5,
                pointRadius: 0,
                fill: false,
                tension: 0.1
            },
            {
                label: `${c1} Nodes`,
                data: knotsData1,
                showLine: false,
                pointBackgroundColor: '#06b6d4',
                pointBorderColor: isDark ? '#070913' : '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: 5,
                z: 5
            },
            {
                label: `${c2} Curve`,
                data: dataset2,
                showLine: true,
                borderColor: '#f59e0b',
                borderWidth: 2.5,
                pointRadius: 0,
                fill: false,
                tension: 0.1
            },
            {
                label: `${c2} Nodes`,
                data: knotsData2,
                showLine: false,
                pointBackgroundColor: '#ef4444',
                pointBorderColor: isDark ? '#070913' : '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: 5,
                z: 5
            }
        ];
    } else {
        chartTitle = 'FX Forward Curve (Covered Interest Parity)';
        yLabel = `Forward FX Rate (${c1}/${c2})`;
        
        const fxData = [...calculationResults.fx_forward_curve];
        fxData.sort((a, b) => a.t - b.t);
        
        const smoothData = fxData.map(item => ({ x: item.t, y: item.forward_rate }));
        smoothData.unshift({ x: 0, y: parseFloat(spotFxInput.value) || 1.0 });
        
        const knotData = fxData.map(item => ({ x: item.t, y: item.forward_rate, label: item.tenor }));
        knotData.unshift({ x: 0, y: parseFloat(spotFxInput.value) || 1.0, label: 'Spot' });
        
        datasets = [
            {
                label: `Forward FX Rate`,
                data: smoothData,
                showLine: true,
                borderColor: '#06b6d4', // Cyan
                borderWidth: 2.5,
                pointRadius: 0,
                fill: false,
                tension: 0.1
            },
            {
                label: 'Tenor Points',
                data: knotData,
                showLine: false,
                pointBackgroundColor: '#ef4444', // Red
                pointBorderColor: isDark ? '#070913' : '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: 5,
                z: 5
            }
        ];
    }
    
    curvesChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: chartTitle,
                    color: isDark ? '#f8fafc' : '#0f172a',
                    font: { family: 'Outfit', size: 16, weight: '600' }
                },
                legend: {
                    labels: { color: textColor, font: { family: 'Inter', size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const point = context.raw;
                            const t = point.x.toFixed(3);
                            const val = point.y.toFixed(5);
                            const unit = currentChartType === 'zero_rate' ? '%' : '';
                            return `${context.dataset.label}: t = ${t}y | Value = ${val}${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Tenor Time (Years)', color: textColor, font: { family: 'Outfit', size: 12, weight: '600' } },
                    grid: { color: gridColor },
                    ticks: { color: textColor }
                },
                y: {
                    title: { display: true, text: yLabel, color: textColor, font: { family: 'Outfit', size: 12, weight: '600' } },
                    grid: { color: gridColor },
                    ticks: { color: textColor }
                }
            }
        }
    });
}

function renderTimelineChart() {
    if (!calculationResults || !calculationResults.cashflows) return;
    const canvas = document.getElementById('cashflow-timeline-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (timelineChart) timelineChart.destroy();
    
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isDark = theme === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    const textColor = isDark ? '#94a3b8' : '#475569';
    
    // Process cashflows: group by date
    const interestCfs = calculationResults.cashflows.filter(cf => cf.type === 'interest');
    
    const labels = interestCfs.map(cf => cf.date);
    const leg1Flows = interestCfs.map(cf => cf.leg1_amount);
    const leg2Flows = interestCfs.map(cf => cf.leg2_converted); // converted to Currency 1
    
    // Net cumulative PV of interest payments
    let cumulative = 0.0;
    const cumulativeFlows = interestCfs.map(cf => {
        cumulative += cf.pv; // already discounted net cashflow in Leg 1 currency
        return cumulative;
    });
    
    timelineChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'line',
                    label: 'Cumulative Net PV (Interest)',
                    data: cumulativeFlows,
                    borderColor: '#10b981', // green
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    borderWidth: 3,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    type: 'bar',
                    label: `Leg 1 Period Interest`,
                    data: leg1Flows,
                    backgroundColor: 'rgba(59, 130, 246, 0.65)', // Blue
                    barThickness: 6,
                    yAxisID: 'y'
                },
                {
                    type: 'bar',
                    label: `Leg 2 Period (Converted)`,
                    data: leg2Flows,
                    backgroundColor: 'rgba(245, 158, 11, 0.65)', // Orange
                    barThickness: 6,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Cashflow Interest Projections & Cumulative Net PV',
                    color: isDark ? '#f8fafc' : '#0f172a',
                    font: { family: 'Outfit', size: 15, weight: '600' }
                },
                legend: {
                    labels: { color: textColor, font: { family: 'Inter', size: 11 } }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Inter', size: 10 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Inter', size: 10 } },
                    title: { display: true, text: 'Value (Leg 1 Currency)', color: textColor, font: { family: 'Outfit', size: 12, weight: '600' } }
                }
            }
        }
    });
}

// Export cashflow table to CSV
exportCashflowsBtn.addEventListener('click', () => {
    if (!calculationResults || !calculationResults.cashflows) return;
    
    const c1 = leg1Currency.value;
    const c2 = leg2Currency.value;
    
    let csvContent = `PaymentDate,Type,Leg1_Cashflow_${c1},Leg2_Cashflow_${c2},ForwardFXRate,Leg2_Converted_${c1},Net_Cashflow_${c1},DiscountFactor_${c1},PV_Net_Cashflow_${c1}\n`;
    
    calculationResults.cashflows.forEach(cf => {
        csvContent += `${cf.date},${cf.type},${cf.leg1_amount},${cf.leg2_amount},${cf.fx_forward},${cf.leg2_converted},${cf.net_cashflow},${cf.df},${cf.pv}\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `currency_swap_cashflows_${leg1Currency.value}_${leg2Currency.value}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// Toggle Curve & Forward Tables Logic
if (showCurve1TableBtn && showCurve2TableBtn && showFxTableBtn) {
    showCurve1TableBtn.addEventListener('click', () => {
        showCurve1TableBtn.classList.add('active');
        showCurve2TableBtn.classList.remove('active');
        showFxTableBtn.classList.remove('active');
        
        curve1TableWrapper.style.display = 'block';
        curve2TableWrapper.style.display = 'none';
        fxTableWrapper.style.display = 'none';
    });

    showCurve2TableBtn.addEventListener('click', () => {
        showCurve1TableBtn.classList.remove('active');
        showCurve2TableBtn.classList.add('active');
        showFxTableBtn.classList.remove('active');
        
        curve1TableWrapper.style.display = 'none';
        curve2TableWrapper.style.display = 'block';
        fxTableWrapper.style.display = 'none';
    });

    showFxTableBtn.addEventListener('click', () => {
        showCurve1TableBtn.classList.remove('active');
        showCurve2TableBtn.classList.remove('active');
        showFxTableBtn.classList.add('active');
        
        curve1TableWrapper.style.display = 'none';
        curve2TableWrapper.style.display = 'none';
        fxTableWrapper.style.display = 'block';
    });
}
