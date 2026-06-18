// src/web/cross_asset.js
// Standalone controller for the Cross-Asset Swap tab.

// ---------- App State ----------
let marketQuotes = [];
let calculationResults = null;
let currentChartType = 'zero_rate';
let yieldChart = null;
let cashflowChart = null;
let curveValuationDate = null; 

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

// Updated IDs from new HTML refactor
const importQuotesBtn = document.getElementById('import-quotes-btn');
const sampleQuotesBtn = document.getElementById('sample-quotes-btn');
const showZeroRateBtn = document.getElementById('show-zero-rate');
const showDfBtn = document.getElementById('show-df');
const curveTypeSelect = document.getElementById('curve-type');

// ---------- Formatting helpers ----------
const fmt4 = v => (v == null || v === '' || isNaN(v)) ? '--' : Number(v).toFixed(4);
const fmtMoney = v => (v == null || isNaN(v)) ? '--' : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatWithCommas(value) {
    const raw = String(value).replace(/,/g, '');
    if (raw === '' || isNaN(raw)) return value;
    return Number(raw).toLocaleString('en-US');
}

function parseDDMMYYYY(s) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec((s || '').trim());
    return m ? new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) : null;
}

function formatNiceDate(isoString) {
    if (!isoString) return '--';
    const date = new Date(isoString);
    const formatter = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: '2-digit'
    });
    
    const parts = formatter.formatToParts(date);
    const day = parts.find(p => p.type === 'day').value;
    const month = parts.find(p => p.type === 'month').value;
    const year = parts.find(p => p.type === 'year').value;

    return `${day} ${month} '${year}`;
}

// ---------- Init & Session ----------
function syncActiveNav() {
    const here = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach(a => {
        const href = (a.getAttribute('href') || '').split('/').pop();
        a.classList.toggle('active', href === here);
    });
}

const SESSION_KEY = 'ca_session_v1';
function saveSession() {
    try {
        const cfg = {
            curveType: curveTypeSelect ? curveTypeSelect.value : 'OIS',
            tradeDate: document.getElementById('trade-date')?.value ?? '',
            paymentFreq: document.getElementById('payment-freq')?.value ?? '2',
            interpolation: document.getElementById('interpolation')?.value ?? 'Cubic Spline',
            cutoffYears: document.getElementById('cutoff-years')?.value ?? '2.0',
            presentDate: document.getElementById('ca-present-date')?.value ?? document.getElementById('ca-valuation-date')?.value ?? ''
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            quotes: marketQuotes,
            portfolio: serializePortfolio(),
            config: cfg
        }));
    } catch (e) { }
}

function restoreSession() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { saved = null; }
    if (!saved) return false;

    const cfg = saved.config || {};
    if (curveTypeSelect && cfg.curveType) curveTypeSelect.value = cfg.curveType;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    setVal('trade-date', cfg.tradeDate);
    setVal('payment-freq', cfg.paymentFreq);
    setVal('interpolation', cfg.interpolation);
    setVal('cutoff-years', cfg.cutoffYears);
    
    const pDate = document.getElementById('ca-present-date') || document.getElementById('ca-valuation-date');
    if (pDate && cfg.presentDate) pDate.value = cfg.presentDate;

    updateTableHeaders();
    marketQuotes = Array.isArray(saved.quotes) ? saved.quotes : [];
    renderTable();

    (saved.portfolio || []).forEach(p => addPortfolioRow(p));
    refreshPortfolioMeta();
    return true;
}

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    syncActiveNav();
    updateTableHeaders();

    if (!restoreSession()) {
        loadSampleData();
        refreshPortfolioMeta();
    }

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const presentEl = document.getElementById('ca-present-date') || document.getElementById('ca-valuation-date');
    if (presentEl && !presentEl.value) presentEl.value = `${dd}-${mm}-${yyyy}`;

    ['trade-date', 'payment-freq', 'interpolation', 'cutoff-years'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', saveSession);
    });
    if (presentEl) presentEl.addEventListener('input', saveSession);
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
        saveSession();
    });
}

