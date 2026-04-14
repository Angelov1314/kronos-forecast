/* ========================================================
   KRONOS — App Controller
   ======================================================== */

const API = '';
let currentTicker = 'AAPL';
let chart = null;
let candleSeries = null;
let volumeSeries = null;
let predictionSeries = null;
let backtestActualSeries = null;
let backtestPredSeries = null;
let backtestCutoffLine = null;
let currentPeriod = '6mo';
let currentInterval = '1d';

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  loadTicker('AAPL');
  loadTrending();
  initSearch();
  initControls();
  initAudio();
});

// ---- Chart Setup ----
function initChart() {
  const container = document.getElementById('chartContainer');
  chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: 'rgba(255,255,255,0.4)',
      fontFamily: "'DM Mono', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.03)' },
      horzLines: { color: 'rgba(255,255,255,0.03)' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: 'rgba(142,202,230,0.3)', width: 1, style: 2, labelBackgroundColor: 'rgba(142,202,230,0.15)' },
      horzLine: { color: 'rgba(142,202,230,0.3)', width: 1, style: 2, labelBackgroundColor: 'rgba(142,202,230,0.15)' },
    },
    rightPriceScale: {
      borderColor: 'rgba(255,255,255,0.05)',
      scaleMargins: { top: 0.1, bottom: 0.2 },
    },
    timeScale: {
      borderColor: 'rgba(255,255,255,0.05)',
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { vertTouchDrag: false },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#4ade80',
    downColor: '#f87171',
    borderUpColor: '#4ade80',
    borderDownColor: '#f87171',
    wickUpColor: 'rgba(74,222,128,0.5)',
    wickDownColor: 'rgba(248,113,113,0.5)',
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.85, bottom: 0 },
  });

  chart.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
  });

  // Responsive resize
  const ro = new ResizeObserver(() => {
    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
  });
  ro.observe(container);
}

// ---- Load Ticker ----
async function loadTicker(ticker) {
  currentTicker = ticker.toUpperCase();
  document.getElementById('tickerSymbol').textContent = currentTicker;

  // Clear old overlays
  if (predictionSeries) { chart.removeSeries(predictionSeries); predictionSeries = null; }
  if (backtestActualSeries) { chart.removeSeries(backtestActualSeries); backtestActualSeries = null; }
  if (backtestPredSeries) { chart.removeSeries(backtestPredSeries); backtestPredSeries = null; }
  document.getElementById('predBadge').style.display = 'none';
  document.getElementById('predictResult').innerHTML = '';
  document.getElementById('backtestResult').innerHTML = '';

  // Fetch quote + history in parallel
  const [quoteRes, histRes] = await Promise.all([
    fetch(`${API}/api/quote/${ticker}`).then(r => r.json()).catch(() => null),
    fetch(`${API}/api/history/${ticker}?period=${currentPeriod}&interval=${currentInterval}`).then(r => r.json()).catch(() => null),
  ]);

  if (quoteRes && !quoteRes.error) {
    renderQuote(quoteRes);
  } else {
    document.getElementById('tickerName').textContent = 'Ticker not found';
    document.getElementById('tickerPrice').textContent = '—';
    document.getElementById('tickerChange').textContent = '';
    document.getElementById('tickerChange').className = 'ticker-change';
  }
  if (histRes && !histRes.error) {
    renderChart(histRes.data);
  } else {
    candleSeries.setData([]);
    volumeSeries.setData([]);
  }
}

