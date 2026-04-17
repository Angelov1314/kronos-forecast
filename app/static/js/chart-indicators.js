/* ============================================================
   Kronos — Chart Indicators (reusable)
   Computes MA / Bollinger Bands and manages series on a
   Lightweight Charts instance.
   Public: window.IndicatorManager

   Usage: new IndicatorManager(chart, container?, candleSeries?)
   Passing container + candleSeries enables BB shaded-band overlay.
   ============================================================ */

(function () {
  'use strict';

  // --- Pure computation helpers ---
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0 || period > values.length) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function stddev(values, period, meanArr) {
    const out = new Array(values.length).fill(null);
    for (let i = 0; i < values.length; i++) {
      if (i < period - 1 || meanArr[i] == null) continue;
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) {
        s += Math.pow(values[j] - meanArr[i], 2);
      }
      out[i] = Math.sqrt(s / period);
    }
    return out;
  }

  // Palette for MA lines
  const MA_COLORS = {
    3:  '#78dca0',
    5:  '#8ecae6',
    10: '#e0c97f',
    20: '#f08282',
    30: '#c792ea',
    60: '#78dca0',
  };

  class IndicatorManager {
    constructor(chart, container = null, candleSeries = null) {
      this.chart = chart;
      this.container = container;
      this.candleSeries = candleSeries;
      this.candles = [];
      this.active = { ma: {}, bb: null };

      // BB overlay (SVG) — optional; only if container + candleSeries provided
      if (container && candleSeries) {
        this._buildBBOverlay();
        const redraw = () => this._drawBBOverlay();
        chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
        const ro = new ResizeObserver(redraw);
        ro.observe(container);
        this._bbRedraw = redraw;
      }
    }

    _buildBBOverlay() {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.assign(svg.style, {
        position: 'absolute', inset: '0',
        pointerEvents: 'none', zIndex: '5',
      });
      svg.setAttribute('class', 'bb-band-overlay');
      this.container.appendChild(svg);
      this._bbSvg = svg;
    }

    setData(candles) {
      this.candles = candles.slice();
      Object.keys(this.active.ma).map(p => parseInt(p)).forEach(period => {
        this._applyMA(period);
      });
      if (this.active.bb) {
        const { period, stddevMul } = this.active.bb.params;
        this._applyBB(period, stddevMul);
      }
    }

    toggleMA(period) {
      period = parseInt(period);
      if (!period || period < 2) return false;
      if (this.active.ma[period]) {
        this.chart.removeSeries(this.active.ma[period]);
        delete this.active.ma[period];
        return false;
      }
      this._applyMA(period);
      return true;
    }

    _applyMA(period) {
      if (this.active.ma[period]) {
        this.chart.removeSeries(this.active.ma[period]);
      }
      const closes = this.candles.map(c => c.close);
      const times = this.candles.map(c => c.time);
      const vals = sma(closes, period);

      const color = MA_COLORS[period] || '#b0b0ff';
      const line = this.chart.addLineSeries({
        color, lineWidth: 1.5, lineStyle: 0,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: `MA${period}`,
      });
      const data = [];
      for (let i = 0; i < times.length; i++) {
        if (vals[i] != null) data.push({ time: times[i], value: vals[i] });
      }
      line.setData(data);
      this.active.ma[period] = line;
    }

    toggleBB(period = 20, stddevMul = 2) {
      if (this.active.bb) {
        this._clearBB();
        return false;
      }
      this._applyBB(period, stddevMul);
      return true;
    }

    _clearBB() {
      if (!this.active.bb) return;
      if (this.active.bb.mid) this.chart.removeSeries(this.active.bb.mid);
      this.active.bb = null;
      if (this._bbSvg) while (this._bbSvg.firstChild) this._bbSvg.removeChild(this._bbSvg.firstChild);
    }

    _applyBB(period, stddevMul) {
      this._clearBB();
      const closes = this.candles.map(c => c.close);
      const times = this.candles.map(c => c.time);
      const mid = sma(closes, period);
      const sd = stddev(closes, period, mid);

      // Middle line (thin, subtle)
      const midSeries = this.chart.addLineSeries({
        color: 'rgba(224,201,127,0.55)', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        title: `BB(${period},${stddevMul})`,
      });
      const mData = [];
      const bandPoints = []; // { time, upper, lower }
      for (let i = 0; i < times.length; i++) {
        if (mid[i] != null && sd[i] != null) {
          mData.push({ time: times[i], value: mid[i] });
          bandPoints.push({
            time: times[i],
            upper: mid[i] + stddevMul * sd[i],
            lower: mid[i] - stddevMul * sd[i],
          });
        }
      }
      midSeries.setData(mData);

      this.active.bb = {
        mid: midSeries,
        bandPoints,
        params: { period, stddevMul },
      };
      this._drawBBOverlay();
    }

    _drawBBOverlay() {
      if (!this._bbSvg || !this.active.bb) return;
      const svg = this._bbSvg;
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const ts = this.chart.timeScale();
      const cs = this.candleSeries;
      const pts = this.active.bb.bandPoints;
      if (!pts.length) return;

      const upperPts = [], lowerPts = [];
      for (const p of pts) {
        const x = ts.timeToCoordinate(p.time);
        const yu = cs.priceToCoordinate(p.upper);
        const yl = cs.priceToCoordinate(p.lower);
        if (x == null || yu == null || yl == null) continue;
        upperPts.push([x, yu]);
        lowerPts.push([x, yl]);
      }
      if (upperPts.length < 2) return;

      // Build polygon: upper left-to-right, then lower right-to-left
      const poly = upperPts.concat(lowerPts.slice().reverse());
      const d = poly.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ') + ' Z';

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'rgba(224,201,127,0.12)');
      path.setAttribute('stroke', 'rgba(224,201,127,0.35)');
      path.setAttribute('stroke-width', '0.8');
      svg.appendChild(path);
    }

    clear() {
      Object.values(this.active.ma).forEach(s => this.chart.removeSeries(s));
      this.active.ma = {};
      this._clearBB();
    }

    isMAActive(period) { return !!this.active.ma[parseInt(period)]; }
    isBBActive() { return !!this.active.bb; }
  }

  window.IndicatorManager = IndicatorManager;
})();
