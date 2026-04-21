/* ========================================================
   KRONOS — App Controller
   ======================================================== */

const API = '';

// ---- i18n ----
const I18N = {
  en: {
    playGame: 'Play Game', predict: 'Predict', watchlist: 'Watchlist',
    vol: 'Vol', mktCap: 'Mkt Cap', wk52H: '52w H', wk52L: '52w L', sector: 'Sector',
    forecastActive: 'Kronos Forecast Active', indicators: 'Indicators', draw: 'Draw',
    kronosForecast: 'Kronos Forecast', horizon: 'Horizon', model: 'Model',
    generateForecast: 'Generate Forecast', backtest: 'Backtest',
    backtestDesc: 'Pick a cutoff date. Model sees only data before it, then predicts forward. Compare with reality.',
    cutoffDate: 'Cutoff Date', predictForward: 'Predict Forward',
    runBacktest: 'Run Backtest', trending: 'Trending', loading: 'Loading...',
  },
  zh: {
    playGame: '预测小游戏', predict: '预测', watchlist: '自选',
    vol: '成交量', mktCap: '市值', wk52H: '52周高', wk52L: '52周低', sector: '板块',
    forecastActive: 'Kronos 预测已激活', indicators: '指标', draw: '画线',
    kronosForecast: 'Kronos 预测', horizon: '预测天数', model: '模型',
    generateForecast: '生成预测', backtest: '回测',
    backtestDesc: '选择一个截止日期。模型只能看到此日期之前的数据，然后向前预测。与实际对比。',
    cutoffDate: '截止日期', predictForward: '向前预测',
    runBacktest: '运行回测', trending: '热门', loading: '加载中...',
  },
};
let LANG = localStorage.getItem('kronos_lang') || 'zh';
function t(key) { return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key; }
function applyI18N() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    el.textContent = t(k);
  });
  const lb = document.getElementById('langBtnText');
  if (lb) lb.textContent = LANG === 'zh' ? 'EN' : '中文';
  document.documentElement.lang = LANG;
}
function toggleLang() {
  LANG = (LANG === 'zh') ? 'en' : 'zh';
  localStorage.setItem('kronos_lang', LANG);
  applyI18N();
}

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
let indicatorMgr = null;
let drawTools = null;
let jiuzhuan = null;
let jiuzhuanEnabled = false;

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  applyI18N();
  const lb = document.getElementById('langBtn');
  if (lb) lb.addEventListener('click', toggleLang);
  initChart();
  loadTicker('AAPL');
  loadTrending();
  initSearch();
  initControls();
  initAudio();
  initWatchlist();
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

  // Indicators + drawing tools (shared modules)
  if (window.IndicatorManager) indicatorMgr = new IndicatorManager(chart, container, candleSeries);
  if (window.ChartDrawTools) drawTools = new ChartDrawTools(container, chart, candleSeries);
  if (window.JiuzhuanOverlay) jiuzhuan = new JiuzhuanOverlay(container, chart, candleSeries);
  initMainToolbar();
  initJiuzhuanToggle();
}

function initJiuzhuanToggle() {
  const btn = document.getElementById('btnJiuzhuan');
  const card = document.getElementById('jiuzhuanCard');
  if (!btn || !card) return;
  btn.addEventListener('click', () => {
    jiuzhuanEnabled = !jiuzhuanEnabled;
    btn.classList.toggle('active', jiuzhuanEnabled);
    card.style.display = jiuzhuanEnabled ? '' : 'none';
    if (jiuzhuan) jiuzhuan.setEnabled(jiuzhuanEnabled);
    if (jiuzhuanEnabled) refreshJiuzhuanCard();
  });
}