function renderQuote(q) {
  document.getElementById('tickerSymbol').textContent = q.symbol;
  document.getElementById('tickerName').textContent = q.name || '';
  document.getElementById('tickerPrice').textContent = formatPrice(q.price, q.currency);

  const chgEl = document.getElementById('tickerChange');
  const pct = q.changePct || 0;
  const sign = pct >= 0 ? '+' : '';
  chgEl.textContent = `${sign}${pct.toFixed(2)}%`;
  chgEl.className = `ticker-change ${pct >= 0 ? 'up' : 'down'}`;

  document.getElementById('statVol').textContent = formatNumber(q.volume);
  document.getElementById('statCap').textContent = formatMarketCap(q.marketCap);
  document.getElementById('stat52H').textContent = formatPrice(q.high52w);
  document.getElementById('stat52L').textContent = formatPrice(q.low52w);
  document.getElementById('statSector').textContent = q.sector || '—';
}

function renderChart(data) {
  if (!data || data.length === 0) return;

  candleSeries.setData(data.map(d => ({
    time: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  })));

  volumeSeries.setData(data.map(d => ({
    time: d.time,
    value: d.volume,
    color: d.close >= d.open ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
  })));

  chart.timeScale().fitContent();
}

// ---- Search ----
function initSearch() {
  const input = document.getElementById('searchInput');
  const dropdown = document.getElementById('searchDropdown');
  let debounce = null;

  // Keyboard shortcut: / to focus
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    }
    if (e.key === 'Escape') {
      input.blur();
      dropdown.classList.remove('open');
    }
  });

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (q.length < 1) { dropdown.classList.remove('open'); return; }
    debounce = setTimeout(async () => {
      const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => []);
      if (res.length === 0) { dropdown.classList.remove('open'); return; }
      dropdown.innerHTML = res.map(r => `
        <div class="search-item" data-sym="${r.symbol}">
          <div><span class="search-item-sym">${r.symbol}</span><span class="search-item-name">${r.name}</span></div>
        </div>
      `).join('');
      dropdown.classList.add('open');

      dropdown.querySelectorAll('.search-item').forEach(el => {
        el.addEventListener('click', () => {
          loadTicker(el.dataset.sym);
          input.value = '';
          dropdown.classList.remove('open');
        });
      });
    }, 250);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = input.value.trim().toUpperCase();
      if (q) { loadTicker(q); input.value = ''; dropdown.classList.remove('open'); }
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-area')) dropdown.classList.remove('open');
  });
}

// ---- Controls ----
function initControls() {
  // Period buttons
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.period-btn.active')?.classList.remove('active');
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      currentInterval = btn.dataset.interval;
      loadTicker(currentTicker);
    });
  });

  // Predict range slider
  const slider = document.getElementById('predLen');
  const sliderVal = document.getElementById('predLenVal');
  slider.addEventListener('input', () => {
    sliderVal.textContent = `${slider.value}d`;
  });

  // Run prediction
  document.getElementById('runPredict').addEventListener('click', runPrediction);
  document.getElementById('btnPredict').addEventListener('click', runPrediction);

  // Backtest range slider
  const btSlider = document.getElementById('backtestLen');
  const btSliderVal = document.getElementById('backtestLenVal');
  btSlider.addEventListener('input', () => { btSliderVal.textContent = `${btSlider.value}d`; });

  // Set default cutoff to 30 days ago
  const defaultCutoff = new Date();
  defaultCutoff.setDate(defaultCutoff.getDate() - 30);
  document.getElementById('backtestCutoff').value = defaultCutoff.toISOString().split('T')[0];

  // Run backtest
  document.getElementById('runBacktest').addEventListener('click', runBacktest);
}

