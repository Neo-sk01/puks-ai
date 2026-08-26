"""Verdicts for the acceptance set — one SQLite file, one table.

This module is the only thing that touches the database. Swapping SQLite
for the provisioned Azure SQL means reimplementing this module behind the
same four methods; the routes and the UI do not change.
"""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

VERDICTS = ("pass", "partial", "fail")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS verdict (
  question_id TEXT NOT NULL,
  tester      TEXT NOT NULL,
  tester_name TEXT NOT NULL,
  verdict     TEXT NOT NULL CHECK (verdict IN ('pass','partial','fail')),
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (question_id, tester)
);
"""


def normalise_tester(name: str) -> str:
    """'  NEO  Sekaleli ' → 'neo sekaleli'. Different spellings of one person are one tester."""
    return re.sub(r"\s+", " ", name.strip()).casefold()


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn

    def upsert(self, question_id: str, tester_name: str, verdict: str, note: str) -> dict:
        key = normalise_tester(tester_name)
        if not key:
            raise ValueError("tester name is empty")
        if verdict not in VERDICTS:
            raise ValueError(f"verdict must be one of {VERDICTS}")
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO verdict (question_id, tester, tester_name, verdict, note, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(question_id, tester) DO UPDATE SET
                     tester_name = excluded.tester_name, verdict = excluded.verdict,
                     note = excluded.note, updated_at = excluded.updated_at""",
                (question_id, key, tester_name.strip(), verdict, note or "", now),
            )
        return {"question_id": question_id, "tester": key, "tester_name": tester_name.strip(),
                "verdict": verdict, "note": note or "", "updated_at": now}

    def delete(self, question_id: str, tester_name: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM verdict WHERE question_id = ? AND tester = ?",
                               (question_id, normalise_tester(tester_name)))
            return cur.rowcount > 0

    def for_tester(self, tester_name: str) -> dict[str, dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM verdict WHERE tester = ?",
                                (normalise_tester(tester_name),)).fetchall()
        return {r["question_id"]: {"verdict": r["verdict"], "note": r["note"],
                                   "updated_at": r["updated_at"]} for r in rows}

    def summary(self, question_ids: list[str]) -> dict:
        with self._connect() as conn:
            rows = conn.execute("SELECT question_id, tester, tester_name, verdict FROM verdict "
                                "ORDER BY tester_name").fetchall()
        per: dict[str, dict] = {q: {"counts": {v: 0 for v in VERDICTS}, "testers": [], "disagreement": False}
                                for q in question_ids}
        testers: set[str] = set()
        totals = {v: 0 for v in VERDICTS}
        for r in rows:
            testers.add(r["tester"])
            if r["question_id"] not in per:
                continue                     # a verdict for a question since removed from the set
            entry = per[r["question_id"]]
            entry["counts"][r["verdict"]] += 1
            entry["testers"].append(r["tester_name"])
            totals[r["verdict"]] += 1
        for entry in per.values():
            entry["disagreement"] = sum(1 for v in VERDICTS if entry["counts"][v] > 0) > 1
        n = sum(totals.values())
        return {
            "questions": per,
            "totals": {
                "questions": len(question_ids),
                "scored": sum(1 for e in per.values() if sum(e["counts"].values()) > 0),
                "testers": len(testers),
                "pass_rate": (totals["pass"] / n) if n else None,
            },
        }
