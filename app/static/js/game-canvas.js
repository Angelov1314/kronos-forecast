/* ============================================================
   Kronos Game — SVG Drawing Overlay
   Handles Level 2 (line) and Level 3 (candles) drawing on top
   of the TradingView chart.

   Exports a single global: window.DrawOverlay = { init, destroy, getAnswer, reset }
   ============================================================ */

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      for (const k in attrs) {
        if (attrs[k] !== null && attrs[k] !== undefined) {
          e.setAttribute(k, attrs[k]);
        }
      }
    }
    return e;
  }

  /**
   * DrawOverlay — drawing state manager.
   *
   * @param {SVGElement} svg  Root SVG overlay element
   * @param {object} opts
   *   level: 2 | 3
   *   setup: array of setup candles [{time, open, high, low, close}...]
   *   horizon: int (number of days to draw)
   *   chart: TradingView chart instance (for coordinate mapping)
   *   candleSeries: the main candle series (for price scale)
   */
  class DrawOverlay {
    constructor(svg, opts) {
      this.svg = svg;
      this.opts = opts;
      this.level = opts.level;
      this.horizon = opts.horizon;
      this.setup = opts.setup;
      this.chart = opts.chart;
      this.candleSeries = opts.candleSeries;
      this.c0 = this.setup[this.setup.length - 1].close;

      // State: predicted values
      // L2: array of closes
      // L3: array of {o, h, l, c}
      if (this.level === 2) {
        this.points = Array(this.horizon).fill(this.c0);
      } else {
        this.candles = Array.from({ length: this.horizon }, () => ({
          o: this.c0, h: this.c0 * 1.01, l: this.c0 * 0.99, c: this.c0,
        }));
      }

      // Layout
      this.dragState = null;
      this.svg.classList.add('active');
      this.rebuild();

      // Re-layout on resize
      this._resizeHandler = () => this.rebuild();
      window.addEventListener('resize', this._resizeHandler);

      // Global drag handlers
      this._moveHandler = (e) => this.onMove(e);
      this._upHandler = (e) => this.onUp(e);
      window.addEventListener('mousemove', this._moveHandler);
      window.addEventListener('mouseup', this._upHandler);
      window.addEventListener('touchmove', this._moveHandler, { passive: false });
      window.addEventListener('touchend', this._upHandler);
    }

    destroy() {
      this.svg.classList.remove('active');
      this.svg.innerHTML = '';
      window.removeEventListener('resize', this._resizeHandler);
      window.removeEventListener('mousemove', this._moveHandler);
      window.removeEventListener('mouseup', this._upHandler);
      window.removeEventListener('touchmove', this._moveHandler);
      window.removeEventListener('touchend', this._upHandler);
    }

    reset() {
      if (this.level === 2) {
        this.points = Array(this.horizon).fill(this.c0);
      } else {
        this.candles = Array.from({ length: this.horizon }, () => ({
          o: this.c0, h: this.c0 * 1.01, l: this.c0 * 0.99, c: this.c0,
        }));
      }
      this.rebuild();
    }

    getAnswer() {
      if (this.level === 2) {
        return { predicted_closes: this.points.map(v => Number(v.toFixed(4))) };
      } else {
        return {
          predicted_candles: this.candles.map(c => ({
            o: Number(c.o.toFixed(4)),
            h: Number(c.h.toFixed(4)),
            l: Number(c.l.toFixed(4)),
            c: Number(c.c.toFixed(4)),
          })),
        };
      }
    }

    /**
     * Compute x-coordinate for future-day index i (0..horizon-1).
     * Future days are laid out to the right of the setup's last candle.
     */
    xForFuture(i) {
      // Use TradingView timeScale to find the last setup bar's x-coordinate
      const lastTime = this.setup[this.setup.length - 1].time;
      const firstTime = this.setup[0].time;

      const x0 = this.chart.timeScale().timeToCoordinate(firstTime);
      const xLast = this.chart.timeScale().timeToCoordinate(lastTime);

      if (xLast == null || x0 == null) {
        // Fallback: equal spacing across full SVG width
        const w = this.svg.clientWidth;
        const barW = w / (this.setup.length + this.horizon);
        return (this.setup.length + i + 0.5) * barW;
      }

      const barW = (xLast - x0) / Math.max(1, this.setup.length - 1);
      return xLast + (i + 1) * barW;
    }

    yForPrice(p) {
      const y = this.candleSeries.priceToCoordinate(p);
      if (y == null) {
        // fallback: use SVG height linear mapping
        const h = this.svg.clientHeight;
        return h / 2;
      }
      return y;
    }

    /** Inverse: SVG y-coord -> price */
    priceForY(y) {
      const p = this.candleSeries.coordinateToPrice(y);
      if (p == null) return this.c0;
      return Math.max(0.01, p);
    }

    /** Rebuild all SVG elements */
    rebuild() {
      this.svg.innerHTML = '';
      this.svg.setAttribute('width', this.svg.clientWidth);
      this.svg.setAttribute('height', this.svg.clientHeight);

      // Cutoff line
      const lastTime = this.setup[this.setup.length - 1].time;
      const xCutoff = this.chart.timeScale().timeToCoordinate(lastTime);
      if (xCutoff != null) {
        const h = this.svg.clientHeight;
        const line = el('line', {
          x1: xCutoff, x2: xCutoff, y1: 12, y2: h - 4,
          class: 'cutoff-line',
        });
        this.svg.appendChild(line);
        const label = el('text', {
          x: xCutoff + 6, y: 18,
          class: 'cutoff-label',
        });
        label.textContent = 'CUTOFF';
        this.svg.appendChild(label);
      }

      if (this.level === 2) this.renderLine();
      else this.renderCandles();
    }

    // ---------------- Level 2: line ----------------
    renderLine() {
      // Starting point anchored on c0 at cutoff
      const lastTime = this.setup[this.setup.length - 1].time;
      const x0 = this.chart.timeScale().timeToCoordinate(lastTime);
      const y0 = this.yForPrice(this.c0);

      const pts = [[x0, y0]];
      for (let i = 0; i < this.horizon; i++) {
        const x = this.xForFuture(i);
        const y = this.yForPrice(this.points[i]);
        pts.push([x, y]);
      }

      // Polyline
      const poly = el('polyline', {
        class: 'draw-line',
        points: pts.map(p => `${p[0]},${p[1]}`).join(' '),
      });
      this.svg.appendChild(poly);

      // Handles
      for (let i = 0; i < this.horizon; i++) {
        const [x, y] = pts[i + 1];
        const h = el('circle', {
          class: 'draw-handle',
          cx: x, cy: y, r: 5,
          'data-i': i,
          'data-kind': 'close',
        });
        h.addEventListener('mousedown', (e) => this.startDrag(e, i, 'close'));
        h.addEventListener('touchstart', (e) => this.startDrag(e, i, 'close'), { passive: false });
        this.svg.appendChild(h);

        // Price tooltip on handle
        const txt = el('text', {
          x: x + 8, y: y - 6,
          fill: 'rgba(255,255,255,0.7)',
          'font-family': "'DM Mono', monospace",
          'font-size': 10,
        });
        txt.textContent = this.points[i].toFixed(2);
        this.svg.appendChild(txt);
      }
    }

    // ---------------- Level 3: candles ----------------
    renderCandles() {
      for (let i = 0; i < this.horizon; i++) {
        const c = this.candles[i];
        const x = this.xForFuture(i);
        const yH = this.yForPrice(c.h);
        const yL = this.yForPrice(c.l);
        const yO = this.yForPrice(c.o);
        const yC = this.yForPrice(c.c);
        const bodyTop = Math.min(yO, yC);
        const bodyBot = Math.max(yO, yC);
        const up = c.c >= c.o;
        const bodyW = Math.max(6, Math.min(16, this.getBarWidth() * 0.6));

        // Wick
        const wick = el('line', {
          class: 'draw-candle-wick',
          x1: x, x2: x, y1: yH, y2: yL,
        });
        this.svg.appendChild(wick);

        // Body
        const body = el('rect', {
          class: 'draw-candle-body ' + (up ? 'up' : 'down'),
          x: x - bodyW / 2,
          y: bodyTop,
          width: bodyW,
          height: Math.max(2, bodyBot - bodyTop),
        });
        this.svg.appendChild(body);

        // Handles: H (top), L (bottom), O/C body-top, O/C body-bottom
        const mkHandle = (cx, cy, kind) => {
          const hEl = el('circle', {
            class: 'draw-handle',
            cx, cy, r: 4.5,
            'data-i': i,
            'data-kind': kind,
          });
          hEl.addEventListener('mousedown', (e) => this.startDrag(e, i, kind));
          hEl.addEventListener('touchstart', (e) => this.startDrag(e, i, kind), { passive: false });
          return hEl;
        };

        this.svg.appendChild(mkHandle(x, yH, 'high'));
        this.svg.appendChild(mkHandle(x, yL, 'low'));
        this.svg.appendChild(mkHandle(x - bodyW / 2, yO, 'open'));
        this.svg.appendChild(mkHandle(x + bodyW / 2, yC, 'close'));
      }
    }

    getBarWidth() {
      const firstTime = this.setup[0].time;
      const lastTime = this.setup[this.setup.length - 1].time;
      const x0 = this.chart.timeScale().timeToCoordinate(firstTime);
      const xLast = this.chart.timeScale().timeToCoordinate(lastTime);
      if (x0 == null || xLast == null) return 10;
      return (xLast - x0) / Math.max(1, this.setup.length - 1);
    }

    // ---------------- Drag handlers ----------------
    startDrag(e, i, kind) {
      e.preventDefault();
      e.stopPropagation();
      this.dragState = { i, kind };
    }

    onMove(e) {
      if (!this.dragState) return;
      e.preventDefault && e.preventDefault();
      const touch = e.touches && e.touches[0];
      const clientY = touch ? touch.clientY : e.clientY;
      const rect = this.svg.getBoundingClientRect();
      const y = clientY - rect.top;
      const price = this.priceForY(y);

      const { i, kind } = this.dragState;
      if (this.level === 2) {
        this.points[i] = price;
      } else {
        const c = this.candles[i];
        if (kind === 'high') c.h = Math.max(price, Math.max(c.o, c.c));
        else if (kind === 'low') c.l = Math.min(price, Math.min(c.o, c.c));
        else if (kind === 'open') {
          c.o = price;
          c.h = Math.max(c.h, c.o, c.c);
          c.l = Math.min(c.l, c.o, c.c);
        } else if (kind === 'close') {
          c.c = price;
          c.h = Math.max(c.h, c.o, c.c);
          c.l = Math.min(c.l, c.o, c.c);
        }
      }
      this.rebuild();
    }

    onUp() {
      this.dragState = null;
    }
  }

  window.DrawOverlay = DrawOverlay;
})();
