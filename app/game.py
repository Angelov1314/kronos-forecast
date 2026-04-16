"""
Kronos Game — Flask Blueprint
Stock prediction game: server picks a random ticker + historical window,
user predicts the next N days, server scores against ground truth.
"""

from __future__ import annotations
import random
import time
import threading
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple

import pandas as pd
import numpy as np
import yfinance as yf
import akshare as ak

from flask import Blueprint, jsonify, request

from game_session import get_store, new_qid
from game_scoring import score_answer, score_tier

bp = Blueprint("game", __name__, url_prefix="/api/game")


# ---------- Ticker Pool ----------
TICKER_POOL: List[Dict[str, str]] = [
    # US majors
    {"symbol": "AAPL", "name": "Apple Inc.", "market": "us"},
    {"symbol": "MSFT", "name": "Microsoft Corp.", "market": "us"},
    {"symbol": "NVDA", "name": "NVIDIA Corp.", "market": "us"},
    {"symbol": "GOOGL", "name": "Alphabet Inc.", "market": "us"},
    {"symbol": "AMZN", "name": "Amazon.com Inc.", "market": "us"},
    {"symbol": "META", "name": "Meta Platforms Inc.", "market": "us"},
    {"symbol": "TSLA", "name": "Tesla Inc.", "market": "us"},
    {"symbol": "JPM", "name": "JPMorgan Chase", "market": "us"},
    {"symbol": "V", "name": "Visa Inc.", "market": "us"},
    {"symbol": "JNJ", "name": "Johnson & Johnson", "market": "us"},
    {"symbol": "WMT", "name": "Walmart Inc.", "market": "us"},
    {"symbol": "XOM", "name": "Exxon Mobil", "market": "us"},
    {"symbol": "SPY", "name": "S&P 500 ETF", "market": "us"},
    {"symbol": "QQQ", "name": "Nasdaq 100 ETF", "market": "us"},
    {"symbol": "DIA", "name": "Dow Jones ETF", "market": "us"},
    # A-share majors
    {"symbol": "600519", "name": "贵州茅台", "market": "cn"},
    {"symbol": "000858", "name": "五粮液", "market": "cn"},
    {"symbol": "300750", "name": "宁德时代", "market": "cn"},
    {"symbol": "002594", "name": "比亚迪", "market": "cn"},
    {"symbol": "600036", "name": "招商银行", "market": "cn"},
    {"symbol": "000333", "name": "美的集团", "market": "cn"},
    {"symbol": "601318", "name": "中国平安", "market": "cn"},
    {"symbol": "600030", "name": "中信证券", "market": "cn"},
    {"symbol": "000001", "name": "平安银行", "market": "cn"},
    {"symbol": "601899", "name": "紫金矿业", "market": "cn"},
    # Crypto
    {"symbol": "BTC-USD", "name": "Bitcoin", "market": "crypto"},
    {"symbol": "ETH-USD", "name": "Ethereum", "market": "crypto"},
    {"symbol": "SOL-USD", "name": "Solana", "market": "crypto"},
]

# Weighted market selection: US 60%, CN 30%, crypto 10%
_MARKET_WEIGHTS = {"us": 0.60, "cn": 0.30, "crypto": 0.10}


# ---------- Historical Data Cache ----------
# {symbol: (dataframe, fetched_at)}
_HIST_CACHE: Dict[str, Tuple[pd.DataFrame, datetime]] = {}
_CACHE_TTL = timedelta(hours=6)
_CACHE_LOCK = threading.Lock()


def _fetch_us_history(symbol: str) -> Optional[pd.DataFrame]:
    try:
        t = yf.Ticker(symbol)
        df = t.history(period="10y", interval="1d")
        if df.empty:
            return None
        df = df.reset_index()
        df.columns = [c.lower() for c in df.columns]
        if "date" in df.columns:
            df = df.rename(columns={"date": "timestamps"})
        elif "datetime" in df.columns:
            df = df.rename(columns={"datetime": "timestamps"})
        df["timestamps"] = pd.to_datetime(df["timestamps"]).dt.tz_localize(None)
        return df[["timestamps", "open", "high", "low", "close", "volume"]]
    except Exception as e:
        print(f"[game] US history fetch failed for {symbol}: {e}")
        return None