function updateTableHeaders() {
    if(!marketTableHead || !outputTableHead) return;
    const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
    if (curveType === 'Treasury') {
        marketTableHead.innerHTML = `
            <tr>
                <th style="width: 25%">Instrument</th><th style="width: 15%">Tenor</th><th style="width: 20%">Coupon (%)</th>
                <th style="width: 20%">Price</th><th style="width: 15%">Spread (bps)</th><th style="width: 5%">Actions</th>
            </tr>`;
        outputTableHead.innerHTML = `<tr><th>Instrument</th><th>Tenor</th><th class="col-hideable">Coupon</th><th class="col-hideable">Price</th><th class="col-hideable">Maturity</th><th>t (Years)</th><th>Discount Factor</th><th>Zero Rate</th><th>Status</th></tr>`;
    } else {
        marketTableHead.innerHTML = `
            <tr>
                <th style="width: 20%">Instrument</th><th style="width: 15%">Tenor</th><th style="width: 25%">Quote Type</th>
                <th style="width: 20%">Quote</th><th style="width: 15%">Spread (bps)</th><th style="width: 5%">Actions</th>
            </tr>`;
        outputTableHead.innerHTML = `<tr><th>Instrument</th><th>Tenor</th><th class="col-hideable">Quote Type</th><th class="col-hideable">Quote</th><th class="col-hideable">Maturity</th><th>t (Years)</th><th>Discount Factor</th><th>Zero Rate</th><th>Status</th></tr>`;
    }
}

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
    saveSession();
    showAlert(`Sample ${curveType} market data loaded for this tab.`, 'success');
}

if (sampleQuotesBtn) {
    sampleQuotesBtn.addEventListener('click', loadSampleData);
}

function downloadCSV(text, filename) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ---------- Market table render ----------
function renderTable() {
    if(!marketTableBody) return;
    marketTableBody.innerHTML = '';
    if (marketQuotes.length === 0) {
        marketTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px;">No market quotes. Add a row, load sample, or drop a file.</td></tr>`;
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

    const bind = (sel, field, cast) => document.querySelectorAll(sel).forEach(el =>
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', e => {
            const i = parseInt(e.target.dataset.index);
            marketQuotes[i][field] = cast ? cast(e.target.value) : e.target.value;
            saveSession();
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
            saveSession();
        }));
}

if (addRowBtn) {
    addRowBtn.addEventListener('click', () => {
        const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
        marketQuotes.push(curveType === 'Treasury'
            ? { Instrument: 'Note', Tenor: '', Coupon: 0.0, Price: 100.0, Spread: null }
            : { Instrument: 'Cash', Tenor: '', QuoteType: 'RATE', Quote: 0.0, Spread: null });
        renderTable();
        saveSession();
    });
}

if (clearTableBtn) {
    clearTableBtn.addEventListener('click', () => { marketQuotes = []; renderTable(); saveSession(); });
}

// ---------- File import (CSV / XLSX) for MARKET QUOTES ----------
if (importQuotesBtn && fileInput) {
    importQuotesBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });
}

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
        const base = { Instrument: (r.Instrument || '').trim(), Tenor: (r.Tenor || '').trim(), Spread: r.Spread === '' || r.Spread == null ? null : parseFloat(r.Spread) };
        if (curveType === 'Treasury') return { ...base, Coupon: parseFloat(r.Coupon) || 0.0, Price: parseFloat(r.Price) || 0.0 };
        return { ...base, QuoteType: (r.QuoteType || 'RATE').trim().toUpperCase(), Quote: parseFloat(r.Quote) || 0.0 };
    }).filter(r => r.Tenor);
    renderTable();
    saveSession();
    showAlert(`Imported ${marketQuotes.length} quotes.`, 'success');
}