// ---- Prediction ----
async function runPrediction() {
  const btn = document.getElementById('runPredict');
  const loader = document.getElementById('predictLoader');
  const btnText = btn.querySelector('.predict-btn-text');
  const resultEl = document.getElementById('predictResult');
  const predLen = document.getElementById('predLen').value;

  btnText.textContent = 'Generating...';
  loader.style.display = 'block';
  btn.disabled = true;
  resultEl.innerHTML = '';

  try {
    const res = await fetch(`${API}/api/predict/${currentTicker}?pred_len=${predLen}`);
    const data = await res.json();

    if (data.error) {
      resultEl.innerHTML = `<div style="color: var(--red);">${data.error}</div>`;
      return;
    }

    // Render prediction on chart
    if (predictionSeries) {
      chart.removeSeries(predictionSeries);
    }

    predictionSeries = chart.addCandlestickSeries({
      upColor: 'rgba(224,201,127,0.7)',
      downColor: 'rgba(224,201,127,0.35)',
      borderUpColor: 'rgba(224,201,127,0.9)',
      borderDownColor: 'rgba(224,201,127,0.5)',
      wickUpColor: 'rgba(224,201,127,0.5)',
      wickDownColor: 'rgba(224,201,127,0.3)',
    });

    predictionSeries.setData(data.predictions.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    })));

    document.getElementById('predBadge').style.display = 'flex';
    chart.timeScale().fitContent();

    // Summary
    const first = data.predictions[0];
    const last = data.predictions[data.predictions.length - 1];
    const chg = ((last.close - first.open) / first.open * 100);
    const direction = chg >= 0 ? 'up' : 'down';
    resultEl.innerHTML = `
      <div class="pred-summary">
        <div style="margin-bottom:6px; color: var(--gold);">Forecast: ${data.pred_len} periods</div>
        <div>Start: ${formatPrice(first.open)}</div>
        <div>End: ${formatPrice(last.close)}</div>
        <div class="pred-${direction}" style="margin-top:4px; font-weight:500;">
          ${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}% projected
        </div>
      </div>
    `;
  } catch (e) {
    resultEl.innerHTML = `<div style="color: var(--red);">Request failed: ${e.message}</div>`;
  } finally {
    btnText.textContent = 'Generate Forecast';
    loader.style.display = 'none';
    btn.disabled = false;
  }
}