function refreshJiuzhuanCard() {
  if (!jiuzhuan) return;
  const badge = document.getElementById('jzBadge');
  const curEl = document.getElementById('jzCurrent');
  const latestEl = document.getElementById('jzLatest9');
  const countEl = document.getElementById('jzSignalCount');
  const interp = document.getElementById('jzInterp');
  if (!badge) return;

  const sig = jiuzhuan.latestSignal();
  const nines = jiuzhuan.allCompletedNines();
  const zh = (typeof LANG !== 'undefined' && LANG === 'zh');

  if (sig.kind === 'buy') {
    badge.textContent = zh ? `买入·${sig.count}/9` : `Buy ${sig.count}/9`;
    badge.className = 'jz-badge jz-buy';
    curEl.textContent = zh
      ? `低九买入结构 进行中 (${sig.count}/9)${sig.perfect ? ' · 完美9' : ''}`
      : `Buy setup in progress (${sig.count}/9)${sig.perfect ? ' · Perfect 9' : ''}`;
  } else if (sig.kind === 'sell') {
    badge.textContent = zh ? `卖出·${sig.count}/9` : `Sell ${sig.count}/9`;
    badge.className = 'jz-badge jz-sell';
    curEl.textContent = zh
      ? `高九卖出结构 进行中 (${sig.count}/9)${sig.perfect ? ' · 完美9' : ''}`
      : `Sell setup in progress (${sig.count}/9)${sig.perfect ? ' · Perfect 9' : ''}`;
  } else {
    badge.textContent = zh ? '无' : 'None';
    badge.className = 'jz-badge';
    curEl.textContent = zh ? '暂无活跃九转结构' : 'No active setup';
  }

  const last9 = nines.length ? nines[nines.length - 1] : null;
  if (last9 && jiuzhuan.candles[last9.index]) {
    const bar = jiuzhuan.candles[last9.index];
    const barsAgo = jiuzhuan.candles.length - 1 - last9.index;
    const kind = last9.kind === 'buy' ? (zh ? '低九(买)' : 'Buy-9') : (zh ? '高九(卖)' : 'Sell-9');
    const perfect = last9.perfect ? (zh ? ' · 完美' : ' · Perfect') : '';
    latestEl.textContent = zh
      ? `${kind}${perfect} · ${barsAgo}根K线前 · 收盘 ${bar.close.toFixed(2)}`
      : `${kind}${perfect} · ${barsAgo} bars ago · close ${bar.close.toFixed(2)}`;
  } else {
    latestEl.textContent = zh ? '历史上无完整"9"计数' : 'No completed 9-count';
  }

  const buyN = nines.filter(n => n.kind === 'buy').length;
  const sellN = nines.filter(n => n.kind === 'sell').length;
  countEl.textContent = zh
    ? `买入 ${buyN} · 卖出 ${sellN}`
    : `Buy ${buyN} · Sell ${sellN}`;

  if (interp) {
    if (sig.kind === 'buy' && sig.count >= 7) {
      interp.textContent = zh
        ? `⚠ 低九买入结构接近完成 (${sig.count}/9)，注意潜在底部反弹信号${sig.perfect ? '（完美9已形成）' : ''}。`
        : `⚠ Buy setup nearing completion (${sig.count}/9). Potential bottom reversal${sig.perfect ? ' (Perfect 9)' : ''}.`;
    } else if (sig.kind === 'sell' && sig.count >= 7) {
      interp.textContent = zh
        ? `⚠ 高九卖出结构接近完成 (${sig.count}/9)，注意潜在顶部反转信号${sig.perfect ? '（完美9已形成）' : ''}。`
        : `⚠ Sell setup nearing completion (${sig.count}/9). Potential top reversal${sig.perfect ? ' (Perfect 9)' : ''}.`;
    } else {
      interp.textContent = zh
        ? '连续9根收盘价低于4根前为低九买入结构，反之为高九卖出结构。第9根带圆圈标记。'
        : 'Buy setup = 9 closes below close-4-bars-ago. Sell setup = 9 closes above. The 9th bar is circled.';
    }
  }
}

function initMainToolbar() {
  const tb = document.getElementById('mainChartToolbar');
  if (!tb) return;

  tb.querySelectorAll('[data-ind]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!indicatorMgr) return;
      const ind = btn.dataset.ind;
      if (ind === 'ma') {
        const period = parseInt(btn.dataset.period);
        btn.classList.toggle('active', indicatorMgr.toggleMA(period));
      } else if (ind === 'bb') {
        btn.classList.toggle('active', indicatorMgr.toggleBB(20, 2));
      }
    });
  });

  const addCustom = document.getElementById('mainCustomMAAdd');
  const customInput = document.getElementById('mainCustomMAInput');
  if (addCustom && customInput) {
    const doAdd = () => {
      const v = parseInt(customInput.value);
      if (!v || v < 3 || v > 200) return;
      if (!indicatorMgr) return;
      const on = indicatorMgr.toggleMA(v);
      const existing = tb.querySelector(`[data-ma-custom="${v}"]`);
      if (on && !existing) {
        const chip = document.createElement('button');
        chip.className = 'toolbar-btn active';
        chip.dataset.maCustom = v;
        chip.textContent = `MA${v} ✕`;
        chip.addEventListener('click', () => {
          indicatorMgr.toggleMA(v);
          chip.remove();
        });
        tb.querySelector('.toolbar-custom-ma').after(chip);
      } else if (!on && existing) {
        existing.remove();
      }
      customInput.value = '';
    };
    addCustom.addEventListener('click', doAdd);
    customInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  }

  const drawBtns = tb.querySelectorAll('[data-draw]');
  drawBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (!drawTools) return;
      const mode = btn.dataset.draw;
      const wasActive = btn.classList.contains('active');
      drawBtns.forEach(b => b.classList.remove('active'));
      if (wasActive) drawTools.setMode(null);
      else {
        btn.classList.add('active');
        drawTools.setMode(mode);
      }
    });
  });

  const undoBtn = document.getElementById('mainDrawUndo');
  if (undoBtn) undoBtn.addEventListener('click', () => drawTools && drawTools.undo());
  const clearBtn = document.getElementById('mainDrawClear');
  if (clearBtn) clearBtn.addEventListener('click', () => drawTools && drawTools.clear());
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

  updateFavBtn();
  renderWatchlist();

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