def _fetch_cn_history(code: str) -> Optional[pd.DataFrame]:
    try:
        start = "20150101"
        end = datetime.now().strftime("%Y%m%d")
        df = ak.stock_zh_a_hist(
            symbol=code, period="daily",
            start_date=start, end_date=end, adjust="qfq"
        )
        if df.empty:
            return None
        df = df.rename(columns={
            "日期": "timestamps", "开盘": "open", "最高": "high",
            "最低": "low", "收盘": "close", "成交量": "volume",
        })
        df["timestamps"] = pd.to_datetime(df["timestamps"])
        return df[["timestamps", "open", "high", "low", "close", "volume"]].copy()
    except Exception as e:
        print(f"[game] CN history fetch failed for {code}: {e}")
        return None


def get_history(symbol: str, market: str) -> Optional[pd.DataFrame]:
    """Cached 10-year daily OHLCV for a symbol."""
    with _CACHE_LOCK:
        entry = _HIST_CACHE.get(symbol)
        if entry:
            df, fetched_at = entry
            if datetime.utcnow() - fetched_at < _CACHE_TTL:
                return df

    if market == "cn":
        df = _fetch_cn_history(symbol)
    else:
        df = _fetch_us_history(symbol)

    if df is not None:
        with _CACHE_LOCK:
            _HIST_CACHE[symbol] = (df, datetime.utcnow())
    return df


# ---------- Random Window Picker ----------
SETUP_LEN = 30  # 30 prior business days
MIN_EARLIEST = pd.Timestamp("2015-06-01")
# Exclude very recent windows so the user doesn't have macro context
EXCLUDE_RECENT_DAYS = 90


def _pick_ticker() -> Dict[str, str]:
    r = random.random()
    cum = 0.0
    chosen_market = "us"
    for m, w in _MARKET_WEIGHTS.items():
        cum += w
        if r <= cum:
            chosen_market = m
            break
    candidates = [t for t in TICKER_POOL if t["market"] == chosen_market]
    return random.choice(candidates) if candidates else random.choice(TICKER_POOL)


def _pick_window(df: pd.DataFrame, horizon: int) -> Optional[Tuple[int, int, int]]:
    """
    Return (setup_start_idx, cutoff_idx, truth_end_idx) — all inclusive starts, exclusive ends for truth_end.
      setup rows: df[setup_start:cutoff]  (length = SETUP_LEN)
      cutoff row: df[cutoff - 1]           (last visible day)
      truth rows: df[cutoff : cutoff + horizon]
    """
    n = len(df)
    latest_ok = df["timestamps"] <= (pd.Timestamp.now() - pd.Timedelta(days=EXCLUDE_RECENT_DAYS))
    earliest_ok = df["timestamps"] >= MIN_EARLIEST
    valid_mask = latest_ok & earliest_ok
    valid_idx = df.index[valid_mask].tolist()
    if not valid_idx:
        return None

    # cutoff must allow SETUP_LEN before and horizon after
    min_cutoff = SETUP_LEN
    max_cutoff = n - horizon
    eligible = [i for i in valid_idx if min_cutoff <= i <= max_cutoff]
    if not eligible:
        return None

    cutoff = random.choice(eligible)
    return (cutoff - SETUP_LEN, cutoff, cutoff + horizon)


def _df_to_records(df_slice: pd.DataFrame) -> List[Dict[str, Any]]:
    out = []
    for _, row in df_slice.iterrows():
        out.append({
            "time": int(pd.Timestamp(row["timestamps"]).timestamp()),
            "open": round(float(row["open"]), 4),
            "high": round(float(row["high"]), 4),
            "low": round(float(row["low"]), 4),
            "close": round(float(row["close"]), 4),
            "volume": int(row["volume"]) if pd.notna(row["volume"]) else 0,
        })
    return out