function showAlert(message, type = 'info') {
    if (!alertContainer) return;
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.textContent = message;
    alertContainer.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

// ============================================================
// Multi-position portfolio table
// ============================================================
const portfolioTableBody = document.getElementById('portfolio-table-body');
const addPortfolioRowBtn = document.getElementById('add-portfolio-row');
const clearPortfolioBtn = document.getElementById('clear-portfolio');

function addPortfolioRow(data = {}) {
    if (!portfolioTableBody) return;
    const tr = document.createElement('tr');
    tr.className = 'portfolio-row';
    
    const pos = data.position || 'receiver';
    const badgeClass = pos === 'receiver' ? 'badge-rcv' : 'badge-pay';
    const badgeText = pos === 'receiver' ? 'Rcv Fixed' : 'Pay Fixed';
    const rateText = data.rate ? `@ ${data.rate}%` : '';
    
    const ticker = (data.ticker || '--').toUpperCase();
    const assetName = data.assetName || ticker;
    const assetType = data.assetClass || (ticker.includes('=F') ? 'Commodity' : 'Equity');
    
    tr.innerHTML = `
        <td class="col-idx row-index"></td>
        <td><span class="${badgeClass} port-position" data-val="${pos}" data-rate="${data.rate || ''}">${badgeText} ${rateText}</span></td>
        <td class="text-value port-notional">${data.notional ? formatWithCommas(data.notional.toString()) : '--'}</td>
        <td class="text-value port-tenor">${data.tenor ? data.tenor + 'Y' : '--'}</td>
        <td><span class="ticker-highlight port-ticker" data-val="${ticker}" data-class="${assetType.toLowerCase()}">${assetType}: ${assetName}</span></td>
        <td class="text-value port-frequency">${data.freq ? data.freq + 'x' : '--'}</td>
        <td class="text-value port-daycount">${data.daycount || '--'}</td>
        <td class="text-value port-trade-date">${data.tradeDate || '--'}</td>
        <td style="text-align:center;"><button class="btn btn-danger btn-sm del-port-row" title="Delete"><i class="fa-solid fa-trash-can"></i></button></td>`;

    tr.querySelector('.del-port-row').addEventListener('click', () => { 
        tr.remove(); 
        refreshPortfolioMeta(); 
    });
    
    portfolioTableBody.appendChild(tr);
    refreshPortfolioMeta();
}

function refreshPortfolioMeta() {
    if (!portfolioTableBody) return;
    const existingEmpty = portfolioTableBody.querySelector('.portfolio-empty-row');
    const rows = portfolioTableBody.querySelectorAll('tr.portfolio-row');

    if (rows.length === 0) {
        if (!existingEmpty) {
            portfolioTableBody.innerHTML = `<tr class="portfolio-empty-row"><td colspan="11">List is currently empty — add a cross-asset swap or upload your portfolio.</td></tr>`;
        }
    } else {
        if (existingEmpty) existingEmpty.remove();
        rows.forEach((tr, i) => { tr.querySelector('.row-index').textContent = i + 1; });
    }
    saveSession();
}

const importPortfolioFromRows = async (rows) => {
    let added = 0;
    const origHTML = addPortfolioRowBtn.innerHTML;
    addPortfolioRowBtn.innerHTML = '<span class="spinner" style="width:14px; height:14px; border-width:2px;"></span> Resolving names...';
    
    for (const r of rows) {
        const get = (obj, key) => {
            const k = Object.keys(obj).find(h => h.trim().toLowerCase().replace(/[\s_]/g, '') === key);
            return k ? obj[k] : '';
        };
        
        const ticker = (get(r, 'ticker') || '').trim().toUpperCase();
        if (!ticker) continue;

        let assetName = ticker;
        let assetType = ticker.includes('=F') ? 'Commodity' : 'Equity';

        try {
            const res = await fetch(`/api/resolve_ticker/${ticker}`);
            const meta = await res.json();
            if (meta.success) { assetName = meta.name; assetType = meta.type; }
        } catch(e) { console.error("Failed to resolve:", ticker); }

        addPortfolioRow({
            position: (get(r, 'position') || 'receiver').trim().toLowerCase(),
            notional: formatWithCommas(get(r, 'notional') || ''),
            rate: get(r, 'rate') || '',
            tenor: get(r, 'tenor') || '',
            freq: get(r, 'freq') || '2',
            daycount: (get(r, 'daycount') || 'ACT/365').trim().toUpperCase(),
            ticker: ticker,
            assetName: assetName,
            assetClass: assetType,
            tradeDate: get(r, 'tradedate') || ''
        });
        added++;
    }
    
    addPortfolioRowBtn.innerHTML = origHTML;
    showAlert(added > 0 ? `Imported ${added} position(s).` : 'No valid rows found.', added > 0 ? 'success' : 'danger');
};

const loadSamplePortfolioBtn = document.getElementById('load-sample-portfolio');
if (loadSamplePortfolioBtn) {
    loadSamplePortfolioBtn.addEventListener('click', async () => {
        portfolioTableBody.innerHTML = ''; 
        try {
            const res = await fetch('/api/sample_data/asset_swap_sample.csv');
            if (!res.ok) throw new Error("Could not find asset_swap_sample.csv in src/data/");
            const text = await res.text();
            await importPortfolioFromRows(parseCSV(text));
        } catch(e) {
            showAlert(e.message, 'danger');
        }
    });
}

if (addPortfolioRowBtn) {
    addPortfolioRowBtn.addEventListener('click', async () => {
        const data = {
            position: document.getElementById('entry-position').value,
            rate: document.getElementById('entry-rate').value,
            notional: document.getElementById('entry-notional').value,
            ticker: document.getElementById('entry-ticker').value.toUpperCase(),
            tenor: document.getElementById('entry-tenor').value,
            freq: document.getElementById('entry-freq').value,
            tradeDate: document.getElementById('entry-trade-date').value,
            daycount: document.getElementById('entry-daycount').value
        };
        
        if (!data.ticker) { showAlert('Please enter an Asset Ticker before adding.', 'danger'); return; }
        
        const origHTML = addPortfolioRowBtn.innerHTML;
        addPortfolioRowBtn.innerHTML = '<span class="spinner" style="width:14px; height:14px; border-width:2px;"></span>';
        
        try {
            const res = await fetch(`/api/resolve_ticker/${data.ticker}`);
            const meta = await res.json();
            data.assetName = meta.success ? meta.name : data.ticker;
            data.assetClass = meta.success ? meta.type : (data.ticker.includes('=F') ? 'Commodity' : 'Equity');
        } catch(e) {
            data.assetName = data.ticker;
            data.assetClass = data.ticker.includes('=F') ? 'Commodity' : 'Equity';
        }

        addPortfolioRowBtn.innerHTML = origHTML;
        addPortfolioRow(data);
        
        document.getElementById('entry-rate').value = '';
        document.getElementById('entry-notional').value = '';
        document.getElementById('entry-ticker').value = '';
        document.getElementById('entry-tenor').value = '';
        document.getElementById('entry-trade-date').value = '';
    });
}

const importPortfolioBtn = document.getElementById('import-portfolio');
const portfolioFileInput = document.getElementById('portfolio-file-input');
if (importPortfolioBtn && portfolioFileInput) {
    importPortfolioBtn.addEventListener('click', () => portfolioFileInput.click());
    portfolioFileInput.addEventListener('change', e => {
        if (!e.target.files.length) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const rows = parseCSV(ev.target.result);
            await importPortfolioFromRows(rows);
        };
        reader.readAsText(e.target.files[0]);
        portfolioFileInput.value = ''; 
    });
}

