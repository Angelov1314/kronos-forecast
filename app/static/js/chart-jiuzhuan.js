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