def generate_question(mode: dict) -> Optional[dict]:
    """Build one question (setup + hidden truth)."""
    horizon = int(mode["horizon"])
    # Retry up to 10 times in case a random ticker has no valid window
    for _ in range(10):
        picked = _pick_ticker()
        df = get_history(picked["symbol"], picked["market"])
        if df is None or len(df) < SETUP_LEN + horizon + 5:
            continue
        window = _pick_window(df, horizon)
        if window is None:
            continue
        s_start, cutoff, t_end = window
        setup_df = df.iloc[s_start:cutoff]
        truth_df = df.iloc[cutoff:t_end]

        if len(setup_df) != SETUP_LEN or len(truth_df) != horizon:
            continue

        setup = _df_to_records(setup_df)
        truth = _df_to_records(truth_df)
        cutoff_close = setup[-1]["close"]
        cutoff_date = pd.Timestamp(setup_df.iloc[-1]["timestamps"]).strftime("%Y-%m-%d")

        return {
            "qid": new_qid(),
            "ticker": picked["symbol"],
            "ticker_name": picked["name"],
            "market": picked["market"],
            "cutoff_date": cutoff_date,
            "cutoff_close": cutoff_close,
            "setup": setup,
            "truth": truth,
            "answered": False,
            "user_answer": None,
            "score": None,
            "breakdown": None,
        }
    return None


def _public_view(q: dict, mode: dict) -> dict:
    """Shape a question for sending to the client (strip truth)."""
    anon = mode.get("anonymous", False)
    return {
        "qid": q["qid"],
        "ticker_display": "???" if anon else q["ticker"],
        "ticker_name": "Mystery Stock" if anon else q["ticker_name"],
        "market_display": "" if anon else q["market"],
        "cutoff_date": "hidden" if anon else q["cutoff_date"],
        "setup": q["setup"],
        "horizon": mode["horizon"],
        "level": mode["level"],
    }


# ---------- Endpoints ----------
@bp.route("/start", methods=["POST"])
def start():
    data = request.get_json(silent=True) or {}
    try:
        level = int(data.get("level", 1))
        horizon = int(data.get("horizon", 7))
        pool_size = int(data.get("pool_size", 5))
        anonymous = bool(data.get("anonymous", False))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid mode"}), 400

    if level not in (1, 2, 3):
        return jsonify({"error": "level must be 1, 2, or 3"}), 400
    if horizon not in (3, 7, 30):
        return jsonify({"error": "horizon must be 3, 7, or 30"}), 400
    if pool_size not in (5, 10, 20):
        return jsonify({"error": "pool_size must be 5, 10, or 20"}), 400

    mode = {
        "level": level,
        "horizon": horizon,
        "pool_size": pool_size,
        "anonymous": anonymous,
    }
    session = get_store().create(mode)
    return jsonify({
        "session_id": session["session_id"],
        "mode": mode,
        "total_questions": pool_size,
    })


@bp.route("/question/<sid>", methods=["GET"])
def question(sid):
    session = get_store().get(sid)
    if session is None:
        return jsonify({"error": "session not found or expired"}), 404
    if session["finished"]:
        return jsonify({"finished": True, "session_id": sid})

    idx = session["current_index"]

    # Lazy-generate if needed
    while len(session["questions"]) <= idx:
        q = generate_question(session["mode"])
        if q is None:
            return jsonify({"error": "failed to generate question"}), 500
        session["questions"].append(q)

    q = session["questions"][idx]
    get_store().update(sid, session)

    return jsonify({
        "index": idx,
        "total": session["mode"]["pool_size"],
        "question": _public_view(q, session["mode"]),
    })