if (clearPortfolioBtn) clearPortfolioBtn.addEventListener('click', () => {
    portfolioTableBody.innerHTML = '';
    refreshPortfolioMeta();
});

const notionalInput = document.getElementById('entry-notional');
if (notionalInput) {
    notionalInput.addEventListener('input', e => { e.target.value = formatWithCommas(e.target.value); });
}

function serializePortfolio() {
    if (!portfolioTableBody) return [];
    return Array.from(portfolioTableBody.querySelectorAll('tr.portfolio-row')).map(row => {
        const posSpan = row.querySelector('.port-position');
        const tickerSpan = row.querySelector('.port-ticker');
        return {
            position: posSpan.dataset.val,
            rate: posSpan.dataset.rate,
            notional: row.querySelector('.port-notional').textContent.replace(/,/g, ''),
            tenor: row.querySelector('.port-tenor').textContent.replace('Y', ''),
            ticker: tickerSpan.dataset.val,
            assetClass: tickerSpan.dataset.class,
            freq: row.querySelector('.port-frequency').textContent.replace('x', ''),
            daycount: row.querySelector('.port-daycount').textContent,
            tradeDate: row.querySelector('.port-trade-date').textContent
        };
    });
}

// ============================================================
// CA-GATHER : Assemble payload & Calculate
// ============================================================
function gatherPortfolioData(presentDate) {
    return serializePortfolio()
        .filter(p => p.ticker && p.ticker.trim() !== '')
        .map(p => ({
            notional: parseFloat(p.notional) || 0,
            fixed_rate: parseFloat(p.rate) || 0,
            tenor_years: parseInt(p.tenor) || 0,
            frequency: parseInt(p.freq) || 2,
            position: p.position,
            ticker: p.ticker.trim().toUpperCase(),
            asset_class: p.assetClass,
            day_count: p.daycount,
            asset_trade_date: (p.tradeDate || '').trim(),
            present_date: presentDate
        }));
}

