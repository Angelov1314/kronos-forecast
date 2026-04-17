/* ============================================================
   Kronos Game — Main Orchestrator
   State machine: IDLE -> LOADING -> AWAITING -> SUBMITTING -> REVEAL -> ... -> SUMMARY
   ============================================================ */

(function () {
  'use strict';

  // ---------- i18n ----------
  const I18N = {
    en: {
      gameMode: 'GAME MODE',
      back: 'Back to Forecast',
      mysteryStock: 'Mystery Stock',
      question: 'Question',
      totalScore: 'Total Score',
      avg: 'Avg',
      reset: 'Reset',
      submit: 'Submit',
      score: 'score',
      next: 'Next →',
      playAgain: 'Play Again',
      gameTitle: 'Prediction Game',
      gameIntro: 'The app shows you 30 days of a random stock. You predict what happens next. Score beats every baseline? Not easy.',
      difficulty: 'Difficulty',
      horizon: 'Horizon',
      roundSize: 'Questions per Round',
      blindMode: 'Blind Mode',
      blindModeHint: 'Hide ticker name AND date axis — pure chart reading. Everything revealed after submit.',
      begin: 'BEGIN',
      easy: 'Easy',
      medium: 'Medium',
      hard: 'Hard',
      easySub: 'DIRECTION + %',
      mediumSub: 'DRAW A LINE',
      hardSub: 'DRAW CANDLES',
      days3: '3 days',
      days7: '7 days',
      days30: '30 days',
      subShort: 'SHORT',
      subWeek: 'WEEK',
      subMonth: 'MONTH',
      pool5: '5',
      pool10: '10',
      pool20: '20',
      subQuick: 'QUICK',
      subStandard: 'STANDARD',
      subMarathon: 'MARATHON',
      yourPrediction: 'Your Prediction',
      priceGoHint: 'Over the next %d days, price will go:',
      drawLine: 'Draw the Line',
      drawLineHint: 'Drag the glowing handles on the chart to predict the close price for each of the next %d days.',
      drawCandles: 'Draw the Candles',
      drawCandlesHint: 'For each of the next %d days, drag the four handles to set high, low, open, and close.',
      cutoff: 'cutoff',
      horizonLabel: 'horizon: %dd · level: %s',
      daysShown: 'Question %d — 30 days shown',
      ticker: 'Ticker',
      revealed: 'Revealed',
      youSaid: 'You said',
      actual: 'Actual',
      error: 'Error',
      direction: 'Direction',
      directionMatched: '✓ matched',
      directionMissed: '✗ missed',
      rmse: 'RMSE',
      directionAccuracy: 'Direction accuracy',
      weightedRmse: 'Weighted RMSE',
      avgScore: 'Avg Score',
      accuracy: 'Accuracy',
      mode: 'Mode',
      failedStart: 'Failed to start game: ',
      failedQuestion: 'Failed to load question: ',
      failedSubmit: 'Submit failed: ',
      failedNext: 'Next failed: ',
      failedSummary: 'Summary failed: ',
      langButton: '中文',
    },
    zh: {
      gameMode: '游戏模式',
      back: '返回预测',
      mysteryStock: '神秘股票',
      question: '题目',
      totalScore: '总分',
      avg: '平均',
      reset: '重置',
      submit: '提交',
      score: '得分',
      next: '下一题 →',
      playAgain: '再玩一次',
      gameTitle: '预测游戏',
      gameIntro: '应用会显示某只随机股票前 30 天的走势。你来预测接下来的走势。能超过所有基线模型吗？没那么容易。',
      difficulty: '难度',
      horizon: '预测时长',
      roundSize: '每轮题数',
      blindMode: '盲盒模式',
      blindModeHint: '同时隐藏股票名称与时间轴 — 纯图表阅读。提交答案后完全揭晓。',
      begin: '开始',
      easy: '简单',
      medium: '中等',
      hard: '困难',
      easySub: '方向 + 涨跌幅',
      mediumSub: '画走势线',
      hardSub: '画K线',
      days3: '3 天',
      days7: '7 天',
      days30: '30 天',
      subShort: '短线',
      subWeek: '周线',
      subMonth: '月线',
      pool5: '5',
      pool10: '10',
      pool20: '20',
      subQuick: '速战',
      subStandard: '标准',
      subMarathon: '马拉松',
      yourPrediction: '你的预测',
      priceGoHint: '未来 %d 天内，价格将会：',
      drawLine: '画出走势线',
      drawLineHint: '拖动图表上的发光手柄，预测接下来 %d 天每天的收盘价。',
      drawCandles: '画出K线',
      drawCandlesHint: '为接下来的 %d 天，拖动四个手柄设置最高、最低、开盘和收盘价。',
      cutoff: '截止',
      horizonLabel: '时长: %d天 · 难度: %s',
      daysShown: '第 %d 题 — 显示 30 天',
      ticker: '股票代码',
      revealed: '揭晓',
      youSaid: '你的答案',
      actual: '实际值',
      error: '误差',
      direction: '方向',
      directionMatched: '✓ 正确',
      directionMissed: '✗ 错误',
      rmse: 'RMSE',
      directionAccuracy: '方向准确率',
      weightedRmse: '加权 RMSE',
      avgScore: '平均分',
      accuracy: '准确率',
      mode: '模式',
      failedStart: '启动游戏失败: ',
      failedQuestion: '加载题目失败: ',
      failedSubmit: '提交失败: ',
      failedNext: '加载下一题失败: ',
      failedSummary: '加载总结失败: ',
      langButton: 'EN',
    },
  };

  let LANG = localStorage.getItem('kronos_game_lang') || 'en';
  const t = (key) => (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
  const tf = (key, ...args) => {
    let s = t(key);
    args.forEach(a => { s = s.replace(/%[ds]/, a); });
    return s;
  };

  // ---------- State ----------
  const State = {
    sessionId: null,
    mode: { level: 1, horizon: 7, pool_size: 5, anonymous: false, blind: false },
    currentQ: null,
    totalScore: 0,
    scores: [],
    chart: null,
    candleSeries: null,
    truthSeries: null,
    drawOverlay: null,
    l1SliderValue: 0,
    setupCandlesFull: [],   // full setup for staggered reveal
    setupAnimating: false,
  };

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);

  // ---------- Utilities ----------
  function fmtPrice(p) {
    if (p == null) return '—';
    if (p >= 1000) return p.toFixed(0);
    if (p >= 100) return p.toFixed(1);
    if (p >= 1) return p.toFixed(2);
    return p.toFixed(4);
  }

  function levelName(n) {
    return ({ 1: t('easy'), 2: t('medium'), 3: t('hard') })[n] || '?';
  }

  function showLoader(show) {
    $('gameLoader').style.display = show ? 'flex' : 'none';
  }

  // ---------- i18n Application ----------
  function applyI18N() {
    // Mode modal
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = t(key);
    });
    // Lang button text
    const lb = $('langBtn');
    if (lb) lb.textContent = t('langButton');
    // Mode badge default
    if ($('modeBadgeText') && !State.sessionId) {
      $('modeBadgeText').textContent = t('gameMode');
    }
  }

  function toggleLang() {
    LANG = (LANG === 'en') ? 'zh' : 'en';
    localStorage.setItem('kronos_game_lang', LANG);
    applyI18N();
    // Re-render current screen chrome if applicable
    if (State.currentQ) {
      updateModeBadge();
      // Re-render answer area labels by re-setting up
      setupAnswerArea(State.currentQ);
      refreshQuestionHeader();
    }
  }

  function refreshQuestionHeader() {
    const q = State.currentQ;
    if (!q) return;
    $('gameTickerTitle').textContent =
      (State.mode.blind || State.mode.anonymous) ? t('mysteryStock') : q.ticker_name;
    const subAnon = tf('daysShown', (State.currentQIndex || 0) + 1);
    $('gameTickerSub').textContent =
      (State.mode.blind || State.mode.anonymous)
        ? subAnon
        : `${q.ticker_display} · ${t('cutoff')} ${q.cutoff_date}`;
    $('gameHorizonLabel').textContent = tf('horizonLabel', q.horizon, levelName(q.level));
  }

  // ---------- Mode Modal ----------
  function initModeModal() {
    const levelTiles = $('levelTiles');
    const horizonTiles = $('horizonTiles');
    const poolTiles = $('poolTiles');
    const blindSwitch = $('blindSwitch');
    const beginBtn = $('beginBtn');

    try {
      const saved = JSON.parse(localStorage.getItem('kronos_game_prefs') || '{}');
      if (saved.level) State.mode.level = saved.level;
      if (saved.horizon) State.mode.horizon = saved.horizon;
      if (saved.pool_size) State.mode.pool_size = saved.pool_size;
      if (saved.blind != null) State.mode.blind = saved.blind;
      if (saved.anonymous != null) State.mode.anonymous = saved.anonymous;
    } catch (_) {}

    function selectTile(container, selector, key, val) {
      container.querySelectorAll('.mode-tile').forEach(t => t.classList.remove('active'));
      const target = container.querySelector(selector);
      if (target) target.classList.add('active');
      State.mode[key] = val;
    }

    selectTile(levelTiles, `[data-level="${State.mode.level}"]`, 'level', State.mode.level);
    selectTile(horizonTiles, `[data-horizon="${State.mode.horizon}"]`, 'horizon', State.mode.horizon);
    selectTile(poolTiles, `[data-pool="${State.mode.pool_size}"]`, 'pool_size', State.mode.pool_size);
    if (State.mode.blind) blindSwitch.classList.add('on');

    levelTiles.querySelectorAll('.mode-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const v = parseInt(tile.dataset.level);
        selectTile(levelTiles, `[data-level="${v}"]`, 'level', v);
      });
    });
    horizonTiles.querySelectorAll('.mode-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const v = parseInt(tile.dataset.horizon);
        selectTile(horizonTiles, `[data-horizon="${v}"]`, 'horizon', v);
      });
    });
    poolTiles.querySelectorAll('.mode-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const v = parseInt(tile.dataset.pool);
        selectTile(poolTiles, `[data-pool="${v}"]`, 'pool_size', v);
      });
    });
    blindSwitch.addEventListener('click', () => {
      State.mode.blind = !State.mode.blind;
      // Blind implies anonymous
      State.mode.anonymous = State.mode.blind;
      blindSwitch.classList.toggle('on', State.mode.blind);
    });

    beginBtn.addEventListener('click', startGame);
  }

  function hideModeModal() {
    $('modeModal').style.display = 'none';
  }

  function showModeModal() {
    $('modeModal').style.display = 'flex';
    $('gameLayout').style.display = 'none';
    $('summaryShell').style.display = 'none';
  }

  // ---------- Chart ----------
  function initChart() {
    if (State.chart) return;
    const container = $('gameChartContainer');
    const chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: 'rgba(255,255,255,0.6)',
        fontFamily: "'DM Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 10,
        rightOffset: 2,
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(142, 202, 230, 0.35)', width: 1, style: 2 },
        horzLine: { color: 'rgba(142, 202, 230, 0.35)', width: 1, style: 2 },
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#78dca0',
      downColor: '#f08282',
      borderUpColor: '#78dca0',
      borderDownColor: '#f08282',
      wickUpColor: '#78dca0',
      wickDownColor: '#f08282',
    });

    State.chart = chart;
    State.candleSeries = candleSeries;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      if (State.drawOverlay) State.drawOverlay.rebuild();
    });
    ro.observe(container);

    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (State.drawOverlay) State.drawOverlay.rebuild();
    });
  }

  function applyChartBlindMode(blind) {
    if (!State.chart) return;
    State.chart.applyOptions({
      timeScale: {
        timeVisible: !blind,
        // Hide tick labels in blind mode by using an empty formatter
        tickMarkFormatter: blind ? () => '' : undefined,
      },
    });
  }

  // ---------- Game Flow ----------
  async function startGame() {
    localStorage.setItem('kronos_game_prefs', JSON.stringify(State.mode));

    hideModeModal();
    $('gameLayout').style.display = 'grid';

    initChart();

    State.totalScore = 0;
    State.scores = [];
    updateHUD();

    try {
      const res = await fetch('/api/game/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(State.mode),
      });
      if (!res.ok) throw new Error(`start failed: ${res.status}`);
      const data = await res.json();
      State.sessionId = data.session_id;

      updateModeBadge();
      await loadNextQuestion();
    } catch (err) {
      console.error(err);
      alert(t('failedStart') + err.message);
      showModeModal();
    }
  }

  function updateModeBadge() {
    const blind = State.mode.blind ? ' · BLIND' : '';
    $('modeBadgeText').textContent =
      `${levelName(State.mode.level)} · ${State.mode.horizon}D · ${State.mode.pool_size}Q${blind}`;
  }

  async function loadNextQuestion() {
    showLoader(true);
    try {
      const res = await fetch(`/api/game/question/${State.sessionId}`);
      if (!res.ok) throw new Error(`question failed: ${res.status}`);
      const data = await res.json();
      if (data.finished) {
        await showSummary();
        return;
      }
      State.currentQ = data.question;
      State.currentQIndex = data.index;
      renderQuestion(data);
    } catch (err) {
      console.error(err);
      alert(t('failedQuestion') + err.message);
    } finally {
      showLoader(false);
    }
  }

  function renderQuestion(data) {
    const q = data.question;

    // Apply blind mode axis options
    applyChartBlindMode(!!q.blind);

    // Title
    $('gameTickerTitle').textContent = q.ticker_name;
    $('gameTickerSub').textContent =
      (q.blind || q.anonymous)
        ? tf('daysShown', data.index + 1)
        : `${q.ticker_display} · ${t('cutoff')} ${q.cutoff_date}`;
    $('gameHorizonLabel').textContent = tf('horizonLabel', q.horizon, levelName(q.level));

    // HUD
    $('hudQIndex').textContent = `${data.index + 1} / ${data.total}`;
    $('hudProgress').style.width = `${(data.index / data.total) * 100}%`;

    // Prepare full candle data
    const candles = q.setup.map(c => ({
      time: c.time,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    State.setupCandlesFull = candles;

    // Clear existing truth overlay if any
    if (State.truthSeries) {
      State.chart.removeSeries(State.truthSeries);
      State.truthSeries = null;
    }

    // Hide reveal + any previous overlay first
    $('revealPanel').classList.remove('show');
    if (State.drawOverlay) {
      State.drawOverlay.destroy();
      State.drawOverlay = null;
    }

    // Set candle series to empty then animate draw-in
    State.candleSeries.setData([]);
    // Set visible range once using full data for a stable layout, then restart empty
    State.candleSeries.setData(candles);
    State.chart.timeScale().fitContent();
    // Now clear and animate staggered reveal
    State.candleSeries.setData([]);
    animateSetupReveal(candles).then(() => {
      // After animation, set up answer area + drawing overlay
      setupAnswerArea(q);
      requestAnimationFrame(() => {
        if (q.level === 2 || q.level === 3) {
          State.drawOverlay = new DrawOverlay($('drawOverlay'), {
            level: q.level,
            setup: q.setup,
            horizon: q.horizon,
            chart: State.chart,
            candleSeries: State.candleSeries,
          });
        }
      });
    });
  }

  function animateSetupReveal(candles) {
    return new Promise((resolve) => {
      State.setupAnimating = true;
      // Total animation ~800-1200ms across 30 candles — ~30ms stagger
      const stagger = Math.max(12, Math.min(40, Math.floor(600 / Math.max(1, candles.length))));
      let i = 0;
      const tick = () => {
        if (i > candles.length) {
          State.setupAnimating = false;
          resolve();
          return;
        }
        State.candleSeries.setData(candles.slice(0, i));
        i += 1;
        if (i <= candles.length) setTimeout(tick, stagger);
        else {
          State.setupAnimating = false;
          resolve();
        }
      };
      tick();
    });
  }

  function setupAnswerArea(q) {
    const area = $('answerArea');
    area.innerHTML = '';

    if (q.level === 1) {
      const maxPct = { 3: 20, 7: 30, 30: 80 }[q.horizon] || 30;
      State.l1SliderValue = 0;

      area.innerHTML = `
        <div class="l1-slider-group">
          <h4 class="answer-title">${t('yourPrediction')}</h4>
          <p class="answer-hint">${tf('priceGoHint', q.horizon)}</p>
          <div class="l1-value" id="l1ValueDisplay">0.0%</div>
          <input type="range" id="l1Slider" min="${-maxPct}" max="${maxPct}" step="0.1" value="0" class="glass-range">
          <div class="l1-range-labels">
            <span>−${maxPct}%</span>
            <span>0</span>
            <span>+${maxPct}%</span>
          </div>
        </div>
      `;

      const slider = $('l1Slider');
      const display = $('l1ValueDisplay');
      const update = () => {
        const v = parseFloat(slider.value);
        State.l1SliderValue = v;
        display.textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
        display.classList.toggle('pos', v > 0);
        display.classList.toggle('neg', v < 0);
      };
      slider.addEventListener('input', update);
      update();
    } else if (q.level === 2) {
      area.innerHTML = `
        <h4 class="answer-title">${t('drawLine')}</h4>
        <p class="answer-hint">${tf('drawLineHint', q.horizon)}</p>
      `;
    } else if (q.level === 3) {
      area.innerHTML = `
        <h4 class="answer-title">${t('drawCandles')}</h4>
        <p class="answer-hint">${tf('drawCandlesHint', q.horizon)}</p>
      `;
    }
  }

  async function submitAnswer() {
    if (!State.currentQ) return;
    if (State.setupAnimating) return;  // ignore until setup animation done
    const q = State.currentQ;

    let answer;
    if (q.level === 1) {
      answer = { predicted_pct: State.l1SliderValue };
    } else if (q.level === 2 || q.level === 3) {
      if (!State.drawOverlay) {
        alert('Drawing not ready');
        return;
      }
      answer = State.drawOverlay.getAnswer();
    }

    showLoader(true);
    try {
      const res = await fetch(`/api/game/submit/${State.sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qid: q.qid, answer }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'submit failed');
      }
      const data = await res.json();
      renderReveal(data);
    } catch (err) {
      console.error(err);
      alert(t('failedSubmit') + err.message);
    } finally {
      showLoader(false);
    }
  }

  function renderReveal(result) {
    // If blind mode, re-render setup with REAL timestamps so the reveal is truthful
    const blindReveal = State.mode.blind && result.setup_real;
    if (blindReveal) {
      // Restore real time axis
      applyChartBlindMode(false);
      const realCandles = result.setup_real.map(c => ({
        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      State.candleSeries.setData(realCandles);
      State.chart.timeScale().fitContent();
    }

    // Add truth candles in gold
    if (State.truthSeries) {
      State.chart.removeSeries(State.truthSeries);
    }
    State.truthSeries = State.chart.addCandlestickSeries({
      upColor: '#e0c97f',
      downColor: '#b8956a',
      borderUpColor: '#e0c97f',
      borderDownColor: '#b8956a',
      wickUpColor: '#e0c97f',
      wickDownColor: '#b8956a',
      priceLineVisible: false,
    });

    const truthCandles = result.truth.map(c => ({
      time: c.time,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));

    // Staggered reveal
    let idx = 0;
    const reveal = () => {
      if (idx > truthCandles.length) return;
      State.truthSeries.setData(truthCandles.slice(0, idx));
      idx++;
      if (idx <= truthCandles.length) {
        setTimeout(reveal, 120);
      }
    };
    reveal();

    if (State.drawOverlay) {
      State.drawOverlay.svg.classList.remove('active');
    }

    // If blind, update the title to reveal the stock
    if (State.mode.blind || State.mode.anonymous) {
      const rev = result.ticker_reveal || {};
      $('gameTickerTitle').textContent = rev.name || rev.symbol;
      $('gameTickerSub').textContent = `${rev.symbol} · ${t('cutoff')} ${rev.cutoff_date}`;
    }

    State.scores.push(result.score);
    State.totalScore = State.scores.reduce((a, b) => a + b, 0);
    updateHUD();

    setTimeout(() => {
      $('revealScore').textContent = '0';
      $('revealBreakdown').innerHTML = buildBreakdownHTML(result);
      $('revealPanel').classList.add('show');
      animateCountUp('revealScore', 0, result.score, 900);
    }, 200);
  }

  function buildBreakdownHTML(result) {
    const b = result.breakdown || {};
    const rev = result.ticker_reveal || {};
    const rows = [];
    if (State.mode.blind || State.mode.anonymous) {
      rows.push(`<div class="row"><span>${t('revealed')}</span><span class="v">${rev.symbol} · ${rev.cutoff_date}</span></div>`);
    } else {
      rows.push(`<div class="row"><span>${t('ticker')}</span><span class="v">${rev.symbol}</span></div>`);
    }
    if ('predicted_pct' in b) {
      rows.push(`<div class="row"><span>${t('youSaid')}</span><span class="v">${b.predicted_pct >= 0 ? '+' : ''}${b.predicted_pct}%</span></div>`);
      rows.push(`<div class="row"><span>${t('actual')}</span><span class="v">${b.actual_pct >= 0 ? '+' : ''}${b.actual_pct}%</span></div>`);
      rows.push(`<div class="row"><span>${t('error')}</span><span class="v">${b.error_pct}%</span></div>`);
      rows.push(`<div class="row"><span>${t('direction')}</span><span class="v">${b.direction_match ? t('directionMatched') : t('directionMissed')}</span></div>`);
    }
    if ('rmse_pct' in b) {
      rows.push(`<div class="row"><span>${t('rmse')}</span><span class="v">${b.rmse_pct}%</span></div>`);
      rows.push(`<div class="row"><span>${t('directionAccuracy')}</span><span class="v">${b.direction_accuracy_pct}%</span></div>`);
    }
    if ('weighted_rmse_pct' in b) {
      rows.push(`<div class="row"><span>${t('weightedRmse')}</span><span class="v">${b.weighted_rmse_pct}%</span></div>`);
      rows.push(`<div class="row"><span>${t('directionAccuracy')}</span><span class="v">${b.direction_accuracy_pct}%</span></div>`);
    }
    return rows.join('');
  }

  function animateCountUp(id, from, to, duration) {
    const el = $(id);
    const start = performance.now();
    function frame(t) {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = (from + (to - from) * eased).toFixed(1);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  async function nextQuestion() {
    showLoader(true);
    try {
      const res = await fetch(`/api/game/next/${State.sessionId}`, { method: 'POST' });
      if (!res.ok) throw new Error('next failed');
      const data = await res.json();

      if (data.finished) {
        await showSummary();
        return;
      }

      if (State.drawOverlay) {
        State.drawOverlay.destroy();
        State.drawOverlay = null;
      }
      if (State.truthSeries) {
        State.chart.removeSeries(State.truthSeries);
        State.truthSeries = null;
      }

      State.currentQ = data.question;
      State.currentQIndex = data.index;
      renderQuestion(data);
    } catch (err) {
      console.error(err);
      alert(t('failedNext') + err.message);
    } finally {
      showLoader(false);
    }
  }

  function updateHUD() {
    $('hudTotalScore').textContent = State.totalScore.toFixed(1);
    $('hudAvgScore').textContent = State.scores.length
      ? (State.totalScore / State.scores.length).toFixed(1)
      : '—';
  }

  async function showSummary() {
    $('gameLayout').style.display = 'none';
    $('summaryShell').style.display = 'block';

    try {
      const res = await fetch(`/api/game/summary/${State.sessionId}`);
      if (!res.ok) throw new Error('summary failed');
      const data = await res.json();
      renderSummary(data);
    } catch (err) {
      console.error(err);
      alert(t('failedSummary') + err.message);
    }
  }

  function renderSummary(data) {
    $('tierBadge').textContent = data.tier;
    $('tierBadge').className = 'tier-badge tier-' + data.tier;
    $('summaryTotal').textContent = data.total_score.toFixed(0);
    $('summaryMax').textContent = data.max_possible;
    $('summaryAvg').textContent = data.avg_score.toFixed(1);
    $('summaryAcc').textContent = data.accuracy_pct.toFixed(0) + '%';
    $('summaryLevel').textContent = `${levelName(data.mode.level)} · ${data.mode.horizon}D`;

    const list = $('summaryList');
    list.innerHTML = '';
    data.per_question.forEach(q => {
      const tier = q.score >= 70 ? '' : q.score >= 40 ? 'mid' : 'low';
      const row = document.createElement('div');
      row.className = 'summary-q-row';
      row.innerHTML = `
        <span class="summary-q-index">Q${q.index + 1}</span>
        <div>
          <div class="summary-q-ticker">${q.ticker}</div>
          <div class="summary-q-date">${q.ticker_name}</div>
        </div>
        <span class="summary-q-date">${q.cutoff_date}</span>
        <span class="summary-q-score ${tier}">${q.score.toFixed(1)}</span>
      `;
      list.appendChild(row);
    });
  }

  // ---------- Event Wiring ----------
  function initEvents() {
    $('submitBtn').addEventListener('click', submitAnswer);
    $('resetBtn').addEventListener('click', () => {
      if (State.drawOverlay) State.drawOverlay.reset();
      if (State.currentQ && State.currentQ.level === 1) {
        const s = $('l1Slider');
        if (s) {
          s.value = 0;
          s.dispatchEvent(new Event('input'));
        }
      }
    });
    $('nextQBtn').addEventListener('click', nextQuestion);
    $('playAgainBtn').addEventListener('click', () => {
      State.sessionId = null;
      showModeModal();
    });
    const lb = $('langBtn');
    if (lb) lb.addEventListener('click', toggleLang);
  }

  // ---------- Audio ----------
  function initAudio() {
    const audio = $('bgAudio');
    const toggle = $('audioToggle');
    if (!audio || !toggle) return;

    let playing = false;
    const tryPlay = () => {
      audio.volume = 0.3;
      audio.play().then(() => { playing = true; updateIcon(); }).catch(() => {});
    };

    const updateIcon = () => {
      toggle.classList.toggle('active', playing);
      toggle.style.opacity = playing ? '1' : '0.55';
    };

    toggle.addEventListener('click', () => {
      if (playing) { audio.pause(); playing = false; }
      else tryPlay();
      updateIcon();
    });

    document.addEventListener('click', tryPlay, { once: true });
    updateIcon();
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    applyI18N();
    initModeModal();
    initEvents();
    initAudio();
    showModeModal();
  });
})();
