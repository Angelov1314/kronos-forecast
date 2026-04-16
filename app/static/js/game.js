/* ============================================================
   Kronos Game — Main Orchestrator
   State machine: IDLE -> LOADING -> AWAITING -> SUBMITTING -> REVEAL -> ... -> SUMMARY
   ============================================================ */

(function () {
  'use strict';

  // ---------- State ----------
  const State = {
    sessionId: null,
    mode: { level: 1, horizon: 7, pool_size: 5, anonymous: false },
    currentQ: null,       // current question object from server
    totalScore: 0,
    scores: [],           // per-question scores
    chart: null,
    candleSeries: null,
    truthSeries: null,    // added during reveal
    drawOverlay: null,    // DrawOverlay instance for L2/L3
    l1SliderValue: 0,     // Level 1 predicted_pct
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
    return ({ 1: 'Easy', 2: 'Medium', 3: 'Hard' })[n] || '?';
  }

  function showLoader(show) {
    $('gameLoader').style.display = show ? 'flex' : 'none';
  }

  // ---------- Mode Modal ----------
  function initModeModal() {
    const levelTiles = $('levelTiles');
    const horizonTiles = $('horizonTiles');
    const poolTiles = $('poolTiles');
    const anonSwitch = $('anonSwitch');
    const beginBtn = $('beginBtn');

    // Restore last preferences
    try {
      const saved = JSON.parse(localStorage.getItem('kronos_game_prefs') || '{}');
      if (saved.level) State.mode.level = saved.level;
      if (saved.horizon) State.mode.horizon = saved.horizon;
      if (saved.pool_size) State.mode.pool_size = saved.pool_size;
      if (saved.anonymous) State.mode.anonymous = saved.anonymous;
    } catch (_) {}

    // Helper to select tile
    function selectTile(container, selector, key, val) {
      container.querySelectorAll('.mode-tile').forEach(t => t.classList.remove('active'));
      const target = container.querySelector(selector);
      if (target) target.classList.add('active');
      State.mode[key] = val;
    }

    // Apply saved selections visually
    selectTile(levelTiles, `[data-level="${State.mode.level}"]`, 'level', State.mode.level);
    selectTile(horizonTiles, `[data-horizon="${State.mode.horizon}"]`, 'horizon', State.mode.horizon);
    selectTile(poolTiles, `[data-pool="${State.mode.pool_size}"]`, 'pool_size', State.mode.pool_size);
    if (State.mode.anonymous) anonSwitch.classList.add('on');

    // Wire up
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
    anonSwitch.addEventListener('click', () => {
      State.mode.anonymous = !State.mode.anonymous;
      anonSwitch.classList.toggle('on', State.mode.anonymous);
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

    // Resize
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      if (State.drawOverlay) State.drawOverlay.rebuild();
    });
    ro.observe(container);

    // Re-render overlay after chart finishes layout changes
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (State.drawOverlay) State.drawOverlay.rebuild();
    });
  }

  // ---------- Game Flow ----------
  async function startGame() {
    // Save preferences
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
      alert('Failed to start game: ' + err.message);
      showModeModal();
    }
  }

  function updateModeBadge() {
    $('modeBadgeText').textContent =
      `${levelName(State.mode.level)} · ${State.mode.horizon}D · ${State.mode.pool_size}Q`;
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
      renderQuestion(data);
    } catch (err) {
      console.error(err);
      alert('Failed to load question: ' + err.message);
    } finally {
      showLoader(false);
    }
  }

  function renderQuestion(data) {
    const q = data.question;

    // Title
    $('gameTickerTitle').textContent = q.ticker_name;
    $('gameTickerSub').textContent =
      State.mode.anonymous
        ? `Question ${data.index + 1} — 30 days shown`
        : `${q.ticker_display} · cutoff ${q.cutoff_date}`;
    $('gameHorizonLabel').textContent =
      `horizon: ${q.horizon}d · level: ${levelName(q.level)}`;

    // HUD
    $('hudQIndex').textContent = `${data.index + 1} / ${data.total}`;
    $('hudProgress').style.width = `${(data.index / data.total) * 100}%`;

    // Render setup candles
    const candles = q.setup.map(c => ({
      time: c.time,
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));

    // Clear existing truth overlay if any
    if (State.truthSeries) {
      State.chart.removeSeries(State.truthSeries);
      State.truthSeries = null;
    }

    State.candleSeries.setData(candles);
    State.chart.timeScale().fitContent();

    // Hide reveal
    $('revealPanel').classList.remove('show');

    // Set up drawing overlay / slider
    setupAnswerArea(q);

    // Wait one frame for chart to lay out, then init overlay
    requestAnimationFrame(() => {
      if (State.drawOverlay) {
        State.drawOverlay.destroy();
        State.drawOverlay = null;
      }
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
  }

  function setupAnswerArea(q) {
    const area = $('answerArea');
    area.innerHTML = '';

    if (q.level === 1) {
      // Slider for direction + magnitude
      const maxPct = { 3: 20, 7: 30, 30: 80 }[q.horizon] || 30;
      State.l1SliderValue = 0;

      area.innerHTML = `
        <div class="l1-slider-group">
          <h4 class="answer-title">Your Prediction</h4>
          <p class="answer-hint">Over the next ${q.horizon} days, price will go:</p>
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
        <h4 class="answer-title">Draw the Line</h4>
        <p class="answer-hint">Drag the glowing handles on the chart to predict the close price for each of the next ${q.horizon} days.</p>
      `;
    } else if (q.level === 3) {
      area.innerHTML = `
        <h4 class="answer-title">Draw the Candles</h4>
        <p class="answer-hint">For each of the next ${q.horizon} days, drag the four handles to set high, low, open, and close.</p>
      `;
    }
  }

  async function submitAnswer() {
    if (!State.currentQ) return;
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
      alert('Submit failed: ' + err.message);
    } finally {
      showLoader(false);
    }
  }

  function renderReveal(result) {
    // Add truth candles to chart in gold
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

    // Hide drawing overlay handles, keep shapes visible
    if (State.drawOverlay) {
      State.drawOverlay.svg.classList.remove('active');
    }

    // Update totals
    State.scores.push(result.score);
    State.totalScore = State.scores.reduce((a, b) => a + b, 0);
    updateHUD();

    // Show reveal card after truth animation starts
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
    if (!State.mode.anonymous) {
      rows.push(`<div class="row"><span>Ticker</span><span class="v">${rev.symbol}</span></div>`);
    } else {
      rows.push(`<div class="row"><span>Revealed</span><span class="v">${rev.symbol} · ${rev.cutoff_date}</span></div>`);
    }
    if ('predicted_pct' in b) {
      rows.push(`<div class="row"><span>You said</span><span class="v">${b.predicted_pct >= 0 ? '+' : ''}${b.predicted_pct}%</span></div>`);
      rows.push(`<div class="row"><span>Actual</span><span class="v">${b.actual_pct >= 0 ? '+' : ''}${b.actual_pct}%</span></div>`);
      rows.push(`<div class="row"><span>Error</span><span class="v">${b.error_pct}%</span></div>`);
      rows.push(`<div class="row"><span>Direction</span><span class="v">${b.direction_match ? '✓ matched' : '✗ missed'}</span></div>`);
    }
    if ('rmse_pct' in b) {
      rows.push(`<div class="row"><span>RMSE</span><span class="v">${b.rmse_pct}%</span></div>`);
      rows.push(`<div class="row"><span>Direction accuracy</span><span class="v">${b.direction_accuracy_pct}%</span></div>`);
    }
    if ('weighted_rmse_pct' in b) {
      rows.push(`<div class="row"><span>Weighted RMSE</span><span class="v">${b.weighted_rmse_pct}%</span></div>`);
      rows.push(`<div class="row"><span>Direction accuracy</span><span class="v">${b.direction_accuracy_pct}%</span></div>`);
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

      // Destroy overlay from previous question
      if (State.drawOverlay) {
        State.drawOverlay.destroy();
        State.drawOverlay = null;
      }
      if (State.truthSeries) {
        State.chart.removeSeries(State.truthSeries);
        State.truthSeries = null;
      }

      State.currentQ = data.question;
      renderQuestion(data);
    } catch (err) {
      console.error(err);
      alert('Next failed: ' + err.message);
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
      alert('Summary failed: ' + err.message);
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
  }

  // ---------- Audio (reused from main app) ----------
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

    // First user interaction
    document.addEventListener('click', tryPlay, { once: true });
    updateIcon();
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    initModeModal();
    initEvents();
    initAudio();
    showModeModal();
  });
})();