if (calculateBtn) {
    calculateBtn.addEventListener('click', async () => {
        if (marketQuotes.length === 0) { showAlert('Market quotes table is empty.', 'danger'); return; }

        const tradeDateEl = document.getElementById('trade-date');
        const tradeDate = tradeDateEl ? tradeDateEl.value.trim() : '';
        if (!/^\d{2}-\d{2}-\d{4}$/.test(tradeDate)) { showAlert('Curve Date must be DD-MM-YYYY.', 'danger'); return; }

        const presentDateEl = document.getElementById('ca-present-date') || document.getElementById('ca-valuation-date');
        const presentDate = presentDateEl ? presentDateEl.value.trim() : '';

        const portfolio = gatherPortfolioData(presentDate);
        if (portfolio.length === 0) { showAlert('Add at least one position with a ticker.', 'danger'); return; }

        for (const p of portfolio) {
            if (p.asset_trade_date && !/^\d{2}-\d{2}-\d{4}$/.test(p.asset_trade_date)) {
                showAlert(`Position ${p.ticker}: Trade Date must be DD-MM-YYYY (or blank for curve date).`, 'danger');
                return;
            }
        }

        const curveType = curveTypeSelect ? curveTypeSelect.value : 'OIS';
        
        const payload = {
            config: {
                curve_type: curveType,
                trade_date: tradeDate,
                day_count_convention: 'ACT/365',
                payment_frequency: parseInt(document.getElementById('payment-freq')?.value || 2),
                interpolation_method: document.getElementById('interpolation')?.value || 'Cubic Spline',
                futures_cutoff_years: parseFloat(document.getElementById('cutoff-years')?.value || 2.0)
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
                if (resultsContainer) resultsContainer.style.display = 'none';
                return;
            }

            calculationResults = data;
            curveValuationDate = parseDDMMYYYY(tradeDate);
            if (resultsContainer) resultsContainer.style.display = 'grid';
            renderOutputTable();
            renderCharts();
            renderValuationPanel(data.portfolio_results);
            drawCashflowChart(data.cashflows);
            renderCashflowTable(data.cashflows);
            saveSession();
            showAlert(`Priced ${portfolio.length} position(s) (${data.curves.method}).`, 'success');
            if (resultsContainer) resultsContainer.scrollIntoView({ behavior: 'smooth' });
        } catch (err) {
            showAlert(`Network error: ${err.message}. Is the Flask server running?`, 'danger');
        } finally {
            calculateBtn.disabled = false;
            calculateBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Calculate Cross-Asset NPV`;
        }
    });
}

// ============================================================
// CA-RENDERING : Output Tables & Charts
// ============================================================
function renderValuationPanel(pr) {
    if (!pr) return;
    const panel = document.getElementById('portfolio-results');
    const fmt = v => '$' + fmtMoney(v);

    document.getElementById('out-npv').textContent = fmt(pr.base_npv);
    document.getElementById('out-pvbp').textContent = fmt(pr.pvbp);

    const assets = pr.asset_details || [];
    const initEl = document.getElementById('ca-initial-price');
    const curEl = document.getElementById('ca-current-price');
    const sumEl = document.getElementById('ca-asset-summary');

    if (assets.length === 1) {
        const a = assets[0];
        initEl.textContent = '$' + fmtMoney(a.initial_price);
        curEl.textContent = '$' + fmtMoney(a.current_price);
        const ret = ((a.current_price / a.initial_price - 1) * 100).toFixed(2);
        sumEl.textContent = `${a.ticker} · spot return ${ret}% · div yield ${(a.dividend_yield * 100).toFixed(2)}%`;
    } else if (assets.length > 1) {
        initEl.textContent = `${assets.length} legs`;
        curEl.textContent = '—';
        sumEl.textContent = assets.map(a =>
            `${a.ticker} ${((a.current_price / a.initial_price - 1) * 100).toFixed(1)}%`).join('  ·  ');
    } else {
        initEl.textContent = '—'; curEl.textContent = '—'; sumEl.textContent = `${pr.positions_priced} position(s) priced`;
    }
    if (panel) panel.style.display = 'flex';
}

function renderOutputTable() {
    if(!outputTableBody) return;
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
            ? `<td class="col-hideable">${fmt4(k.coupon)}</td><td class="col-hideable">${fmt4(k.price)}</td>`
            : `<td class="col-hideable">${k.quote_type ?? '--'}</td><td class="col-hideable">${fmt4(k.quote)}</td>`;

        tr.innerHTML = `<td>${k.instrument}</td><td>${k.tenor}</td>${c2}
            <td class="col-hideable">${k.maturity_date ?? '--'}</td><td>${fmt4(k.t)}</td>
            <td>${fmt4(k.df)}</td><td>${k.zero_rate != null ? fmt4(k.zero_rate) + '%' : '--'}</td><td>${badge}</td>`;
        outputTableBody.appendChild(tr);
    });
}

const toggleKnotsBtn = document.getElementById('toggle-knots-table');
const outputTable = document.getElementById('output-table');
const resultsGridEl = document.getElementById('results-container');
let knotsExpanded = true;
if (toggleKnotsBtn && outputTable) {
    toggleKnotsBtn.addEventListener('click', () => {
        knotsExpanded = !knotsExpanded;
        // 1) hide the secondary columns so the narrower table stays readable
        outputTable.classList.toggle('knots-collapsed', !knotsExpanded);
        // 2) re-weight the results grid so the Valuation chart grows (skip on mobile)
        if (resultsGridEl) {
            const wide = window.matchMedia('(min-width: 993px)').matches;
            resultsGridEl.style.gridTemplateColumns = (!knotsExpanded && wide) ? '2fr 1fr' : '';
        }
        toggleKnotsBtn.innerHTML = knotsExpanded
            ? '<i class="fa-solid fa-compress"></i>' : '<i class="fa-solid fa-expand"></i>';
        toggleKnotsBtn.title = knotsExpanded ? 'Hide extra data' : 'Expand hidden data';
        setTimeout(() => { if (yieldChart) yieldChart.resize(); }, 380);
    });
}

const exportKnotsBtn = document.getElementById('export-knots');
if (exportKnotsBtn) exportKnotsBtn.addEventListener('click', () => {
    if (!calculationResults || !calculationResults.knots) { showAlert('Run a calculation first.', 'danger'); return; }
    const head = 'Instrument,Tenor,QuoteType,Quote,Maturity,t_Years,DiscountFactor,ZeroRate_pct,Status';
    const lines = calculationResults.knots.map(k => [
        k.instrument, k.tenor, k.quote_type ?? k.coupon ?? '', fmt4(k.quote ?? k.price),
        k.maturity_date ?? '', fmt4(k.t), fmt4(k.df), fmt4(k.zero_rate),
        k.error ? 'Error' : (k.skipped ? 'Skipped' : 'Active')
    ].join(','));
    downloadCSV([head, ...lines].join('\n'), 'crossasset_curve_knots.csv');
});

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function tToDateLabel(t) {
    if (!curveValuationDate || isNaN(t)) return t;
    const d = new Date(curveValuationDate.getTime() + t * 365.25 * 86400000);
    return `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}

function renderCharts() {
    if (!calculationResults || !calculationResults.curves) return;
    const canvas = document.getElementById('yield-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
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
                x: { type: 'linear', title: { display: true, text: 'Maturity Date', color: text }, grid: { color: grid }, ticks: { color: text, callback: v => tToDateLabel(v) } },
                y: { title: { display: true, text: yLabel, color: text }, grid: { color: grid }, ticks: { color: text } }
            },
            plugins: { legend: { labels: { color: text } }, tooltip: { callbacks: { title: items => items.length ? tToDateLabel(items[0].parsed.x) : '' } } }
        }
    });
}

