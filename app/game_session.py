"""
Kronos Game — Session Store
In-memory implementation. Behind a simple dict-like interface so
swapping to Redis later is a one-file change.

Session shape:
{
  session_id: str,
  created_at: datetime,
  mode: {level, horizon, pool_size, anonymous},
  questions: [
    {
      qid: str,
      ticker: str,
      ticker_name: str,
      cutoff_date: str,           # ISO
      setup: [OHLCV...],          # 30 rows, sent to client
      truth: [OHLCV...],          # horizon rows, NEVER sent until submit
      answered: bool,
      user_answer: dict | None,
      score: float | None,
      breakdown: dict | None,
    }
  ],
  current_index: int,
  finished: bool,
}
"""

from __future__ import annotations
import uuid
import threading
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

# Session TTL
SESSION_TTL = timedelta(hours=2)


class SessionStore:
    def __init__(self):
        self._store: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def create(self, mode: dict) -> dict:
        sid = uuid.uuid4().hex
        session = {
            "session_id": sid,
            "created_at": datetime.utcnow(),
            "mode": mode,
            "questions": [],  # filled lazily as user advances
            "current_index": 0,
            "finished": False,
        }
        with self._lock:
            self._store[sid] = session
            self._gc()
        return session

    def get(self, sid: str) -> Optional[dict]:
        with self._lock:
            s = self._store.get(sid)
            if s is None:
                return None
            if datetime.utcnow() - s["created_at"] > SESSION_TTL:
                del self._store[sid]
                return None
            return s

    def update(self, sid: str, session: dict) -> None:
        with self._lock:
            self._store[sid] = session

    def delete(self, sid: str) -> bool:
        with self._lock:
            return self._store.pop(sid, None) is not None

    def _gc(self):
        """Evict expired sessions (called under lock)."""
        now = datetime.utcnow()
        expired = [
            k for k, v in self._store.items()
            if now - v["created_at"] > SESSION_TTL
        ]
        for k in expired:
            del self._store[k]


# Module-level singleton
_store = SessionStore()


def get_store() -> SessionStore:
    return _store


def new_qid() -> str:
    return uuid.uuid4().hex