@bp.route("/submit/<sid>", methods=["POST"])
def submit(sid):
    session = get_store().get(sid)
    if session is None:
        return jsonify({"error": "session not found or expired"}), 404

    data = request.get_json(silent=True) or {}
    qid = data.get("qid")
    answer = data.get("answer") or {}

    idx = session["current_index"]
    if idx >= len(session["questions"]):
        return jsonify({"error": "no active question"}), 400

    q = session["questions"][idx]
    if q["qid"] != qid:
        return jsonify({"error": "qid mismatch"}), 400
    if q["answered"]:
        return jsonify({"error": "already answered"}), 400

    # Validate answer shape
    level = session["mode"]["level"]
    horizon = session["mode"]["horizon"]

    if level == 1:
        if "predicted_pct" not in answer:
            return jsonify({"error": "missing predicted_pct"}), 400
        try:
            v = float(answer["predicted_pct"])
            if abs(v) > 500:
                return jsonify({"error": "predicted_pct out of range"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "invalid predicted_pct"}), 400
    elif level == 2:
        arr = answer.get("predicted_closes") or []
        if len(arr) != horizon:
            return jsonify({"error": f"predicted_closes must have {horizon} items"}), 400
    elif level == 3:
        arr = answer.get("predicted_candles") or []
        if len(arr) != horizon:
            return jsonify({"error": f"predicted_candles must have {horizon} items"}), 400
        for c in arr:
            o, h, l, cl = c.get("o", 0), c.get("h", 0), c.get("l", 0), c.get("c", 0)
            if l > min(o, cl) or h < max(o, cl):
                return jsonify({"error": "invalid OHLC: high/low inconsistent"}), 400

    # Score it
    result = score_answer(
        level=level,
        answer=answer,
        truth_candles=q["truth"],
        cutoff_close=q["cutoff_close"],
        horizon=horizon,
    )

    q["answered"] = True
    q["user_answer"] = answer
    q["score"] = result["score"]
    q["breakdown"] = result.get("breakdown", {})

    get_store().update(sid, session)

    return jsonify({
        "qid": qid,
        "score": result["score"],
        "breakdown": result.get("breakdown", {}),
        "truth": q["truth"],
        "ticker_reveal": {
            "symbol": q["ticker"],
            "name": q["ticker_name"],
            "market": q["market"],
            "cutoff_date": q["cutoff_date"],
        },
    })


@bp.route("/next/<sid>", methods=["POST"])
def next_q(sid):
    session = get_store().get(sid)
    if session is None:
        return jsonify({"error": "session not found or expired"}), 404

    idx = session["current_index"]
    # Must have answered current before advancing
    if idx < len(session["questions"]) and not session["questions"][idx]["answered"]:
        return jsonify({"error": "current question not answered"}), 400

    session["current_index"] += 1

    if session["current_index"] >= session["mode"]["pool_size"]:
        session["finished"] = True
        get_store().update(sid, session)
        return jsonify({"finished": True, "session_id": sid})

    get_store().update(sid, session)
    # Return the next question inline
    return question(sid)


@bp.route("/summary/<sid>", methods=["GET"])
def summary(sid):
    session = get_store().get(sid)
    if session is None:
        return jsonify({"error": "session not found or expired"}), 404

    per_q = []
    scores = []
    for i, q in enumerate(session["questions"]):
        if not q["answered"]:
            continue
        per_q.append({
            "index": i,
            "ticker": q["ticker"],
            "ticker_name": q["ticker_name"],
            "cutoff_date": q["cutoff_date"],
            "score": q["score"],
            "breakdown": q["breakdown"],
        })
        scores.append(q["score"])

    total = sum(scores) if scores else 0.0
    avg = total / len(scores) if scores else 0.0
    accuracy_pct = (sum(1 for s in scores if s >= 50) / len(scores) * 100.0) if scores else 0.0

    return jsonify({
        "session_id": sid,
        "mode": session["mode"],
        "total_score": round(total, 2),
        "avg_score": round(avg, 2),
        "max_possible": session["mode"]["pool_size"] * 100,
        "accuracy_pct": round(accuracy_pct, 1),
        "tier": score_tier(avg),
        "per_question": per_q,
        "answered_count": len(scores),
        "finished": session["finished"],
    })


@bp.route("/<sid>", methods=["DELETE"])
def delete_session(sid):
    ok = get_store().delete(sid)
    return jsonify({"ok": ok})


@bp.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "pool_size": len(TICKER_POOL),
        "cached_tickers": len(_HIST_CACHE),
    })