if (showZeroRateBtn) showZeroRateBtn.addEventListener('click', () => { currentChartType = 'zero_rate'; showZeroRateBtn.classList.add('active'); showDfBtn.classList.remove('active'); renderCharts(); });
if (showDfBtn) showDfBtn.addEventListener('click', () => { currentChartType = 'discount_factor'; showDfBtn.classList.add('active'); showZeroRateBtn.classList.remove('active'); renderCharts(); });

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

    // Use formatNiceDate to get that clean "1 Jul '26" label
    const labels = cashflowData.map(d => formatNiceDate(d.date));
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
            grid: { drawOnChartArea: true, color: (c) => c.tick.value === 0 ? 'rgba(255,255,255,0.25)' : 'transparent', lineWidth: (c) => c.tick.value === 0 ? 2 : 1 },
            ticks: { color: '#94a3b8' }, min: -netBound, max: netBound
        };
    }

    cashflowChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'line', label: 'Cumulative PnL', data: cumulativeFlows, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 3, tension: 0.3, fill: true, yAxisID: 'y' },
                { type: 'bar', label: 'Net Period Cashflow', data: netFlows, backgroundColor: netFlows.map(v => v >= 0 ? '#10b981' : '#ef4444'), barThickness: 6, yAxisID: isCombined ? 'y' : 'y1' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, resizeDelay: 200, interaction: { mode: 'index', intersect: false }, scales, plugins: { legend: { labels: { color: '#94a3b8' } } } }
    });
}