function isCNTicker(sym) {
  return /^\d{6}(\.(SH|SZ|BJ))?$/.test(sym);
}

function renderQuote(q) {
  document.getElementById('tickerSymbol').textContent = q.symbol;
  document.getElementById('tickerName').textContent = q.name || '';
  const prefix = q.currency === 'CNY' ? '¥' : '$';
  document.getElementById('tickerPrice').textContent = `${prefix}${Number(q.price).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;

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

  const candles = data.map(d => ({
    time: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
  candleSeries.setData(candles);

  volumeSeries.setData(data.map(d => ({
    time: d.time,
    value: d.volume,
    color: d.close >= d.open ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
  })));

  // Clear user drawings on ticker/period change; refresh indicators with new data
  if (drawTools) drawTools.clear();
  if (indicatorMgr) indicatorMgr.setData(candles);
  if (jiuzhuan) {
    jiuzhuan.setData(candles);
    if (jiuzhuanEnabled) refreshJiuzhuanCard();
  }

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
let currentMarket = 'us';

async function loadTrending(market) {
  if (market) currentMarket = market;
  const el = document.getElementById('trendingList');
  el.innerHTML = '<div class="trending-placeholder">Loading...</div>';
  try {
    const res = await fetch(`${API}/api/trending?market=${currentMarket}`).then(r => r.json());
    const isCN = currentMarket === 'cn';
    el.innerHTML = res.map(t => {
      const pct = t.changePct || 0;
      const sign = pct >= 0 ? '+' : '';
      const cls = pct >= 0 ? 'up' : 'down';
      const price = isCN ? `¥${Number(t.price).toFixed(2)}` : formatPrice(t.price);
      return `
        <div class="trending-item" data-sym="${t.symbol}">
          <span class="trending-sym">${t.symbol}</span>
          <span class="trending-name">${t.name}</span>
          <span class="trending-price">${price}</span>
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

// Market toggle buttons
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.market-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.market-btn.active')?.classList.remove('active');
      btn.classList.add('active');
      loadTrending(btn.dataset.market);
    });
  });
});

// ---- Watchlist ----
function getWatchlist() {
  try { return JSON.parse(localStorage.getItem('kronos_watchlist') || '[]'); } catch { return []; }
}
function saveWatchlist(list) {
  localStorage.setItem('kronos_watchlist', JSON.stringify(list));
}
function isInWatchlist(sym) {
  return getWatchlist().some(w => w.symbol === sym);
}
function toggleWatchlist() {
  const list = getWatchlist();
  const idx = list.findIndex(w => w.symbol === currentTicker);
  if (idx >= 0) {
    list.splice(idx, 1);
  } else {
    const name = document.getElementById('tickerName').textContent || '';
    list.push({ symbol: currentTicker, name });
  }
  saveWatchlist(list);
  updateFavBtn();
  renderWatchlist();
}
function updateFavBtn() {
  const btn = document.getElementById('favBtn');
  btn.classList.toggle('active', isInWatchlist(currentTicker));
}
function renderWatchlist() {
  const list = getWatchlist();
  const section = document.getElementById('watchlistSection');
  const container = document.getElementById('watchlistItems');
  if (list.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  container.innerHTML = list.map(w => `
    <div class="watchlist-item ${w.symbol === currentTicker ? 'current' : ''}" data-sym="${w.symbol}">
      <span class="wl-sym">${w.symbol}</span>
      <span class="wl-name">${w.name}</span>
      <button class="wl-remove" data-sym="${w.symbol}" title="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.watchlist-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.wl-remove')) return;
      loadTicker(el.dataset.sym);
    });
  });
  container.querySelectorAll('.wl-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sym = btn.dataset.sym;
      const list = getWatchlist().filter(w => w.symbol !== sym);
      saveWatchlist(list);
      updateFavBtn();
      renderWatchlist();
    });
  });
}

function initWatchlist() {
  document.getElementById('favBtn').addEventListener('click', toggleWatchlist);
  updateFavBtn();
  renderWatchlist();
}

// ---- Audio ----
function initAudio() {
  const btn = document.getElementById('audioToggle');
  const audio = document.getElementById('bgAudio');
  audio.volume = 0.35;
  let playing = false;

  const updateIcon = () => btn.classList.toggle('active', playing);
  const tryPlay = () => {
    audio.play().then(() => { playing = true; updateIcon(); }).catch(() => {});
  };

  btn.addEventListener('click', () => {
    if (playing) {
      audio.pause();
      playing = false;
      updateIcon();
    } else {
      tryPlay();
    }
  });

  // Default on: attempt autoplay, fall back to first-click unlock
  tryPlay();
  document.addEventListener('click', () => { if (!playing) tryPlay(); }, { once: true });
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
