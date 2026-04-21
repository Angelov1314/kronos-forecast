/* ============================================================
   Kronos — 神奇九转 (TD Sequential) Overlay
   Rule:
     - Buy setup:  close[i] < close[i-4] for 9 consecutive bars → 1..9 below bar
     - Sell setup: close[i] > close[i-4] for 9 consecutive bars → 1..9 above bar
     - Setup breaks if a bar fails the comparison — count resets.
   Public:
     window.JiuzhuanOverlay
     - new JiuzhuanOverlay(container, chart, candleSeries)
     - .setData(candles)  → computes + redraws
     - .setEnabled(bool)  → show/hide
     - .latestSignal()    → { kind: 'buy'|'sell'|null, count, perfect }
   ============================================================ */

(function () {
  'use strict';

  function computeTDSequential(candles) {
    // Returns parallel array of { buyCount, sellCount } per bar (null if 0).
    const out = candles.map(() => ({ buy: 0, sell: 0 }));
    let buyStreak = 0, sellStreak = 0;
    for (let i = 0; i < candles.length; i++) {
      if (i < 4) { out[i] = { buy: 0, sell: 0 }; continue; }
      const c = candles[i].close;
      const c4 = candles[i - 4].close;
      if (c < c4) {
        buyStreak = Math.min(buyStreak + 1, 9);
        sellStreak = 0;
      } else if (c > c4) {
        sellStreak = Math.min(sellStreak + 1, 9);
        buyStreak = 0;
      } else {
        buyStreak = 0; sellStreak = 0;
      }
      out[i] = { buy: buyStreak, sell: sellStreak };
    }
    return out;
  }

  // "Perfect 9" validation per DeMark rule:
  //   Buy-9 perfect: low of bar 8 or 9 <= low of bar 6 and bar 7
  //   Sell-9 perfect: high of bar 8 or 9 >= high of bar 6 and bar 7
  function isPerfectBuy(candles, iNine) {
    if (iNine < 8) return false;
    const lo8 = candles[iNine - 1].low;
    const lo9 = candles[iNine].low;
    const lo6 = candles[iNine - 3].low;
    const lo7 = candles[iNine - 2].low;
    return (lo8 <= lo6 && lo8 <= lo7) || (lo9 <= lo6 && lo9 <= lo7);
  }
  function isPerfectSell(candles, iNine) {
    if (iNine < 8) return false;
    const hi8 = candles[iNine - 1].high;
    const hi9 = candles[iNine].high;
    const hi6 = candles[iNine - 3].high;
    const hi7 = candles[iNine - 2].high;
    return (hi8 >= hi6 && hi8 >= hi7) || (hi9 >= hi6 && hi9 >= hi7);
  }

  class JiuzhuanOverlay {
    constructor(container, chart, candleSeries) {
      this.container = container;
      this.chart = chart;
      this.candleSeries = candleSeries;
      this.candles = [];
      this.counts = [];
      this.enabled = false;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.assign(svg.style, {
        position: 'absolute', inset: '0',
        pointerEvents: 'none', zIndex: '6',
      });
      svg.setAttribute('class', 'jiuzhuan-overlay');
      container.appendChild(svg);
      this.svg = svg;

      const redraw = () => this._draw();
      chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
      const ro = new ResizeObserver(redraw);
      ro.observe(container);
      this._redraw = redraw;
    }

    setData(candles) {
      this.candles = candles ? candles.slice() : [];
      this.counts = computeTDSequential(this.candles);
      this._draw();
    }

    setEnabled(on) {
      this.enabled = !!on;
      this.svg.style.display = this.enabled ? '' : 'none';
      if (this.enabled) this._draw();
    }

    // Returns info about the latest active setup (not yet broken)
    latestSignal() {
      if (!this.counts.length) return { kind: null, count: 0, perfect: false };
      const last = this.counts[this.counts.length - 1];
      const iLast = this.counts.length - 1;
      if (last.buy > 0) {
        const perfect = last.buy === 9 && isPerfectBuy(this.candles, iLast);
        return { kind: 'buy', count: last.buy, perfect, index: iLast };
      }
      if (last.sell > 0) {
        const perfect = last.sell === 9 && isPerfectSell(this.candles, iLast);
        return { kind: 'sell', count: last.sell, perfect, index: iLast };
      }
      return { kind: null, count: 0, perfect: false };
    }

    // Average true range over last `period` bars
    atr(period = 14) {
      const c = this.candles;
      if (c.length < 2) return 0;
      const n = Math.min(period, c.length - 1);
      let sum = 0;
      for (let i = c.length - n; i < c.length; i++) {
        const tr = Math.max(
          c[i].high - c[i].low,
          Math.abs(c[i].high - c[i - 1].close),
          Math.abs(c[i].low - c[i - 1].close)
        );
        sum += tr;
      }
      return sum / n;
    }

    // Generate 1d / 3d / 7d trading advice based on current signal + ATR.
    // Pure heuristic, intentionally simple — caller formats for display.
    tradingAdvice() {
      const sig = this.latestSignal();
      const last = this.candles[this.candles.length - 1];
      if (!last) return null;
      const price = last.close;
      const atr = this.atr(14);
      if (!atr) return null;

      // Trend bias: positive if recent 5-bar close > 20-bar SMA, else negative
      const n = this.candles.length;
      const sma20 = n >= 20
        ? this.candles.slice(-20).reduce((s, c) => s + c.close, 0) / 20
        : price;
      const sma5 = n >= 5
        ? this.candles.slice(-5).reduce((s, c) => s + c.close, 0) / 5
        : price;
      const trendUp = sma5 > sma20;

      // Build advice by kind
      let kind = 'neutral';
      let action = null;
      let direction = 0; // +1 long, -1 short, 0 wait
      let strength = 0;  // 0..1

      if (sig.kind === 'buy' && sig.count >= 7) {
        kind = 'buy';
        direction = +1;
        strength = Math.min(1, (sig.count - 6) / 3) + (sig.perfect ? 0.2 : 0);
        action = sig.count === 9
          ? (sig.perfect ? 'strongBuy' : 'buy')
          : 'watchBuy';
      } else if (sig.kind === 'sell' && sig.count >= 7) {
        kind = 'sell';
        direction = -1;
        strength = Math.min(1, (sig.count - 6) / 3) + (sig.perfect ? 0.2 : 0);
        action = sig.count === 9
          ? (sig.perfect ? 'strongSell' : 'sell')
          : 'watchSell';
      } else {
        kind = 'neutral';
        direction = trendUp ? +0.3 : -0.3;
        strength = 0;
        action = trendUp ? 'holdUp' : 'holdDown';
      }

      // Targets: ATR-based multipliers
      const mkTarget = (mult) => {
        if (direction === 0) return { tp: null, sl: null };
        return {
          tp: price + direction * mult * atr,
        };
      };

      const t1 = mkTarget(0.8);
      const t3 = mkTarget(1.8);
      const t7 = mkTarget(3.0);

      // Stop loss: recent swing low (buy) / swing high (sell)
      const look = Math.min(10, this.candles.length);
      let sl = null;
      if (direction > 0) {
        sl = Math.min(...this.candles.slice(-look).map(c => c.low)) - 0.3 * atr;
      } else if (direction < 0) {
        sl = Math.max(...this.candles.slice(-look).map(c => c.high)) + 0.3 * atr;
      }

      return {
        kind, action, direction, strength,
        price, atr,
        trendUp,
        signal: sig,
        targets: {
          '1d': t1.tp, '3d': t3.tp, '7d': t7.tp,
        },
        stopLoss: sl,
      };
    }

    // Find all completed 9-count setups in the series.
    allCompletedNines() {
      const res = [];
      for (let i = 0; i < this.counts.length; i++) {
        if (this.counts[i].buy === 9) {
          res.push({ kind: 'buy', index: i, perfect: isPerfectBuy(this.candles, i) });
        }
        if (this.counts[i].sell === 9) {
          res.push({ kind: 'sell', index: i, perfect: isPerfectSell(this.candles, i) });
        }
      }
      return res;
    }

    _draw() {
      const svg = this.svg;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      if (!this.enabled || !this.candles.length) return;

      const ts = this.chart.timeScale();
      const cs = this.candleSeries;
      const mk = (tag, attrs, text) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        if (text != null) el.textContent = text;
        return el;
      };

      for (let i = 0; i < this.candles.length; i++) {
        const cnt = this.counts[i];
        if (!cnt || (cnt.buy === 0 && cnt.sell === 0)) continue;
        // DeMark convention: only render counts >= 6 to reduce visual clutter
        if (cnt.buy > 0 && cnt.buy < 6) continue;
        if (cnt.sell > 0 && cnt.sell < 6) continue;
        const c = this.candles[i];
        const x = ts.timeToCoordinate(c.time);
        if (x == null) continue;

        if (cnt.sell > 0) {
          // Number above the high
          const y = cs.priceToCoordinate(c.high);
          if (y == null) continue;
          const isNine = cnt.sell === 9;
          const perfect = isNine && isPerfectSell(this.candles, i);
          const fill = isNine ? (perfect ? '#ff5252' : '#f08282') : 'rgba(240,130,130,0.85)';
          const fontSize = isNine ? 13 : 10;
          const fontWeight = isNine ? 700 : 500;
          if (isNine) {
            svg.appendChild(mk('circle', {
              cx: x, cy: y - 12, r: 9,
              fill: 'rgba(255,82,82,0.15)', stroke: fill, 'stroke-width': 1,
            }));
          }
          svg.appendChild(mk('text', {
            x, y: y - 6, 'text-anchor': 'middle',
            fill, 'font-size': fontSize, 'font-weight': fontWeight,
            'font-family': 'DM Mono, monospace',
          }, String(cnt.sell)));
        } else if (cnt.buy > 0) {
          // Number below the low
          const y = cs.priceToCoordinate(c.low);
          if (y == null) continue;
          const isNine = cnt.buy === 9;
          const perfect = isNine && isPerfectBuy(this.candles, i);
          const fill = isNine ? (perfect ? '#4ade80' : '#78dca0') : 'rgba(120,220,160,0.85)';
          const fontSize = isNine ? 13 : 10;
          const fontWeight = isNine ? 700 : 500;
          if (isNine) {
            svg.appendChild(mk('circle', {
              cx: x, cy: y + 14, r: 9,
              fill: 'rgba(74,222,128,0.15)', stroke: fill, 'stroke-width': 1,
            }));
          }
          svg.appendChild(mk('text', {
            x, y: y + 18, 'text-anchor': 'middle',
            fill, 'font-size': fontSize, 'font-weight': fontWeight,
            'font-family': 'DM Mono, monospace',
          }, String(cnt.buy)));
        }
      }
    }
  }

  window.JiuzhuanOverlay = JiuzhuanOverlay;
})();