// ---------- Toggle Logic for Seamless Expanding ----------
// Mirrors the Currency Swap behaviour: never hides the panel outright (doing so
// would also hide this very button), instead it re-weights the flex ratio so the
// chart grows and the schedule shrinks while staying on screen and clickable.
const toggleCfBtn = document.getElementById('toggle-cashflow-table');
const cfChartPanel = document.getElementById('cf-chart-panel');
const cfTablePanel = document.getElementById('cf-table-panel');
let cfTableExpanded = true;

if (toggleCfBtn && cfChartPanel && cfTablePanel) {
    toggleCfBtn.addEventListener('click', () => {
        cfTableExpanded = !cfTableExpanded;
        if (cfTableExpanded) {
            cfChartPanel.style.flex = '2';
            cfTablePanel.style.flex = '3';
            cfTablePanel.classList.remove('cf-collapsed');
            toggleCfBtn.innerHTML = '<i class="fa-solid fa-compress"></i>';
            toggleCfBtn.title = 'Shrink schedule';
        } else {
            cfChartPanel.style.flex = '5';
            cfTablePanel.style.flex = '2';
            cfTablePanel.classList.add('cf-collapsed');
            toggleCfBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
            toggleCfBtn.title = 'Restore schedule';
        }
        // Let the flex transition settle, then let Chart.js recompute canvas bounds
        setTimeout(() => {
            if (cashflowChart) cashflowChart.resize();
        }, 380);
    });
}


const CF_COLUMNS = [
    { key: 'date',           label: 'Payment Date',       fmt: formatNiceDate },
    { key: 'type',           label: 'Type',               fmt: v => v },
    { key: 'fixed_cashflow', label: 'Fixed Leg ($)',      fmt: fmtMoney },
    { key: 'asset_cashflow', label: 'Asset Leg ($)',      fmt: fmtMoney },
    { key: 'net_cashflow',   label: 'Net Cashflow ($)',   fmt: fmtMoney },
    { key: 'df',             label: 'DF',                 fmt: fmt4 },
    { key: 'pv',             label: 'PV of Net ($)',      fmt: fmtMoney },
    { key: 'cumulative',     label: 'Cumulative PnL ($)', fmt: fmtMoney }, // Column for Cumulative Cashflow
];

function activeCashflowColumns(cashflows) {
    if (!cashflows || !cashflows.length) return [];
    const present = new Set();
    cashflows.forEach(r => Object.keys(r).forEach(k => present.add(k)));
    return CF_COLUMNS.filter(c => present.has(c.key));
}

function renderCashflowTable(cashflows) {
    const head = document.getElementById('cashflows-table-head');
    const body = document.getElementById('cashflows-tbody');
    if (!head || !body) return;
    head.innerHTML = ''; body.innerHTML = '';
    if (!cashflows || cashflows.length === 0) return;

    const cols = activeCashflowColumns(cashflows);
    head.innerHTML = `<tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;

    cashflows.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = cols.map(c => {
            const v = row[c.key];
            const isNum = typeof v === 'number';
            const colour = (isNum && c.key !== 'df') ? ` style="color:${v >= 0 ? '#10b981' : '#ef4444'}; font-family: monospace;"` : '';
            return `<td${colour}>${c.fmt(v)}</td>`;
        }).join('');
        body.appendChild(tr);
    });
}