/* ============================================================
   Kronos — Chart Drawing Tools (reusable)
   Simple helper lines: trend (2pt), horizontal, vertical.
   Uses Lightweight Charts priceLine / custom series for horizontal,
   and an SVG overlay for trend & vertical lines.
   Public: window.ChartDrawTools
   ============================================================ */

(function () {
  'use strict';

  class ChartDrawTools {
    /**
     * @param {HTMLElement} container  — chart container (positioned)
     * @param {object}      chart      — Lightweight Charts instance
     * @param {object}      candleSeries — the candle series (for price conversions)
     */
    constructor(container, chart, candleSeries) {
      this.container = container;
      this.chart = chart;
      this.candleSeries = candleSeries;
      this.mode = null; // 'trend' | 'horizontal' | 'vertical' | null
      this.drawings = []; // { type, ...data, svgEls }
      this.pending = null; // { type, p1 } while picking second point
      this.svg = null;
      this._buildOverlay();
      this._bindEvents();
      this._subscribeChartRedraw();
    }

    _buildOverlay() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'chart-draw-helper-overlay');
      Object.assign(svg.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '12',
      });
      this.container.appendChild(svg);
      this.svg = svg;
    }

    _bindEvents() {
      this._onClick = (e) => this._handleClick(e);
      this._onMove = (e) => this._handleMove(e);
      this.container.addEventListener('click', this._onClick, true);
      this.container.addEventListener('mousemove', this._onMove, true);
    }

    _subscribeChartRedraw() {
      const redraw = () => this._redraw();
      this.chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
      const ro = new ResizeObserver(() => this._redraw());
      ro.observe(this.container);
      this._ro = ro;
    }

    // ---- Public API ----
    setMode(mode) {
      this.mode = mode;
      this.svg.style.pointerEvents = mode ? 'auto' : 'none';
      this.container.style.cursor = mode ? 'crosshair' : '';
      this.pending = null;
      this._redraw();
    }

    clear() {
      this.drawings = [];
      this.pending = null;
      this._redraw();
    }

    undo() {
      this.drawings.pop();
      this._redraw();
    }

    destroy() {
      this.container.removeEventListener('click', this._onClick, true);
      this.container.removeEventListener('mousemove', this._onMove, true);
      if (this._ro) this._ro.disconnect();
      if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
    }

    // ---- Event handlers ----
    _handleClick(e) {
      if (!this.mode) return;
      // Only respond to clicks inside the svg overlay (when enabled)
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const time = this.chart.timeScale().coordinateToTime(x);
      const price = this.candleSeries.coordinateToPrice(y);
      if (time == null || price == null) return;

      if (this.mode === 'horizontal') {
        this.drawings.push({ type: 'horizontal', price });
        this._redraw();
      } else if (this.mode === 'vertical') {
        this.drawings.push({ type: 'vertical', time });
        this._redraw();
      } else if (this.mode === 'trend') {
        if (!this.pending) {
          this.pending = { type: 'trend', p1: { time, price } };
        } else {
          this.drawings.push({ type: 'trend', p1: this.pending.p1, p2: { time, price } });
          this.pending = null;
          this._redraw();
        }
      }
      e.stopPropagation();
    }

    _handleMove(e) {
      if (!this.mode || !this.pending) return;
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = this.chart.timeScale().coordinateToTime(x);
      const price = this.candleSeries.coordinateToPrice(y);
      if (time == null || price == null) return;
      this._redraw({ time, price });
    }

    // ---- Rendering ----
    _redraw(pendingEnd = null) {
      const svg = this.svg;
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const ts = this.chart.timeScale();
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;

      for (const d of this.drawings) {
        this._drawOne(d);
      }
      if (this.pending && pendingEnd) {
        this._drawOne({ type: 'trend', p1: this.pending.p1, p2: pendingEnd, ghost: true });
      }
    }

    _drawOne(d) {
      const svg = this.svg;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      const ts = this.chart.timeScale();

      const mk = (tag, attrs) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        return el;
      };

      const stroke = d.ghost ? 'rgba(142,202,230,0.5)' : '#8ecae6';
      const strokeDash = d.ghost ? '4 4' : null;

      if (d.type === 'horizontal') {
        const y = this.candleSeries.priceToCoordinate(d.price);
        if (y == null) return;
        const line = mk('line', {
          x1: 0, x2: w, y1: y, y2: y,
          stroke, 'stroke-width': 1.2, 'stroke-dasharray': '6 4',
        });
        svg.appendChild(line);
        const label = mk('text', {
          x: w - 6, y: y - 4, 'text-anchor': 'end',
          fill: stroke, 'font-size': 11, 'font-family': 'DM Mono, monospace',
        });
        label.textContent = d.price.toFixed(2);
        svg.appendChild(label);
      } else if (d.type === 'vertical') {
        const x = ts.timeToCoordinate(d.time);
        if (x == null) return;
        const line = mk('line', {
          x1: x, x2: x, y1: 0, y2: h,
          stroke, 'stroke-width': 1.2, 'stroke-dasharray': '6 4',
        });
        svg.appendChild(line);
      } else if (d.type === 'trend') {
        const x1 = ts.timeToCoordinate(d.p1.time);
        const x2 = ts.timeToCoordinate(d.p2.time);
        const y1 = this.candleSeries.priceToCoordinate(d.p1.price);
        const y2 = this.candleSeries.priceToCoordinate(d.p2.price);
        if ([x1, x2, y1, y2].some(v => v == null)) return;
        const line = mk('line', {
          x1, x2, y1, y2, stroke, 'stroke-width': 1.5,
          ...(strokeDash ? { 'stroke-dasharray': strokeDash } : {}),
        });
        svg.appendChild(line);
        if (!d.ghost) {
          // Endpoint markers
          [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
            const c = mk('circle', {
              cx: p.x, cy: p.y, r: 3,
              fill: stroke, stroke: '#000', 'stroke-width': 0.5,
            });
            svg.appendChild(c);
          });
        }
      }
    }
  }

  window.ChartDrawTools = ChartDrawTools;
})();
