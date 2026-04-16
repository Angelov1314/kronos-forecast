"""
Kronos Game — Scoring Formulas
Pure functions: no Flask, no I/O. Easy to unit-test.

All scores are 0-100 (higher = better). Errors are normalized by the
cutoff close price so scoring is price-level agnostic.
"""

from __future__ import annotations
import math
from typing import List, Dict, Any

# ---------- Tuning constants ----------
# Level 1: error penalty multiplier by horizon (days).
#   score = max(0, 100 - |err| * k1)
L1_K = {3: 10.0, 7: 6.0, 30: 3.0}

# Level 1: bonus when direction sign matches
L1_DIRECTION_BONUS = 5.0

# Level 2: RMSE_pct penalty multiplier
L2_K = 8.0

# Level 3: weighted RMSE penalty multiplier
L3_K = 7.0

# Level 3 OHLC weights (must sum to 1.0)
L3_WEIGHTS = {"close": 0.50, "open": 0.20, "high": 0.15, "low": 0.15}


# ---------- Helpers ----------
def _clamp_score(s: float) -> float:
    return max(0.0, min(100.0, s))


def _mean(xs: List[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _rmse_normalized(actual: List[float], predicted: List[float], c0: float) -> float:
    """RMSE of returns normalized by cutoff close, expressed as percentage."""
    if not actual or not predicted or c0 == 0:
        return 0.0
    n = min(len(actual), len(predicted))
    sq_err = []
    for i in range(n):
        a_ret = actual[i] / c0 - 1.0
        p_ret = predicted[i] / c0 - 1.0
        sq_err.append((a_ret - p_ret) ** 2)
    return math.sqrt(_mean(sq_err)) * 100.0  # percent


# ---------- Level 1: Direction + Magnitude ----------
def score_level1(
    predicted_pct: float,
    truth_closes: List[float],
    cutoff_close: float,
    horizon: int,
) -> Dict[str, Any]:
    """
    predicted_pct: user's predicted return (%, e.g. +5.2)
    truth_closes: list of actual future closes
    cutoff_close: close at cutoff day (c0)
    horizon: days (3/7/30)
    """
    if not truth_closes or cutoff_close == 0:
        return {"score": 0.0, "error": "no truth", "breakdown": {}}

    actual_pct = (truth_closes[-1] / cutoff_close - 1.0) * 100.0
    err = abs(predicted_pct - actual_pct)

    k = L1_K.get(horizon, 6.0)
    base = 100.0 - err * k

    direction_match = (predicted_pct >= 0) == (actual_pct >= 0)
    bonus = L1_DIRECTION_BONUS if direction_match else 0.0

    score = _clamp_score(base + bonus)

    return {
        "score": round(score, 2),
        "breakdown": {
            "predicted_pct": round(predicted_pct, 2),
            "actual_pct": round(actual_pct, 2),
            "error_pct": round(err, 2),
            "direction_match": direction_match,
            "direction_bonus": bonus,
            "base_score": round(_clamp_score(base), 2),
        },
    }


# ---------- Level 2: Close price line ----------
def score_level2(
    predicted_closes: List[float],
    truth_closes: List[float],
    cutoff_close: float,
) -> Dict[str, Any]:
    """
    predicted_closes: user's predicted closes, length == horizon
    truth_closes: actual future closes
    cutoff_close: c0
    """
    if not predicted_closes or not truth_closes or cutoff_close == 0:
        return {"score": 0.0, "error": "no data", "breakdown": {}}

    n = min(len(predicted_closes), len(truth_closes))
    rmse_pct = _rmse_normalized(
        truth_closes[:n], predicted_closes[:n], cutoff_close
    )

    score = _clamp_score(100.0 - rmse_pct * L2_K)

    # Direction accuracy (day-over-day)
    dir_match = 0
    for i in range(1, n):
        a = truth_closes[i] > truth_closes[i - 1]
        p = predicted_closes[i] > predicted_closes[i - 1]
        if a == p:
            dir_match += 1
    dir_acc = (dir_match / (n - 1) * 100.0) if n > 1 else 0.0

    return {
        "score": round(score, 2),
        "breakdown": {
            "rmse_pct": round(rmse_pct, 3),
            "direction_accuracy_pct": round(dir_acc, 1),
            "n_days": n,
        },
    }


# ---------- Level 3: Full K-lines ----------
def score_level3(
    predicted_candles: List[Dict[str, float]],
    truth_candles: List[Dict[str, float]],
    cutoff_close: float,
) -> Dict[str, Any]:
    """
    predicted_candles: list of {o, h, l, c}
    truth_candles: list of {open, high, low, close}  (from server)
    cutoff_close: c0
    """
    if not predicted_candles or not truth_candles or cutoff_close == 0:
        return {"score": 0.0, "error": "no data", "breakdown": {}}

    n = min(len(predicted_candles), len(truth_candles))

    def series(name_pred, name_truth):
        return (
            [float(predicted_candles[i].get(name_pred, 0)) for i in range(n)],
            [float(truth_candles[i].get(name_truth, 0)) for i in range(n)],
        )

    p_o, t_o = series("o", "open")
    p_h, t_h = series("h", "high")
    p_l, t_l = series("l", "low")
    p_c, t_c = series("c", "close")

    rmse = {
        "open": _rmse_normalized(t_o, p_o, cutoff_close),
        "high": _rmse_normalized(t_h, p_h, cutoff_close),
        "low": _rmse_normalized(t_l, p_l, cutoff_close),
        "close": _rmse_normalized(t_c, p_c, cutoff_close),
    }

    weighted = sum(L3_WEIGHTS[k] * rmse[k] for k in rmse)
    score = _clamp_score(100.0 - weighted * L3_K)

    # Direction accuracy on close
    dir_match = 0
    for i in range(1, n):
        a = t_c[i] > t_c[i - 1]
        p = p_c[i] > p_c[i - 1]
        if a == p:
            dir_match += 1
    dir_acc = (dir_match / (n - 1) * 100.0) if n > 1 else 0.0

    return {
        "score": round(score, 2),
        "breakdown": {
            "rmse_pct_by_series": {k: round(v, 3) for k, v in rmse.items()},
            "weighted_rmse_pct": round(weighted, 3),
            "direction_accuracy_pct": round(dir_acc, 1),
            "n_days": n,
        },
    }


# ---------- Dispatcher ----------
def score_answer(
    level: int,
    answer: Dict[str, Any],
    truth_candles: List[Dict[str, float]],
    cutoff_close: float,
    horizon: int,
) -> Dict[str, Any]:
    """
    Route to the right scoring function by level.
    Returns: {score, breakdown, ...}
    """
    truth_closes = [float(c["close"]) for c in truth_candles]

    if level == 1:
        return score_level1(
            float(answer.get("predicted_pct", 0)),
            truth_closes,
            cutoff_close,
            horizon,
        )
    elif level == 2:
        return score_level2(
            [float(x) for x in answer.get("predicted_closes", [])],
            truth_closes,
            cutoff_close,
        )
    elif level == 3:
        return score_level3(
            answer.get("predicted_candles", []),
            truth_candles,
            cutoff_close,
        )
    else:
        return {"score": 0.0, "error": f"unknown level {level}", "breakdown": {}}


# ---------- Tier ----------
def score_tier(total_score: float) -> str:
    if total_score >= 90:
        return "S"
    if total_score >= 80:
        return "A"
    if total_score >= 70:
        return "B"
    if total_score >= 60:
        return "C"
    return "D"
