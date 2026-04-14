"""
Kronos — Financial Forecasting Web App
Flask backend: yfinance data + Kronos model predictions
"""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from flask import Flask, render_template, jsonify, request, send_from_directory
from flask_cors import CORS
import yfinance as yf
import pandas as pd
import numpy as np
import json
from datetime import datetime, timedelta

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

# ---------- Kronos model (lazy-loaded) ----------
_predictor = None

def get_predictor():
    global _predictor
    if _predictor is None:
        try:
            from model import Kronos, KronosTokenizer, KronosPredictor
            tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
            model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
            _predictor = KronosPredictor(model, tokenizer, max_context=512)
            print("[Kronos] Model loaded successfully")
        except Exception as e:
            print(f"[Kronos] Model load failed: {e}")
    return _predictor

# ---------- Routes ----------

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/quote/<ticker>')
def get_quote(ticker):
    """Get current quote snapshot for a ticker."""
    try:
        t = yf.Ticker(ticker)
        info = t.info
        fast = t.fast_info
        return jsonify({
            'symbol': ticker.upper(),
            'name': info.get('shortName', info.get('longName', ticker.upper())),
            'price': fast.get('lastPrice', info.get('currentPrice', 0)),
            'change': info.get('regularMarketChange', 0),
            'changePct': info.get('regularMarketChangePercent', 0),
            'volume': fast.get('lastVolume', 0),
            'marketCap': info.get('marketCap', 0),
            'high52w': info.get('fiftyTwoWeekHigh', 0),
            'low52w': info.get('fiftyTwoWeekLow', 0),
            'sector': info.get('sector', ''),
            'currency': info.get('currency', 'USD'),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/history/<ticker>')
def get_history(ticker):
    """Get OHLCV history for charting."""
    period = request.args.get('period', '6mo')
    interval = request.args.get('interval', '1d')
    try:
        t = yf.Ticker(ticker)
        df = t.history(period=period, interval=interval)
        if df.empty:
            return jsonify({'error': 'No data found'}), 404

        records = []
        for ts, row in df.iterrows():
            records.append({
                'time': int(ts.timestamp()),
                'open': round(float(row['Open']), 4),
                'high': round(float(row['High']), 4),
                'low': round(float(row['Low']), 4),
                'close': round(float(row['Close']), 4),
                'volume': int(row['Volume']),
            })
        return jsonify({'symbol': ticker.upper(), 'data': records})
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/search')
def search_tickers():
    """Search for tickers by keyword using yfinance search API."""
    q = request.args.get('q', '').strip()
    if len(q) < 1:
        return jsonify([])
    try:
        results = []

        # Use yfinance search API
        try:
            search = yf.Search(q, max_results=8)
            for item in getattr(search, 'quotes', []):
                results.append({
                    'symbol': item.get('symbol', ''),
                    'name': item.get('shortname', item.get('longname', '')),
                    'type': item.get('quoteType', ''),
                    'exchange': item.get('exchange', ''),
                })
        except Exception:
            # Fallback: try direct ticker lookup
            try:
                t = yf.Ticker(q.upper())
                info = t.info
                if info.get('shortName'):
                    results.append({
                        'symbol': q.upper(),
                        'name': info.get('shortName', ''),
                        'type': info.get('quoteType', ''),
                        'exchange': info.get('exchange', ''),
                    })
            except:
                pass

        # Supplement with popular tickers if few results
        if len(results) < 4:
            popular = {
                'AAPL': 'Apple Inc.', 'MSFT': 'Microsoft Corp.', 'GOOGL': 'Alphabet Inc.',
                'AMZN': 'Amazon.com Inc.', 'TSLA': 'Tesla Inc.', 'NVDA': 'NVIDIA Corp.',
                'META': 'Meta Platforms Inc.', 'BRK-B': 'Berkshire Hathaway',
                'JPM': 'JPMorgan Chase', 'V': 'Visa Inc.', 'SPY': 'SPDR S&P 500 ETF',
                'QQQ': 'Invesco QQQ Trust', 'BTC-USD': 'Bitcoin USD', 'ETH-USD': 'Ethereum USD',
                'BABA': 'Alibaba Group', '0700.HK': 'Tencent Holdings',
            }
            q_up = q.upper()
            for sym, name in popular.items():
                if q_up in sym or q_up in name.upper():
                    if not any(r['symbol'] == sym for r in results):
                        results.append({'symbol': sym, 'name': name, 'type': 'EQUITY', 'exchange': ''})
        return jsonify(results[:8])
    except Exception as e:
        return jsonify({'error': str(e)}), 400

@app.route('/api/predict/<ticker>')
def predict(ticker):
    """Run Kronos prediction on a ticker's historical data."""
    pred_len = int(request.args.get('pred_len', 30))
    period = request.args.get('period', '2y')
    interval = request.args.get('interval', '1d')

    try:
        # Fetch historical data
        t = yf.Ticker(ticker)
        df = t.history(period=period, interval=interval)
        if len(df) < 60:
            return jsonify({'error': 'Not enough historical data'}), 400

        predictor = get_predictor()
        if predictor is None:
            return jsonify({'error': 'Model not loaded. Check server logs.'}), 500

        # Prepare input
        df = df.reset_index()
        df.columns = [c.lower() for c in df.columns]
        if 'date' in df.columns:
            df = df.rename(columns={'date': 'timestamps'})
        elif 'datetime' in df.columns:
            df = df.rename(columns={'datetime': 'timestamps'})
        df['timestamps'] = pd.to_datetime(df['timestamps'])

        lookback = min(len(df), 400)
        x_df = df.iloc[-lookback:][['open', 'high', 'low', 'close', 'volume']].copy()
        x_df['amount'] = x_df['volume'] * x_df['close']
        x_timestamp = df.iloc[-lookback:]['timestamps']

        # Generate future timestamps
        last_ts = df['timestamps'].iloc[-1]
        if interval == '1d':
            y_timestamps = pd.bdate_range(start=last_ts + timedelta(days=1), periods=pred_len)
        else:
            freq_map = {'1h': 'h', '5m': '5min', '15m': '15min', '30m': '30min'}
            freq = freq_map.get(interval, 'h')
            y_timestamps = pd.date_range(start=last_ts + timedelta(hours=1), periods=pred_len, freq=freq)

        y_timestamp = pd.Series(y_timestamps)

        # Run prediction
        pred_df = predictor.predict(
            df=x_df.reset_index(drop=True),
            x_timestamp=x_timestamp.reset_index(drop=True),
            y_timestamp=y_timestamp,
            pred_len=pred_len,
            T=0.8,
            top_p=0.9,
            sample_count=3,
            verbose=True
        )

        # Format results
        predictions = []
        for i, (ts, row) in enumerate(zip(y_timestamps, pred_df.iterrows())):
            _, r = row
            predictions.append({
                'time': int(pd.Timestamp(ts).timestamp()),
                'open': round(float(r['open']), 4),
                'high': round(float(r['high']), 4),
                'low': round(float(r['low']), 4),
                'close': round(float(r['close']), 4),
            })
        return jsonify({'symbol': ticker.upper(), 'predictions': predictions, 'pred_len': pred_len})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/backtest/<ticker>')
def backtest(ticker):
    """Run backtest: predict from a cutoff date and compare with actual data."""
    cutoff = request.args.get('cutoff', '')  # ISO date string e.g. 2025-12-01
    pred_len = int(request.args.get('pred_len', 30))
    period = request.args.get('period', '2y')
    interval = request.args.get('interval', '1d')

    if not cutoff:
        return jsonify({'error': 'cutoff date is required'}), 400

    try:
        cutoff_dt = pd.to_datetime(cutoff)

        # Fetch full historical data
        t = yf.Ticker(ticker)
        df = t.history(period=period, interval=interval)
        if len(df) < 60:
            return jsonify({'error': 'Not enough historical data'}), 400

        df = df.reset_index()
        df.columns = [c.lower() for c in df.columns]
        if 'date' in df.columns:
            df = df.rename(columns={'date': 'timestamps'})
        elif 'datetime' in df.columns:
            df = df.rename(columns={'datetime': 'timestamps'})
        df['timestamps'] = pd.to_datetime(df['timestamps']).dt.tz_localize(None)

        # Split at cutoff
        mask_before = df['timestamps'] <= cutoff_dt
        df_before = df[mask_before]
        df_after = df[~mask_before]

        if len(df_before) < 60:
            return jsonify({'error': f'Not enough data before cutoff ({len(df_before)} rows)'}), 400

        actual_len = min(pred_len, len(df_after))
        if actual_len < 1:
            return jsonify({'error': 'No actual data after cutoff to compare'}), 400

        predictor = get_predictor()
        if predictor is None:
            return jsonify({'error': 'Model not loaded. Check server logs.'}), 500

        # Prepare input: use data up to cutoff only
        lookback = min(len(df_before), 400)
        x_df = df_before.iloc[-lookback:][['open', 'high', 'low', 'close', 'volume']].copy()
        x_df['amount'] = x_df['volume'] * x_df['close']
        x_timestamp = df_before.iloc[-lookback:]['timestamps']

        # Use actual future timestamps for prediction
        y_timestamp = df_after.iloc[:actual_len]['timestamps'].reset_index(drop=True)

        # Run prediction
        pred_df = predictor.predict(
            df=x_df.reset_index(drop=True),
            x_timestamp=x_timestamp.reset_index(drop=True),
            y_timestamp=y_timestamp,
            pred_len=actual_len,
            T=0.8,
            top_p=0.9,
            sample_count=3,
            verbose=True
        )

        # Format historical data (before cutoff)
        history = []
        for _, row in df_before.iterrows():
            history.append({
                'time': int(row['timestamps'].timestamp()),
                'open': round(float(row['open']), 4),
                'high': round(float(row['high']), 4),
                'low': round(float(row['low']), 4),
                'close': round(float(row['close']), 4),
                'volume': int(row['volume']),
            })

        # Format actuals (after cutoff)
        actuals = []
        for _, row in df_after.iloc[:actual_len].iterrows():
            actuals.append({
                'time': int(row['timestamps'].timestamp()),
                'open': round(float(row['open']), 4),
                'high': round(float(row['high']), 4),
                'low': round(float(row['low']), 4),
                'close': round(float(row['close']), 4),
                'volume': int(row['volume']),
            })

        # Format predictions
        predictions = []
        for ts, (_, r) in zip(y_timestamp, pred_df.iterrows()):
            predictions.append({
                'time': int(pd.Timestamp(ts).timestamp()),
                'open': round(float(r['open']), 4),
                'high': round(float(r['high']), 4),
                'low': round(float(r['low']), 4),
                'close': round(float(r['close']), 4),
            })

        # Compute accuracy metrics
        actual_closes = [a['close'] for a in actuals]
        pred_closes = [p['close'] for p in predictions]
        mae = sum(abs(a - p) for a, p in zip(actual_closes, pred_closes)) / len(actual_closes)
        actual_direction = [1 if actual_closes[i] > actual_closes[i-1] else 0 for i in range(1, len(actual_closes))]
        pred_direction = [1 if pred_closes[i] > pred_closes[i-1] else 0 for i in range(1, len(pred_closes))]
        direction_acc = sum(1 for a, p in zip(actual_direction, pred_direction) if a == p) / max(len(actual_direction), 1)

        return jsonify({
            'symbol': ticker.upper(),
            'cutoff': cutoff,
            'pred_len': actual_len,
            'history': history,
            'actuals': actuals,
            'predictions': predictions,
            'metrics': {
                'mae': round(mae, 4),
                'direction_accuracy': round(direction_acc * 100, 1),
                'actual_return': round((actual_closes[-1] - actual_closes[0]) / actual_closes[0] * 100, 2),
                'predicted_return': round((pred_closes[-1] - pred_closes[0]) / pred_closes[0] * 100, 2),
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/trending')
def trending():
    """Return a list of trending tickers with live prices."""
    tickers = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'BTC-USD']
    results = []
    for sym in tickers:
        try:
            t = yf.Ticker(sym)
            fast = t.fast_info
            info = t.info
            results.append({
                'symbol': sym,
                'name': info.get('shortName', sym),
                'price': fast.get('lastPrice', 0),
                'changePct': info.get('regularMarketChangePercent', 0),
            })
        except:
            results.append({'symbol': sym, 'name': sym, 'price': 0, 'changePct': 0})
    return jsonify(results)

# Serve media files
@app.route('/media/<path:filename>')
def media(filename):
    return send_from_directory(os.path.join(app.static_folder, 'media'), filename)

if __name__ == '__main__':
    print("\n  ⏳ Kronos Financial Forecasting")
    print("  → http://localhost:5177\n")
    app.run(host='0.0.0.0', port=5177, debug=True)
