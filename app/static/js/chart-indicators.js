/* ============================================================
   Kronos — Chart Indicators (reusable)
   Computes MA / Bollinger Bands and manages series on a
   Lightweight Charts instance.
   Public: window.IndicatorManager
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
    5:  '#8ecae6',
    10: '#e0c97f',
    20: '#f08282',
    30: '#c792ea',
    60: '#78dca0',
  };

  class IndicatorManager {
    constructor(chart) {
      this.chart = chart;
      this.candles = [];
      // { ma: { [period]: lineSeries }, bb: { upper, mid, lower } }
      this.active = { ma: {}, bb: null };
    }

    setData(candles) {
      this.candles = candles.slice();
      // Re-compute all currently-active indicators
      Object.keys(this.active.ma).map(p => parseInt(p)).forEach(period => {
        this._applyMA(period);
      });
      if (this.active.bb) {
        const { period, stddevMul } = this.active.bb.params;
        this._applyBB(period, stddevMul);
      }
    }

    // Toggle MA on/off for a period (3..60)
    toggleMA(period) {
      period = parseInt(period);
      if (!period || period < 2) return false;
      if (this.active.ma[period]) {
        this.chart.removeSeries(this.active.ma[period]);
        delete this.active.ma[period];
        return false;  // removed
      }
      this._applyMA(period);
      return true;  // added
    }

    _applyMA(period) {
      // Remove old if exists
      if (this.active.ma[period]) {
        this.chart.removeSeries(this.active.ma[period]);
      }
      const closes = this.candles.map(c => c.close);
      const times = this.candles.map(c => c.time);
      const vals = sma(closes, period);

      const color = MA_COLORS[period] || '#b0b0ff';
      const line = this.chart.addLineSeries({
        color,
        lineWidth: 1.5,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: false,
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

    // Toggle Bollinger bands (default: 20, 2σ)
    toggleBB(period = 20, stddevMul = 2) {
      if (this.active.bb) {
        ['upper', 'mid', 'lower'].forEach(k => {
          if (this.active.bb[k]) this.chart.removeSeries(this.active.bb[k]);
        });
        this.active.bb = null;
        return false;
      }
      this._applyBB(period, stddevMul);
      return true;
    }

    _applyBB(period, stddevMul) {
      if (this.active.bb) {
        ['upper', 'mid', 'lower'].forEach(k => {
          if (this.active.bb[k]) this.chart.removeSeries(this.active.bb[k]);
        });
      }
      const closes = this.candles.map(c => c.close);
      const times = this.candles.map(c => c.time);
      const mid = sma(closes, period);
      const sd = stddev(closes, period, mid);

      const midSeries = this.chart.addLineSeries({
        color: 'rgba(224,201,127,0.85)', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        title: `BB(${period},${stddevMul})`,
      });
      const upper = this.chart.addLineSeries({
        color: 'rgba(224,201,127,0.45)', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      const lower = this.chart.addLineSeries({
        color: 'rgba(224,201,127,0.45)', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      const mData = [], uData = [], lData = [];
      for (let i = 0; i < times.length; i++) {
        if (mid[i] != null && sd[i] != null) {
          mData.push({ time: times[i], value: mid[i] });
          uData.push({ time: times[i], value: mid[i] + stddevMul * sd[i] });
          lData.push({ time: times[i], value: mid[i] - stddevMul * sd[i] });
        }
      }
      midSeries.setData(mData);
      upper.setData(uData);
      lower.setData(lData);
      this.active.bb = {
        upper, mid: midSeries, lower,
        params: { period, stddevMul },
      };
    }

    clear() {
      Object.values(this.active.ma).forEach(s => this.chart.removeSeries(s));
      this.active.ma = {};
      if (this.active.bb) {
        ['upper', 'mid', 'lower'].forEach(k => {
          if (this.active.bb[k]) this.chart.removeSeries(this.active.bb[k]);
        });
        this.active.bb = null;
      }
    }

    isMAActive(period) { return !!this.active.ma[parseInt(period)]; }
    isBBActive() { return !!this.active.bb; }
  }

  window.IndicatorManager = IndicatorManager;
})();