// ---- Backtest ----
async function runBacktest() {
  const btn = document.getElementById('runBacktest');
  const loader = document.getElementById('backtestLoader');
  const btnText = btn.querySelector('.predict-btn-text');
  const resultEl = document.getElementById('backtestResult');
  const cutoff = document.getElementById('backtestCutoff').value;
  const predLen = document.getElementById('backtestLen').value;

  if (!cutoff) { resultEl.innerHTML = '<div style="color:var(--red)">Select a cutoff date</div>'; return; }

  btnText.textContent = 'Running...';
  loader.style.display = 'block';
  btn.disabled = true;
  resultEl.innerHTML = '';

  try {
    const res = await fetch(`${API}/api/backtest/${currentTicker}?cutoff=${cutoff}&pred_len=${predLen}`);
    const data = await res.json();

    if (data.error) {
      resultEl.innerHTML = `<div style="color:var(--red)">${data.error}</div>`;
      return;
    }

    // Clear existing overlays
    if (predictionSeries) { chart.removeSeries(predictionSeries); predictionSeries = null; }
    if (backtestActualSeries) { chart.removeSeries(backtestActualSeries); backtestActualSeries = null; }
    if (backtestPredSeries) { chart.removeSeries(backtestPredSeries); backtestPredSeries = null; }

    // Render history (before cutoff) as main candles
    candleSeries.setData(data.history.map(d => ({
      time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    })));
    volumeSeries.setData(data.history.map(d => ({
      time: d.time, value: d.volume,
      color: d.close >= d.open ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
    })));

    // Render actual data after cutoff (cyan)
    backtestActualSeries = chart.addCandlestickSeries({
      upColor: 'rgba(142,202,230,0.8)',
      downColor: 'rgba(142,202,230,0.4)',
      borderUpColor: 'rgba(142,202,230,1)',
      borderDownColor: 'rgba(142,202,230,0.6)',
      wickUpColor: 'rgba(142,202,230,0.5)',
      wickDownColor: 'rgba(142,202,230,0.3)',
    });
    backtestActualSeries.setData(data.actuals.map(d => ({
      time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    })));

    // Render predictions after cutoff (gold)
    backtestPredSeries = chart.addCandlestickSeries({
      upColor: 'rgba(224,201,127,0.7)',
      downColor: 'rgba(224,201,127,0.35)',
      borderUpColor: 'rgba(224,201,127,0.9)',
      borderDownColor: 'rgba(224,201,127,0.5)',
      wickUpColor: 'rgba(224,201,127,0.5)',
      wickDownColor: 'rgba(224,201,127,0.3)',
    });
    backtestPredSeries.setData(data.predictions.map(d => ({
      time: d.time, open: d.open, high: d.high, low: d.low, close: d.close,
    })));

    document.getElementById('predBadge').style.display = 'flex';
    document.getElementById('predBadge').querySelector('span:last-child').textContent = 'Backtest Active';
    chart.timeScale().fitContent();

    // Render metrics
    const m = data.metrics;
    const dirColor = m.direction_accuracy >= 50 ? 'var(--green)' : 'var(--red)';
    const actColor = m.actual_return >= 0 ? 'var(--green)' : 'var(--red)';
    const predColor = m.predicted_return >= 0 ? 'var(--green)' : 'var(--red)';
    resultEl.innerHTML = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">MAE</div>
          <div class="metric-value" style="color:var(--ice)">$${m.mae}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Direction</div>
          <div class="metric-value" style="color:${dirColor}">${m.direction_accuracy}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Actual</div>
          <div class="metric-value" style="color:${actColor}">${m.actual_return >= 0 ? '+' : ''}${m.actual_return}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Predicted</div>
          <div class="metric-value" style="color:${predColor}">${m.predicted_return >= 0 ? '+' : ''}${m.predicted_return}%</div>
        </div>
      </div>
      <div style="margin-top:10px; font-size:0.68rem; color:var(--text-tertiary);">
        <span style="color:rgba(142,202,230,0.8);">&#9632;</span> Actual &nbsp;
        <span style="color:rgba(224,201,127,0.8);">&#9632;</span> Predicted
      </div>
    `;
  } catch (e) {
    resultEl.innerHTML = `<div style="color:var(--red)">Request failed: ${e.message}</div>`;
  } finally {
    btnText.textContent = 'Run Backtest';
    loader.style.display = 'none';
    btn.disabled = false;
  }
}

// ---- Trending ----
async function loadTrending() {
  const el = document.getElementById('trendingList');
  try {
    const res = await fetch(`${API}/api/trending`).then(r => r.json());
    el.innerHTML = res.map(t => {
      const pct = t.changePct || 0;
      const sign = pct >= 0 ? '+' : '';
      const cls = pct >= 0 ? 'up' : 'down';
      return `
        <div class="trending-item" data-sym="${t.symbol}">
          <span class="trending-sym">${t.symbol}</span>
          <span class="trending-name">${t.name}</span>
          <span class="trending-price">${formatPrice(t.price)}</span>
          <span class="trending-chg ${cls}">${sign}${pct.toFixed(2)}%</span>
        </div>
      `;
    }).join('');

    el.querySelectorAll('.trending-item').forEach(item => {
      item.addEventListener('click', () => loadTicker(item.dataset.sym));
    });
  } catch {
    el.innerHTML = '<div class="trending-placeholder">Failed to load</div>';
  }
}

// ---- Audio ----
function initAudio() {
  const btn = document.getElementById('audioToggle');
  const audio = document.getElementById('bgAudio');
  audio.volume = 0.35;
  let playing = false;

  btn.addEventListener('click', () => {
    if (playing) {
      audio.pause();
      playing = false;
    } else {
      audio.play().catch(() => {});
      playing = true;
    }
    btn.classList.toggle('active', playing);
  });
}

// ---- Formatters ----
function formatPrice(n, currency) {
  if (!n || isNaN(n)) return '—';
  if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(6)}`;
}

function formatNumber(n) {
  if (!n) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatMarketCap(n) {
  if (!n) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}
