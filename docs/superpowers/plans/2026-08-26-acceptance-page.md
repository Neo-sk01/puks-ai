# Acceptance Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `/acceptance` page in the Next.js app where a team of testers score the 65 acceptance questions (PASS / PART / FAIL + note), read the recorded answers, and see a team summary — verdicts stored centrally in SQLite behind the FastAPI backend.

**Architecture:** Questions move from the HTML sheet into `docs/acceptance-questions.json` (single source of truth for the runner, the HTML export and the API). FastAPI gains an `/api/acceptance/*` router backed by a small sqlite3 store module. The Next page is a thin shadcn UI that talks to Next route handlers, which proxy to `FASTAPI_URL` exactly like the chat route does.

**Tech Stack:** Python 3.11 / FastAPI / stdlib `sqlite3` / pytest · Next.js 16 (App Router) / React 19 / Tailwind v4 / shadcn (CSS-variables style) / vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-acceptance-page-design.md`

## Global Constraints

- Tester identity is a typed name; no auth. Tester key = name trimmed, case-folded, internal whitespace collapsed to one space; display name = as typed.
- Verdict values are exactly `pass`, `partial`, `fail`; the UI labels are `PASS`, `PART`, `FAIL`.
- Validation limits: tester name 1–60 chars, note ≤ 500 chars.
- SQLite file path from `PUKS_ACCEPTANCE_DB`, default `var/acceptance.db` relative to the repo root; `/var/` is gitignored (anchored); WAL journal mode.
- Group order is fixed: `R, O, L, S, M, G, D, T, X, C, N`.
- `disagreement` = a question has verdicts of more than one kind. `pass_rate` = pass / (pass + partial + fail), `null` when no verdicts.
- The browser never learns the FastAPI host: all calls go through Next route handlers under `web/app/api/acceptance/*`.
- shadcn components use the existing AGL tokens; no second theme. Semantic colours for verdicts (green / ochre / red) are separate from the brand accent.
- Python tests never touch the network; run with `.venv/bin/python -m pytest -q`. Web checks: `cd web && npm test && npx tsc --noEmit && npm run lint`.
- Commit after every task. Commit messages end with the two trailer lines used throughout this repo (`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and the `Claude-Session:` line).

---

## File structure

| File | Responsibility |
|---|---|
| `SCRIPTS/extract_acceptance_questions.py` (create) | One-off: parse `docs/acceptance-questions.html` → `docs/acceptance-questions.json`. Kept for reference. |
| `docs/acceptance-questions.json` (create) | The 65 questions with group, must-contain (markdown), source, scripted turns, kind. |
| `SCRIPTS/run_acceptance.py` (modify) | Read questions from the JSON; write `docs/acceptance-run.json` run metadata. |
| `SCRIPTS/build_acceptance_page.py` (modify) | Read questions from the JSON when building the standalone HTML export. |
| `api/acceptance_store.py` (create) | sqlite3 access: `open_db`, `upsert`, `delete`, `for_tester`, `summary`, `normalise_tester`. The Azure SQL seam. |
| `api/acceptance.py` (create) | FastAPI `APIRouter` with the five routes; loads questions/results JSON; validation. |
| `api/main.py` (modify) | `app.include_router(acceptance_router)`. |
| `tests/test_acceptance_store.py`, `tests/test_acceptance_api.py` (create) | Store and route tests on a temp DB. |
| `.gitignore`, `.env.example` (modify) | `/var/` (anchored); `PUKS_ACCEPTANCE_DB`. |
| `web/components.json`, `web/lib/utils.ts`, `web/components/ui/*` (create by shadcn) | shadcn scaffolding. |
| `web/app/globals.css` (modify) | Map shadcn CSS variables onto AGL tokens. |
| `web/lib/acceptance.ts` (create) | Types mirroring the API; `normaliseTester`, `filterSummary`, `verdictLabel`. |
| `web/lib/acceptance.test.ts` (create) | vitest for the helpers. |
| `web/app/api/acceptance/{questions,results,summary}/route.ts`, `web/app/api/acceptance/verdicts/route.ts`, `web/app/api/acceptance/verdicts/[id]/route.ts` (create) | Proxies to FastAPI. |
| `web/components/acceptance/NameGate.tsx`, `VerdictControls.tsx`, `QuestionsTab.tsx`, `ResultsTab.tsx`, `SummaryTab.tsx`, `AcceptanceView.tsx` (create) | The page's client components. |
| `web/app/acceptance/page.tsx` (create) | Server component: loads questions + results, renders `AcceptanceView`. |
| `web/components/Sidebar.tsx` (modify) | "Acceptance" nav link. |
| `README.md` (modify) | Layout and §5.1 mention the page. |

---

### Task 1: Questions become data (`docs/acceptance-questions.json`)

**Files:**
- Create: `SCRIPTS/extract_acceptance_questions.py`
- Create: `docs/acceptance-questions.json` (generated, committed)
- Test: `tests/test_acceptance_questions.py`

**Interfaces:**
- Produces: `docs/acceptance-questions.json` — a JSON list of objects `{id, group, group_title, group_note, question, asked: [str], must_contain: str (markdown), source: str, kind: "answer"|"refuse"}` in sheet order.

- [ ] **Step 1: Write the failing test**

`tests/test_acceptance_questions.py`:

```python
"""docs/acceptance-questions.json is the single source of truth for the
acceptance set. These pin its shape so the API, the runner and the HTML
export cannot drift apart."""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "docs" / "acceptance-questions.json"
GROUP_ORDER = list("ROLSMGDTXCN")


@pytest.fixture(scope="module")
def questions() -> list[dict]:
    return json.loads(QUESTIONS.read_text(encoding="utf-8"))


def test_there_are_sixty_five_questions_in_sheet_order(questions):
    assert len(questions) == 65
    ids = [q["id"] for q in questions]
    assert len(set(ids)) == 65
    groups_seen = [q["group"] for q in questions]
    # groups appear in the fixed order, each contiguous
    order = [g for i, g in enumerate(groups_seen) if i == 0 or g != groups_seen[i - 1]]
    assert order == GROUP_ORDER


def test_every_question_has_the_full_shape(questions):
    for q in questions:
        assert set(q) == {"id", "group", "group_title", "group_note", "question",
                          "asked", "must_contain", "source", "kind"}, q["id"]
        assert q["id"].startswith(q["group"])
        assert q["question"].strip()
        assert isinstance(q["asked"], list) and q["asked"]
        assert q["kind"] in ("answer", "refuse")


def test_scripted_follow_ups_carry_their_prior_turn(questions):
    by_id = {q["id"]: q for q in questions}
    assert by_id["C1"]["asked"] == [
        "How do I create a receipt header in Speed WMS?",
        "and which of those fields can I change?",
    ]
    assert by_id["C5"]["asked"] == ["and which of those fields can I change?"]
    assert by_id["R1"]["asked"] == [by_id["R1"]["question"]]


def test_refusal_group_is_marked_except_the_self_description(questions):
    by_id = {q["id"]: q for q in questions}
    assert {by_id[i]["kind"] for i in ("N1", "N2", "N3", "N4")} == {"refuse"}
    assert by_id["N5"]["kind"] == "answer"


def test_must_contain_is_markdown_not_html(questions):
    for q in questions:
        assert "<b>" not in q["must_contain"] and "<code>" not in q["must_contain"], q["id"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest -q tests/test_acceptance_questions.py`
Expected: FAIL — `FileNotFoundError` for `docs/acceptance-questions.json`.

- [ ] **Step 3: Write the extractor**

`SCRIPTS/extract_acceptance_questions.py`:

```python
"""One-off: turn the Questions tab of docs/acceptance-questions.html into
docs/acceptance-questions.json. Kept for reference; the JSON is now edited
by hand and is the source of truth."""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHEET = ROOT / "docs" / "acceptance-questions.html"
OUT = ROOT / "docs" / "acceptance-questions.json"

# Scripted turns for the follow-up group — the sheet phrases these as
# instructions ("Ask R1, then: …"), so the runner has always carried them.
SCRIPTED = {
    "C1": ["How do I create a receipt header in Speed WMS?", "and which of those fields can I change?"],
    "C2": ["What does the STK_DAT table hold and what is its primary key?", "what about its foreign keys?"],
    "C3": ["how to close a grn"],
    "C4": ["stk_dat vs mvt_dat"],
    "C5": ["and which of those fields can I change?"],
}
REFUSE = {"N1", "N2", "N3", "N4"}


def md(fragment: str) -> str:
    """The sheet's must-contain HTML → markdown: <b>→**, <code>→`, strip the rest."""
    s = re.sub(r"<b>(.*?)</b>", r"**\1**", fragment, flags=re.S)
    s = re.sub(r"<code>(.*?)</code>", r"`\1`", s, flags=re.S)
    s = re.sub(r"<i>(.*?)</i>", r"*\1*", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def main() -> None:
    page = SHEET.read_text(encoding="utf-8").split("<!-- RESULTS:START -->")[0]
    out: list[dict] = []
    for section in re.findall(r"<section>(.*?)</section>", page, re.S):
        head = re.search(r'<h2>(.*?)</h2><span class="tag"[^>]*>(\w)</span>(?:<span class="why">(.*?)</span>)?', section, re.S)
        title, key, note = text(head.group(1)), head.group(2), text(head.group(3) or "")
        for row in re.finditer(r'<div class="q[^"]*" data-id="([A-Z]\d+)">.*?<p class="ask">(.*?)</p>(.*?)</div><div class="res">', section, re.S):
            qid, ask, rest = row.group(1), row.group(2), row.group(3)
            expect = re.search(r'<p class="expect">(.*?)</p>', rest, re.S)
            src = re.search(r'<span class="src">(.*?)</span>\s*$', rest.strip(), re.S)
            question = text(ask)
            out.append({
                "id": qid, "group": key, "group_title": title, "group_note": note,
                "question": question,
                "asked": SCRIPTED.get(qid, [question]),
                "must_contain": md(expect.group(1)) if expect else "",
                "source": text(src.group(1)).removeprefix("Source: ") if src else "",
                "kind": "refuse" if qid in REFUSE else "answer",
            })
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(out)} questions to {OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Generate the JSON and run the tests**

Run: `.venv/bin/python SCRIPTS/extract_acceptance_questions.py && .venv/bin/python -m pytest -q tests/test_acceptance_questions.py`
Expected: `wrote 65 questions …` then 5 passed. If a source line is empty for some question, open the HTML for that id and fix the regex or the JSON by hand — the JSON is the artefact that matters.

- [ ] **Step 5: Commit**

```bash
git add SCRIPTS/extract_acceptance_questions.py docs/acceptance-questions.json tests/test_acceptance_questions.py
git commit -m "feat(acceptance): questions become data — docs/acceptance-questions.json"
```

---

### Task 2: Runner and HTML export read the JSON; runner records run metadata

**Files:**
- Modify: `SCRIPTS/run_acceptance.py` (the `SCRIPTED` dict, `questions()`, `run_one`, the tail)
- Modify: `SCRIPTS/build_acceptance_page.py` (`build()` group names)
- Test: `tests/test_acceptance_scripts.py`

**Interfaces:**
- Consumes: `docs/acceptance-questions.json` (Task 1).
- Produces: `docs/acceptance-run.json` — `{ran_at, providers, chat_deployment, embed_deployment, rerank_model, threshold, count}`; `SCRIPTS/run_acceptance.py` exposes `load_questions() -> list[dict]` and `run_metadata(config: dict, count: int) -> dict`.

- [ ] **Step 1: Write the failing test**

`tests/test_acceptance_scripts.py`:

```python
"""The runner and the HTML builder both read docs/acceptance-questions.json."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "SCRIPTS" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_runner_loads_questions_from_json():
    runner = load("run_acceptance")
    qs = runner.load_questions()
    assert len(qs) == 65
    assert qs[0]["id"] == "R1" and qs[0]["asked"] == [qs[0]["question"]]
    c1 = next(q for q in qs if q["id"] == "C1")
    assert len(c1["asked"]) == 2


def test_run_metadata_records_what_the_summary_needs():
    runner = load("run_acceptance")
    meta = runner.run_metadata(
        {"providers": {"chat": "azure", "embed": "azure", "rerank": "azure"},
         "chat_deployment": "gpt-5", "embed_deployment": "text-embedding-3-large",
         "rerank_model": "Cohere-rerank-v4.0-pro", "confidence_threshold": 0.75},
        count=65,
    )
    assert meta["providers"]["rerank"] == "azure"
    assert meta["threshold"] == 0.75 and meta["count"] == 65
    assert meta["ran_at"].endswith("+00:00") or meta["ran_at"].endswith("Z")
```

The runner executes its main body at import today, so the test would hit the network. Step 3 moves that body under `if __name__ == "__main__":` — the test depends on it.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest -q tests/test_acceptance_scripts.py`
Expected: FAIL (`AttributeError: … has no attribute 'load_questions'`, or the import attempts HTTP).

- [ ] **Step 3: Rework the runner**

In `SCRIPTS/run_acceptance.py`:

1. Replace the `SCRIPTED` dict and `questions()` with:

```python
QUESTIONS = Path(__file__).resolve().parent.parent / "docs" / "acceptance-questions.json"
RUN_META = Path(__file__).resolve().parent.parent / "docs" / "acceptance-run.json"
CONFIG_URL = "http://127.0.0.1:8001/api/config"


def load_questions() -> list[dict]:
    return json.loads(QUESTIONS.read_text(encoding="utf-8"))


def run_metadata(config: dict, count: int) -> dict:
    from datetime import datetime, timezone
    return {
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "providers": config.get("providers", {}),
        "chat_deployment": config.get("chat_deployment"),
        "embed_deployment": config.get("embed_deployment"),
        "rerank_model": config.get("rerank_model"),
        "threshold": config.get("confidence_threshold"),
        "count": count,
    }
```

2. Change `run_one` to take a question dict: replace its first lines

```python
def run_one(item):
    qid, text = item
    turns = SCRIPTED.get(qid, [(None, text)])
    history, last, asked = [], None, []
    for _, msg in turns:
```
with
```python
def run_one(q):
    qid, text = q["id"], q["question"]
    history, last, asked = [], None, []
    for msg in q["asked"]:
```
(the rest of `run_one` is unchanged).

3. Replace the tail (from `items = list(questions())` to the final `print`) with:

```python
def main() -> None:
    items = load_questions()
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    if only:
        items = [q for q in items if q["id"] in only]
    print(len(items), "questions")
    config = requests.get(CONFIG_URL, timeout=10).json()
    with ThreadPoolExecutor(max_workers=4) as ex:
        fresh = list(ex.map(run_one, items))
    if only and OUT.exists():
        previous = {r["id"]: r for r in json.loads(OUT.read_text())}
        previous.update({r["id"]: r for r in fresh})
        order = [q["id"] for q in load_questions()]
        results = [previous[i] for i in order if i in previous]
    else:
        results = fresh
    OUT.write_text(json.dumps(results, indent=1, ensure_ascii=False))
    RUN_META.write_text(json.dumps(run_metadata(config, len(results)), indent=1))
    print("saved", OUT, "refused:", sum(r["refused"] for r in results),
          "errors:", sum(bool(r["error"]) for r in results))


if __name__ == "__main__":
    main()
```

4. Delete the now-unused `import html` and `import re` if nothing else uses them (`re` is still used by nothing; `html` by nothing). Update the module docstring's second line to: `Reads docs/acceptance-questions.json; writes docs/acceptance-results.json and docs/acceptance-run.json.`

- [ ] **Step 4: Make the HTML builder read the JSON for group names**

In `SCRIPTS/build_acceptance_page.py`, inside `build()`, replace the hard-coded `names = {...}` dict with:

```python
    questions = json.loads((ROOT / "docs" / "acceptance-questions.json").read_text(encoding="utf-8"))
    names = {q["group"]: q["group_title"] for q in questions}
```

and add `QUESTIONS_ORDER = "ROLSMGDTXCN"` is already the loop string `"ROLSMGDTXCN"` — leave it. Also show the run metadata when present: after `results = json.loads(RESULTS.read_text())` add

```python
run_meta_path = ROOT / "docs" / "acceptance-run.json"
run_meta = json.loads(run_meta_path.read_text()) if run_meta_path.exists() else {}
```

and in `build()`'s `run-meta` div, replace `<span>run {date.today().isoformat()}</span>` with

```python
  <span>run {html.escape(str(run_meta.get("ran_at", date.today().isoformat()))[:10])}{(" · " + html.escape(str(run_meta.get("rerank_model")))) if run_meta.get("rerank_model") else ""}</span>
```

(`build()` must accept the metadata: change its signature to `def build(results: list[dict], run_meta: dict) -> str:` and the call to `build(results, run_meta)`.)

- [ ] **Step 5: Run the tests and the builder**

Run: `.venv/bin/python -m pytest -q tests/test_acceptance_scripts.py tests/test_acceptance_questions.py && .venv/bin/python SCRIPTS/build_acceptance_page.py`
Expected: tests pass; builder prints `injected 65 results …`. Then `git diff --stat docs/acceptance-questions.html` should show only the run-meta line changed.

- [ ] **Step 6: Commit**

```bash
git add SCRIPTS/run_acceptance.py SCRIPTS/build_acceptance_page.py tests/test_acceptance_scripts.py docs/acceptance-questions.html
git commit -m "refactor(acceptance): runner and HTML export read the questions JSON; runner records run metadata"
```

---

### Task 3: The verdict store (`api/acceptance_store.py`)

**Files:**
- Create: `api/acceptance_store.py`
- Modify: `.gitignore` (add `data/`), `.env.example` (add `PUKS_ACCEPTANCE_DB`)
- Test: `tests/test_acceptance_store.py`

**Interfaces:**
- Produces:
  - `normalise_tester(name: str) -> str`
  - `class Store:` `Store(path: Path)`; `upsert(question_id, tester_name, verdict, note) -> dict`; `delete(question_id, tester_name) -> bool`; `for_tester(tester_name) -> dict[str, dict]`; `summary(question_ids: list[str]) -> dict`
  - Row dict shape: `{"question_id", "tester", "tester_name", "verdict", "note", "updated_at"}`
  - Summary shape: `{"questions": {id: {"counts": {"pass","partial","fail"}, "testers": [names], "disagreement": bool}}, "totals": {"questions", "scored", "testers", "pass_rate"}}`
  - `VERDICTS = ("pass", "partial", "fail")`

- [ ] **Step 1: Write the failing tests**

`tests/test_acceptance_store.py`:

```python
"""Verdict store: one row per (question, tester); latest wins; summary math."""
import pytest

from api.acceptance_store import VERDICTS, Store, normalise_tester


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "acceptance.db")


def test_verdict_values_are_the_three_the_ui_offers():
    assert VERDICTS == ("pass", "partial", "fail")


@pytest.mark.parametrize("raw,key", [
    ("Neo", "neo"), ("  neo  ", "neo"), ("NEO  SEKALELI", "neo sekaleli"), ("Ñandú", "ñandú"),
])
def test_tester_key_is_trimmed_casefolded_and_single_spaced(raw, key):
    assert normalise_tester(raw) == key


def test_upsert_stores_and_returns_the_row(store):
    row = store.upsert("R1", "Neo", "pass", "clean")
    assert row["question_id"] == "R1" and row["tester"] == "neo" and row["tester_name"] == "Neo"
    assert row["verdict"] == "pass" and row["note"] == "clean" and row["updated_at"]


def test_a_later_verdict_replaces_the_earlier_one(store):
    store.upsert("R1", "Neo", "pass", "")
    store.upsert("R1", "neo ", "fail", "missed 060")          # same tester, different spelling
    mine = store.for_tester("NEO")
    assert list(mine) == ["R1"]
    assert mine["R1"]["verdict"] == "fail" and mine["R1"]["note"] == "missed 060"


def test_delete_removes_the_row_and_reports_whether_it_existed(store):
    store.upsert("R1", "Neo", "pass", "")
    assert store.delete("R1", "neo") is True
    assert store.delete("R1", "neo") is False
    assert store.for_tester("Neo") == {}


def test_summary_counts_testers_and_flags_disagreement(store):
    store.upsert("R1", "Neo", "pass", "")
    store.upsert("R1", "Thabo", "partial", "")
    store.upsert("R2", "Neo", "pass", "")
    store.upsert("R2", "Thabo", "pass", "")
    s = store.summary(["R1", "R2", "R3"])
    assert s["questions"]["R1"] == {"counts": {"pass": 1, "partial": 1, "fail": 0},
                                    "testers": ["Neo", "Thabo"], "disagreement": True}
    assert s["questions"]["R2"]["disagreement"] is False
    assert s["questions"]["R3"] == {"counts": {"pass": 0, "partial": 0, "fail": 0},
                                    "testers": [], "disagreement": False}
    assert s["totals"] == {"questions": 3, "scored": 2, "testers": 2, "pass_rate": 0.75}


def test_pass_rate_is_null_with_no_verdicts(store):
    assert store.summary(["R1"])["totals"]["pass_rate"] is None


def test_rejects_bad_verdicts_and_ids_at_the_store_boundary(store):
    with pytest.raises(ValueError):
        store.upsert("R1", "Neo", "maybe", "")
    with pytest.raises(ValueError):
        store.upsert("R1", "   ", "pass", "")


def test_survives_reopening_the_file(tmp_path):
    path = tmp_path / "acceptance.db"
    Store(path).upsert("R1", "Neo", "pass", "")
    assert Store(path).for_tester("Neo")["R1"]["verdict"] == "pass"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest -q tests/test_acceptance_store.py`
Expected: FAIL — `ModuleNotFoundError: api.acceptance_store`.

- [ ] **Step 3: Implement the store**

`api/acceptance_store.py`:

```python
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
```

Append to `.gitignore` under the Python section:

```
# Acceptance verdicts and runtime state (SQLite, temp files) — local, never committed
/var/
```

Append to `.env.example` after the `PUKS_CONFIDENCE_THRESHOLD` block:

```
# Where the acceptance page stores testers' verdicts (SQLite). Default shown.
# PUKS_ACCEPTANCE_DB=var/acceptance.db
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest -q tests/test_acceptance_store.py`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add api/acceptance_store.py tests/test_acceptance_store.py .gitignore .env.example
git commit -m "feat(acceptance): SQLite verdict store — upsert, delete, per-tester, summary"
```

---

### Task 4: The API router (`api/acceptance.py`)

**Files:**
- Create: `api/acceptance.py`
- Modify: `api/main.py` (import + `include_router` right after `app = FastAPI(...)`)
- Test: `tests/test_acceptance_api.py`

**Interfaces:**
- Consumes: `Store`, `VERDICTS` (Task 3); `docs/acceptance-questions.json`, `docs/acceptance-results.json`, `docs/acceptance-run.json` (Tasks 1–2).
- Produces the five routes exactly as the spec table: `GET /api/acceptance/questions`, `GET /api/acceptance/results`, `GET /api/acceptance/verdicts?tester=`, `PUT /api/acceptance/verdicts/{question_id}`, `GET /api/acceptance/summary`. Response shapes are in the tests below and are what Task 7's TypeScript types mirror.

- [ ] **Step 1: Write the failing tests**

`tests/test_acceptance_api.py`:

```python
"""The five /api/acceptance routes, on a temp database, in mock mode (no keys)."""
import pytest
from fastapi.testclient import TestClient

from api.main import create_app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("PUKS_MOCK", "1")
    monkeypatch.setenv("PUKS_ACCEPTANCE_DB", str(tmp_path / "acceptance.db"))
    with TestClient(create_app()) as c:
        yield c


def test_questions_are_grouped_in_sheet_order(client):
    body = client.get("/api/acceptance/questions").json()
    assert [g["key"] for g in body["groups"]] == list("ROLSMGDTXCN")
    first = body["groups"][0]
    assert first["title"] == "Receiving goods" and first["questions"][0]["id"] == "R1"
    assert sum(len(g["questions"]) for g in body["groups"]) == 65


def test_results_include_run_metadata_and_are_keyed_by_id(client):
    body = client.get("/api/acceptance/results").json()
    assert "run" in body and "results" in body
    assert "R1" in body["results"] and "answer" in body["results"]["R1"]


def test_verdict_round_trip(client):
    r = client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": "pass", "note": "ok"})
    assert r.status_code == 200
    assert r.json()["verdict"] == "pass" and r.json()["tester"] == "neo"
    mine = client.get("/api/acceptance/verdicts", params={"tester": "neo"}).json()["verdicts"]
    assert mine == {"R1": {"verdict": "pass", "note": "ok", "updated_at": mine["R1"]["updated_at"]}}


def test_null_verdict_clears_the_row(client):
    client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": "pass", "note": ""})
    r = client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": None, "note": ""})
    assert r.status_code == 200 and r.json() == {"question_id": "R1", "tester": "neo", "verdict": None}
    assert client.get("/api/acceptance/verdicts", params={"tester": "Neo"}).json()["verdicts"] == {}


@pytest.mark.parametrize("payload,status", [
    ({"tester_name": "Neo", "verdict": "maybe", "note": ""}, 400),
    ({"tester_name": "", "verdict": "pass", "note": ""}, 400),
    ({"tester_name": "x" * 61, "verdict": "pass", "note": ""}, 400),
    ({"tester_name": "Neo", "verdict": "pass", "note": "n" * 501}, 400),
])
def test_validation_errors_are_400(client, payload, status):
    assert client.put("/api/acceptance/verdicts/R1", json=payload).status_code == status


def test_unknown_question_is_404(client):
    r = client.put("/api/acceptance/verdicts/Z9", json={"tester_name": "Neo", "verdict": "pass", "note": ""})
    assert r.status_code == 404


def test_verdicts_without_a_tester_is_400(client):
    assert client.get("/api/acceptance/verdicts").status_code in (400, 422)
    assert client.get("/api/acceptance/verdicts", params={"tester": "  "}).status_code == 400


def test_summary_covers_every_question(client):
    client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": "pass", "note": ""})
    client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Thabo", "verdict": "fail", "note": ""})
    body = client.get("/api/acceptance/summary").json()
    assert len(body["questions"]) == 65
    assert body["questions"]["R1"]["disagreement"] is True
    assert body["totals"]["testers"] == 2 and body["totals"]["scored"] == 1


def test_routes_work_when_the_engine_is_not_ready(monkeypatch, tmp_path):
    """Scoring must not depend on the corpus or a model."""
    import puks_rag

    def boom():
        raise puks_rag.ConfigError("no index")

    monkeypatch.delenv("PUKS_MOCK", raising=False)
    monkeypatch.setenv("PUKS_ACCEPTANCE_DB", str(tmp_path / "acceptance.db"))
    monkeypatch.setattr(puks_rag, "Corpus", boom)
    with TestClient(create_app()) as c:
        assert c.get("/health").json()["ready"] is False
        assert c.get("/api/acceptance/questions").status_code == 200
        assert c.put("/api/acceptance/verdicts/R1",
                     json={"tester_name": "Neo", "verdict": "pass", "note": ""}).status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest -q tests/test_acceptance_api.py`
Expected: FAIL — 404s on every route (router not mounted).

- [ ] **Step 3: Implement the router**

`api/acceptance.py`:

```python
"""/api/acceptance — the acceptance set, its recorded results, and testers'
verdicts. Needs neither the corpus nor a model: scoring must work when the
engine is not ready and in PUKS_MOCK=1."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.acceptance_store import VERDICTS, Store, normalise_tester

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "docs" / "acceptance-questions.json"
RESULTS = ROOT / "docs" / "acceptance-results.json"
RUN_META = ROOT / "docs" / "acceptance-run.json"
GROUP_ORDER = "ROLSMGDTXCN"
NAME_MAX, NOTE_MAX = 60, 500

router = APIRouter(prefix="/api/acceptance", tags=["acceptance"])


def _store() -> Store:
    return Store(Path(os.getenv("PUKS_ACCEPTANCE_DB") or ROOT / "data" / "acceptance.db"))


@lru_cache(maxsize=1)
def _questions() -> list[dict]:
    return json.loads(QUESTIONS.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _question_ids() -> frozenset[str]:
    return frozenset(q["id"] for q in _questions())


class VerdictIn(BaseModel):
    tester_name: str
    verdict: str | None
    note: str = ""


@router.get("/questions")
def questions() -> dict:
    groups: dict[str, dict] = {}
    for q in _questions():
        g = groups.setdefault(q["group"], {"key": q["group"], "title": q["group_title"],
                                           "note": q["group_note"], "questions": []})
        g["questions"].append({k: q[k] for k in ("id", "question", "asked", "must_contain", "source", "kind")})
    return {"groups": [groups[k] for k in GROUP_ORDER if k in groups]}


@router.get("/results")
def results() -> dict:
    run = json.loads(RUN_META.read_text(encoding="utf-8")) if RUN_META.exists() else None
    rows = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else []
    return {"run": run, "results": {r["id"]: r for r in rows}}


@router.get("/verdicts")
def verdicts(tester: str = Query(...)) -> dict:
    if not normalise_tester(tester):
        raise HTTPException(status_code=400, detail="tester is required")
    return {"verdicts": _store().for_tester(tester)}


@router.put("/verdicts/{question_id}")
def put_verdict(question_id: str, body: VerdictIn) -> dict:
    if question_id not in _question_ids():
        raise HTTPException(status_code=404, detail=f"unknown question {question_id}")
    name = body.tester_name.strip()
    if not name or len(name) > NAME_MAX:
        raise HTTPException(status_code=400, detail=f"tester_name must be 1-{NAME_MAX} characters")
    if len(body.note or "") > NOTE_MAX:
        raise HTTPException(status_code=400, detail=f"note must be at most {NOTE_MAX} characters")
    store = _store()
    if body.verdict is None:
        store.delete(question_id, name)
        return {"question_id": question_id, "tester": normalise_tester(name), "verdict": None}
    if body.verdict not in VERDICTS:
        raise HTTPException(status_code=400, detail=f"verdict must be one of {list(VERDICTS)} or null")
    return store.upsert(question_id, name, body.verdict, body.note or "")


@router.get("/summary")
def summary() -> dict:
    return _store().summary([q["id"] for q in _questions()])
```

In `api/main.py`, add `from api.acceptance import router as acceptance_router` next to the `Engine` import, and directly after `app = FastAPI(title="Puks AI", lifespan=lifespan)` add:

```python
    app.include_router(acceptance_router)
```

- [ ] **Step 4: Run the whole Python suite**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass (previous 93 + Task 1–3 tests + 10 here).

- [ ] **Step 5: Commit**

```bash
git add api/acceptance.py api/main.py tests/test_acceptance_api.py
git commit -m "feat(acceptance): /api/acceptance routes — questions, results, verdicts, summary"
```

---

### Task 5: shadcn in `web/`, on the AGL tokens

**Files:**
- Create (by the CLI): `web/components.json`, `web/lib/utils.ts`, `web/components/ui/{tabs,table,badge,button,toggle-group,textarea,dialog,input,progress,tooltip,sonner}.tsx`
- Modify: `web/app/globals.css` (variable mapping), `web/app/layout.tsx` (`<Toaster />`), `web/package.json` (deps added by the CLI)

**Interfaces:**
- Produces: the `@/components/ui/*` imports used by Task 8; `cn()` from `@/lib/utils`.

- [ ] **Step 1: Initialise shadcn**

Run, in `web/`:

```bash
npx shadcn@latest init -d
npx shadcn@latest add tabs table badge button toggle-group textarea dialog input progress tooltip sonner
```

`-d` accepts defaults (New York style, CSS variables, `@/components`, `@/lib/utils`). If the CLI asks about the base colour, choose `neutral` — the next step overrides every variable anyway. If it reports the Tailwind v4 config as unsupported, run `npx shadcn@canary init` instead; the Tailwind v4 path is the supported one in current releases.

- [ ] **Step 2: Map the shadcn variables onto the AGL tokens**

The CLI appends a `:root { --background: … }` block and a `.dark` block to `globals.css`, plus `@theme inline { --color-background: var(--background); … }`. Replace the **values** in the `:root` block (keep the variable names the components reference) with:

```css
:root {
  --radius: 0.375rem;
  --background: var(--color-ink);
  --foreground: var(--color-type);
  --card: var(--color-bay);
  --card-foreground: var(--color-type);
  --popover: var(--color-ink);
  --popover-foreground: var(--color-type);
  --primary: var(--color-agl-blue);
  --primary-foreground: #ffffff;
  --secondary: var(--color-bay);
  --secondary-foreground: var(--color-type);
  --muted: var(--color-bay);
  --muted-foreground: var(--color-muted);
  --accent: var(--color-agl-yellow-20);
  --accent-foreground: var(--color-type);
  --destructive: var(--color-hazard);
  --border: var(--color-rule);
  --input: var(--color-rule);
  --ring: var(--color-agl-blue);
}
```

Delete the generated `.dark { … }` block entirely (the app is single-theme by charter). Keep the generated `@theme inline` mapping and the `@layer base` rules the CLI added. Add three semantic verdict colours to the existing AGL `@theme` block:

```css
  --color-verdict-pass: #2e7d4f;
  --color-verdict-partial: #a8650a;   /* = --color-hazard; named for its meaning here */
  --color-verdict-fail: #b23b3b;
```

- [ ] **Step 3: Mount the toaster**

In `web/app/layout.tsx`: `import { Toaster } from "@/components/ui/sonner";` and change the body to

```tsx
<body className="flex min-h-full flex-col">
  {children}
  <Toaster position="bottom-right" />
</body>
```

- [ ] **Step 4: Verify the build**

Run, in `web/`: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean. Open http://localhost:3000 (dev server) and confirm the chat page looks unchanged — the shadcn base layer must not have altered body colours or the sidebar.

- [ ] **Step 5: Commit**

```bash
git add web/components.json web/lib/utils.ts web/components/ui web/app/globals.css web/app/layout.tsx web/package.json web/package-lock.json
git commit -m "feat(web): shadcn on the AGL tokens — tabs, table, badge, toggle-group, dialog, sonner"
```

---

### Task 6: Types and helpers (`web/lib/acceptance.ts`)

**Files:**
- Create: `web/lib/acceptance.ts`
- Test: `web/lib/acceptance.test.ts`

**Interfaces:**
- Produces (used by Tasks 7–8):

```ts
export type Verdict = "pass" | "partial" | "fail";
export interface AcceptanceQuestion { id: string; question: string; asked: string[]; must_contain: string; source: string; kind: "answer" | "refuse"; }
export interface QuestionGroup { key: string; title: string; note: string; questions: AcceptanceQuestion[]; }
export interface RunMeta { ran_at: string; providers: Record<string, string>; chat_deployment: string | null; embed_deployment: string | null; rerank_model: string | null; threshold: number | null; count: number; }
export interface RecordedResult { id: string; question: string; asked: string[]; answer: string; refused: boolean; reason: string | null; threshold: number | null; confidence: number | null; top_source: string | null; top_category: string | null; sources: string[]; elapsed_s: number; error: string | null; }
export interface MyVerdict { verdict: Verdict; note: string; updated_at: string; }
export interface QuestionSummary { counts: Record<Verdict, number>; testers: string[]; disagreement: boolean; }
export interface Summary { questions: Record<string, QuestionSummary>; totals: { questions: number; scored: number; testers: number; pass_rate: number | null }; }
export type SummaryFilter = "all" | "unscored" | "disagreements" | "failures";
export function normaliseTester(name: string): string;
export function verdictLabel(v: Verdict): "PASS" | "PART" | "FAIL";
export function resultStatus(r: RecordedResult | undefined): "answered" | "gated" | "model-refused" | "self" | "needs-context" | "error" | "none";
export function filterSummary(ids: string[], summary: Summary, filter: SummaryFilter): string[];
export const TESTER_KEY = "puks-tester";
```

- [ ] **Step 1: Write the failing tests**

`web/lib/acceptance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterSummary, normaliseTester, resultStatus, verdictLabel, type RecordedResult, type Summary } from "./acceptance";

const result = (over: Partial<RecordedResult>): RecordedResult => ({
  id: "R1", question: "q", asked: ["q"], answer: "some answer", refused: false, reason: null,
  threshold: 0.75, confidence: 0.9, top_source: "x.txt", top_category: "X", sources: [], elapsed_s: 1, error: null, ...over,
});

describe("normaliseTester", () => {
  it("trims, casefolds and collapses spaces like the API", () => {
    expect(normaliseTester("  NEO  Sekaleli ")).toBe("neo sekaleli");
  });
});

describe("verdictLabel", () => {
  it("maps API values to the three UI labels", () => {
    expect([verdictLabel("pass"), verdictLabel("partial"), verdictLabel("fail")]).toEqual(["PASS", "PART", "FAIL"]);
  });
});

describe("resultStatus", () => {
  it("classifies the recorded outcome", () => {
    expect(resultStatus(undefined)).toBe("none");
    expect(resultStatus(result({}))).toBe("answered");
    expect(resultStatus(result({ refused: true, reason: "below_threshold" }))).toBe("gated");
    expect(resultStatus(result({ answer: "I do not have enough information to answer this. Please contact support." }))).toBe("model-refused");
    expect(resultStatus(result({ reason: "self_description" }))).toBe("self");
    expect(resultStatus(result({ reason: "needs_context" }))).toBe("needs-context");
    expect(resultStatus(result({ error: "ReadTimeout" }))).toBe("error");
  });
});

describe("filterSummary", () => {
  const summary: Summary = {
    questions: {
      R1: { counts: { pass: 2, partial: 0, fail: 0 }, testers: ["A", "B"], disagreement: false },
      R2: { counts: { pass: 1, partial: 1, fail: 0 }, testers: ["A", "B"], disagreement: true },
      R3: { counts: { pass: 0, partial: 0, fail: 1 }, testers: ["A"], disagreement: false },
      R4: { counts: { pass: 0, partial: 0, fail: 0 }, testers: [], disagreement: false },
    },
    totals: { questions: 4, scored: 3, testers: 2, pass_rate: 0.6 },
  };
  const ids = ["R1", "R2", "R3", "R4"];
  it("keeps order and applies each filter", () => {
    expect(filterSummary(ids, summary, "all")).toEqual(ids);
    expect(filterSummary(ids, summary, "unscored")).toEqual(["R4"]);
    expect(filterSummary(ids, summary, "disagreements")).toEqual(["R2"]);
    expect(filterSummary(ids, summary, "failures")).toEqual(["R3"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run, in `web/`: `npx vitest run lib/acceptance.test.ts`
Expected: FAIL — cannot resolve `./acceptance`.

- [ ] **Step 3: Implement**

`web/lib/acceptance.ts`:

```ts
/** Types mirror api/acceptance.py responses; helpers are pure so they test
 *  without a DOM. Keep normaliseTester identical to the Python
 *  normalise_tester — the two must agree on who is one tester. */

export type Verdict = "pass" | "partial" | "fail";

export interface AcceptanceQuestion {
  id: string; question: string; asked: string[]; must_contain: string; source: string; kind: "answer" | "refuse";
}
export interface QuestionGroup { key: string; title: string; note: string; questions: AcceptanceQuestion[] }
export interface RunMeta {
  ran_at: string; providers: Record<string, string>; chat_deployment: string | null;
  embed_deployment: string | null; rerank_model: string | null; threshold: number | null; count: number;
}
export interface RecordedResult {
  id: string; question: string; asked: string[]; answer: string; refused: boolean; reason: string | null;
  threshold: number | null; confidence: number | null; top_source: string | null; top_category: string | null;
  sources: string[]; elapsed_s: number; error: string | null;
}
export interface MyVerdict { verdict: Verdict; note: string; updated_at: string }
export interface QuestionSummary { counts: Record<Verdict, number>; testers: string[]; disagreement: boolean }
export interface Summary {
  questions: Record<string, QuestionSummary>;
  totals: { questions: number; scored: number; testers: number; pass_rate: number | null };
}
export type SummaryFilter = "all" | "unscored" | "disagreements" | "failures";
export type ResultStatus = "answered" | "gated" | "model-refused" | "self" | "needs-context" | "error" | "none";

export const TESTER_KEY = "puks-tester";
export const VERDICTS: Verdict[] = ["pass", "partial", "fail"];
const REFUSAL_PREFIX = "I do not have enough information to answer this.";

export function normaliseTester(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function verdictLabel(v: Verdict): "PASS" | "PART" | "FAIL" {
  return v === "pass" ? "PASS" : v === "partial" ? "PART" : "FAIL";
}

export function resultStatus(r: RecordedResult | undefined): ResultStatus {
  if (!r) return "none";
  if (r.error) return "error";
  if (r.refused) return "gated";
  if (r.reason === "self_description") return "self";
  if (r.reason === "needs_context") return "needs-context";
  if (r.answer.startsWith(REFUSAL_PREFIX)) return "model-refused";
  return "answered";
}

export function filterSummary(ids: string[], summary: Summary, filter: SummaryFilter): string[] {
  return ids.filter((id) => {
    const q = summary.questions[id];
    const scored = q ? q.counts.pass + q.counts.partial + q.counts.fail > 0 : false;
    switch (filter) {
      case "unscored": return !scored;
      case "disagreements": return !!q?.disagreement;
      case "failures": return (q?.counts.fail ?? 0) > 0;
      default: return true;
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run, in `web/`: `npx vitest run lib/acceptance.test.ts`
Expected: 4 test files' worth… specifically this file: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add web/lib/acceptance.ts web/lib/acceptance.test.ts
git commit -m "feat(web): acceptance types and helpers"
```

---

### Task 7: Next route handlers (proxies)

**Files:**
- Create: `web/app/api/acceptance/questions/route.ts`, `web/app/api/acceptance/results/route.ts`, `web/app/api/acceptance/summary/route.ts`, `web/app/api/acceptance/verdicts/route.ts`, `web/app/api/acceptance/verdicts/[id]/route.ts`
- Create: `web/lib/proxy.ts` (shared helper)
- Modify: `web/lib/server.ts` (add `getAcceptanceQuestions`, `getAcceptanceResults`)

**Interfaces:**
- Consumes: `FASTAPI_URL` from `@/lib/server`; `extractDetail` from `@/lib/errors` (exists).
- Produces: browser-facing endpoints with the same paths and JSON as the FastAPI routes, under the Next origin: `GET /api/acceptance/questions|results|summary`, `GET /api/acceptance/verdicts?tester=`, `PUT /api/acceptance/verdicts/:id`. Server helpers `getAcceptanceQuestions(): Promise<QuestionGroup[]>` and `getAcceptanceResults(): Promise<{ run: RunMeta | null; results: Record<string, RecordedResult> }>`.

- [ ] **Step 1: Write the proxy helper**

`web/lib/proxy.ts`:

```ts
import "server-only";
import { FASTAPI_URL } from "./server";
import { extractDetail } from "./errors";

/** Forward a request to FastAPI and hand the JSON (or the JSON error) back
 *  with the upstream status. The browser only ever sees the Next origin. */
export async function proxyJson(path: string, init?: RequestInit): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${FASTAPI_URL}${path}`, { cache: "no-store", ...init });
  } catch (error) {
    return Response.json(
      { detail: `Cannot reach the API at ${FASTAPI_URL}: ${(error as Error).message}` },
      { status: 502 },
    );
  }
  const raw = await upstream.text();
  if (!upstream.ok) {
    return Response.json({ detail: extractDetail(raw, upstream.statusText) }, { status: upstream.status });
  }
  return new Response(raw, { status: 200, headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 2: Write the five route files**

`web/app/api/acceptance/questions/route.ts`:

```ts
import { proxyJson } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function GET() {
  return proxyJson("/api/acceptance/questions");
}
```

`web/app/api/acceptance/results/route.ts` — identical with `"/api/acceptance/results"`.
`web/app/api/acceptance/summary/route.ts` — identical with `"/api/acceptance/summary"`.

`web/app/api/acceptance/verdicts/route.ts`:

```ts
import { proxyJson } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const tester = new URL(request.url).searchParams.get("tester") ?? "";
  return proxyJson(`/api/acceptance/verdicts?tester=${encodeURIComponent(tester)}`);
}
```

`web/app/api/acceptance/verdicts/[id]/route.ts`:

```ts
import { proxyJson } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.text();
  return proxyJson(`/api/acceptance/verdicts/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}
```

(Next 16 passes `params` as a Promise — check `node_modules/next/dist/docs/` if the signature differs and follow the docs.)

- [ ] **Step 3: Server helpers for the page**

Append to `web/lib/server.ts`:

```ts
import type { QuestionGroup, RecordedResult, RunMeta } from "./acceptance";

export async function getAcceptanceQuestions(): Promise<QuestionGroup[]> {
  const response = await fetch(`${FASTAPI_URL}/api/acceptance/questions`, { cache: "no-store" });
  if (!response.ok) throw new Error(`acceptance/questions returned ${response.status}`);
  return (await response.json()).groups;
}

export async function getAcceptanceResults(): Promise<{ run: RunMeta | null; results: Record<string, RecordedResult> }> {
  try {
    const response = await fetch(`${FASTAPI_URL}/api/acceptance/results`, { cache: "no-store" });
    return response.ok ? await response.json() : { run: null, results: {} };
  } catch {
    return { run: null, results: {} };
  }
}
```

(Move the `import type` line to the top of the file with the other imports.)

- [ ] **Step 4: Verify against the running API**

With uvicorn on :8001 and `npm run dev` on :3000:

```bash
curl -s localhost:3000/api/acceptance/questions | head -c 200; echo
curl -s -X PUT localhost:3000/api/acceptance/verdicts/R1 -H 'content-type: application/json' -d '{"tester_name":"Neo","verdict":"pass","note":"via proxy"}'; echo
curl -s 'localhost:3000/api/acceptance/verdicts?tester=neo'; echo
curl -s -X PUT localhost:3000/api/acceptance/verdicts/Z9 -H 'content-type: application/json' -d '{"tester_name":"Neo","verdict":"pass","note":""}'; echo   # expect 404 {"detail": …}
cd web && npx tsc --noEmit && npm run lint
```

Expected: groups JSON, the stored row, `{"verdicts":{"R1":…}}`, a 404 detail, and clean checks. Then clear the probe row: `curl -s -X PUT localhost:3000/api/acceptance/verdicts/R1 -H 'content-type: application/json' -d '{"tester_name":"Neo","verdict":null,"note":""}'`.

- [ ] **Step 5: Commit**

```bash
git add web/lib/proxy.ts web/lib/server.ts web/app/api/acceptance
git commit -m "feat(web): /api/acceptance proxies to FastAPI"
```

---

### Task 8: The page — name gate, verdict controls, three tabs

**Files:**
- Create: `web/components/acceptance/NameGate.tsx`, `VerdictControls.tsx`, `QuestionsTab.tsx`, `ResultsTab.tsx`, `SummaryTab.tsx`, `AcceptanceView.tsx`
- Create: `web/app/acceptance/page.tsx`
- Modify: `web/components/Sidebar.tsx` (nav link)

**Interfaces:**
- Consumes: Task 5 UI components, Task 6 types/helpers, Task 7 endpoints, existing `Markdown` (`@/components/Markdown`, default export `Markdown` taking children string), existing `Sidebar` props.
- Produces: route `/acceptance`.

- [ ] **Step 1: `NameGate.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TESTER_KEY } from "@/lib/acceptance";

interface Props {
  name: string | null;
  onName: (name: string) => void;
}

/** First visit: ask who is scoring. The name lives only in this browser;
 *  the API keys verdicts by its normalised form. */
export function NameGate({ name, onName }: Props) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (name === null) {
      try {
        const stored = localStorage.getItem(TESTER_KEY);
        if (stored) onName(stored);
        else setOpen(true);
      } catch {
        setOpen(true);
      }
    }
  }, [name, onName]);

  const submit = () => {
    const value = draft.trim();
    if (!value || value.length > 60) return;
    try { localStorage.setItem(TESTER_KEY, value); } catch { /* private mode: still works for this visit */ }
    onName(value);
    setOpen(false);
  };

  return (
    <>
      {name && (
        <p className="text-sm text-muted">
          Scoring as <strong className="text-type">{name}</strong>{" "}
          <button type="button" className="underline hover:text-signal" onClick={() => { setDraft(name); setOpen(true); }}>
            change
          </button>
        </p>
      )}
      <Dialog open={open} onOpenChange={(o) => name && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Who is scoring?</DialogTitle>
            <DialogDescription>Your name is stored with each verdict so the team summary can show who said what.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
            <Input autoFocus maxLength={60} placeholder="Your name" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" disabled={!draft.trim()}>Start</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: `VerdictControls.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { VERDICTS, verdictLabel, type MyVerdict, type Verdict } from "@/lib/acceptance";

interface Props {
  questionId: string;
  mine: MyVerdict | undefined;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

const tone: Record<Verdict, string> = {
  pass: "data-[state=on]:bg-verdict-pass data-[state=on]:text-white",
  partial: "data-[state=on]:bg-verdict-partial data-[state=on]:text-white",
  fail: "data-[state=on]:bg-verdict-fail data-[state=on]:text-white",
};

/** PASS / PART / FAIL plus a note. Clicking the active verdict clears it.
 *  The note saves on blur or ⌘/Ctrl+Enter, only when it changed. */
export function VerdictControls({ questionId, mine, disabled, onSave }: Props) {
  const [note, setNote] = useState(mine?.note ?? "");
  const current = mine?.verdict ?? "";

  const saveNote = () => {
    if (note !== (mine?.note ?? "") && mine) onSave(questionId, mine.verdict, note);
  };

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        type="single"
        value={current}
        disabled={disabled}
        onValueChange={(v) => onSave(questionId, (v || null) as Verdict | null, note)}
        aria-label={`Verdict for ${questionId}`}
      >
        {VERDICTS.map((v) => (
          <ToggleGroupItem key={v} value={v} className={`font-mono text-xs ${tone[v]}`}>
            {verdictLabel(v)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Textarea
        value={note}
        maxLength={500}
        placeholder={mine ? "Note (optional)" : "Pick a verdict to add a note"}
        disabled={disabled || !mine}
        rows={2}
        className="min-w-48 text-sm"
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveNote(); }}
      />
    </div>
  );
}
```

- [ ] **Step 3: `QuestionsTab.tsx`**

```tsx
"use client";

import { Markdown } from "@/components/Markdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MyVerdict, QuestionGroup, Verdict } from "@/lib/acceptance";
import { VerdictControls } from "./VerdictControls";

interface Props {
  groups: QuestionGroup[];
  mine: Record<string, MyVerdict>;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

export function QuestionsTab({ groups, mine, disabled, onSave }: Props) {
  return (
    <div className="flex flex-col gap-10">
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3 border-b border-rule pb-2">
            <h2 className="font-display text-xl font-medium">{g.title}</h2>
            <span className="rounded bg-signal/10 px-1.5 font-mono text-xs text-signal">{g.key}</span>
            {g.note && <p className="text-sm text-muted">{g.note}</p>}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">ID</TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead className="w-64">Your verdict</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.questions.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className={`align-top font-mono text-xs ${q.kind === "refuse" ? "text-hazard" : "text-signal"}`}>{q.id}</TableCell>
                    <TableCell className="align-top">
                      <p className="font-medium">{q.question}</p>
                      {q.asked.length > 1 && (
                        <ol className="mt-1 list-decimal pl-5 text-sm text-muted">{q.asked.map((a) => <li key={a}>{a}</li>)}</ol>
                      )}
                      <div className="mt-1 text-sm text-muted"><Markdown>{q.must_contain}</Markdown></div>
                      {q.source && <p className="mt-1 font-mono text-xs text-muted">{q.source}</p>}
                    </TableCell>
                    <TableCell className="align-top">
                      <VerdictControls questionId={q.id} mine={mine[q.id]} disabled={disabled} onSave={onSave} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `ResultsTab.tsx`**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { resultStatus, type MyVerdict, type QuestionGroup, type RecordedResult, type RunMeta, type Verdict } from "@/lib/acceptance";
import { VerdictControls } from "./VerdictControls";

interface Props {
  groups: QuestionGroup[];
  run: RunMeta | null;
  results: Record<string, RecordedResult>;
  mine: Record<string, MyVerdict>;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

const statusLabel = {
  answered: "Answered", gated: "Gated refusal", "model-refused": "Model refused",
  self: "Self-description", "needs-context": "Asked for context", error: "Error", none: "Not run",
} as const;

export function ResultsTab({ groups, run, results, mine, disabled, onSave }: Props) {
  return (
    <div className="flex flex-col gap-10">
      {run ? (
        <p className="rounded border border-rule bg-bay px-3 py-2 font-mono text-xs text-muted">
          run {run.ran_at.slice(0, 16).replace("T", " ")} · {run.count} questions · generation {run.chat_deployment} ({run.providers.chat}) ·
          embeddings {run.embed_deployment} ({run.providers.embed}) · rerank {run.rerank_model} ({run.providers.rerank}) · gate {run.threshold}
        </p>
      ) : (
        <p className="text-sm text-muted">No run recorded yet — run <code className="font-mono">SCRIPTS/run_acceptance.py</code>.</p>
      )}
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-6">
          <h2 className="border-b border-rule pb-2 font-display text-xl font-medium">{g.title} <span className="ml-2 rounded bg-signal/10 px-1.5 font-mono text-xs text-signal">{g.key}</span></h2>
          {g.questions.map((q) => {
            const r = results[q.id];
            const status = resultStatus(r);
            return (
              <article key={q.id} className="grid gap-4 md:grid-cols-[3.5rem_1fr_16rem]">
                <span className={`font-mono text-xs ${q.kind === "refuse" ? "text-hazard" : "text-signal"}`}>{q.id}</span>
                <div className="min-w-0">
                  <p className="font-medium">{q.question}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
                    <Badge variant={status === "answered" || status === "self" ? "secondary" : "outline"}>{statusLabel[status]}</Badge>
                    {r?.confidence != null && <span>relevance <strong className="text-type">{r.confidence.toFixed(3)}</strong></span>}
                    {r && <span>{r.elapsed_s}s</span>}
                    {r?.top_source && <span>top: {r.top_source}</span>}
                  </div>
                  {r?.answer ? (
                    <div className="mt-2 rounded border border-rule bg-bay px-4 py-3 text-sm"><Markdown>{r.answer}</Markdown></div>
                  ) : r?.error ? (
                    <p className="mt-2 font-mono text-xs text-hazard">{r.error}</p>
                  ) : null}
                  {r?.sources?.length ? <p className="mt-1 font-mono text-xs text-muted">retrieved: {r.sources.slice(0, 5).join(" · ")}</p> : null}
                </div>
                <VerdictControls questionId={q.id} mine={mine[q.id]} disabled={disabled} onSave={onSave} />
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: `SummaryTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterSummary, type QuestionGroup, type Summary, type SummaryFilter } from "@/lib/acceptance";

interface Props { groups: QuestionGroup[]; summary: Summary | null }

const FILTERS: { key: SummaryFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "unscored", label: "Unscored" },
  { key: "disagreements", label: "Disagreements" }, { key: "failures", label: "Failures" },
];

function Bar({ counts }: { counts: Record<"pass" | "partial" | "fail", number> }) {
  const total = counts.pass + counts.partial + counts.fail;
  if (!total) return <span className="text-xs text-muted">—</span>;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 && <span className={`${cls} flex h-4 items-center justify-center text-[10px] text-white`} style={{ width: `${(n / total) * 100}%` }} title={label}>{n}</span>;
  return (
    <span className="flex w-40 overflow-hidden rounded" aria-label={`${counts.pass} pass, ${counts.partial} partial, ${counts.fail} fail`}>
      {seg(counts.pass, "bg-verdict-pass", "pass")}
      {seg(counts.partial, "bg-verdict-partial", "partial")}
      {seg(counts.fail, "bg-verdict-fail", "fail")}
    </span>
  );
}

export function SummaryTab({ groups, summary }: Props) {
  const [filter, setFilter] = useState<SummaryFilter>("all");
  if (!summary) return <p className="text-sm text-muted">Loading summary…</p>;
  const all = groups.flatMap((g) => g.questions);
  const byId = Object.fromEntries(all.map((q) => [q.id, q]));
  const ids = filterSummary(all.map((q) => q.id), summary, filter);
  const t = summary.totals;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded border border-rule bg-bay px-3 py-2 font-mono text-xs text-muted">
        <span><strong className="text-type">{t.scored}</strong>/{t.questions} scored</span>
        <span><strong className="text-type">{t.testers}</strong> testers</span>
        <span>pass rate <strong className="text-type">{t.pass_rate == null ? "—" : `${Math.round(t.pass_rate * 100)}%`}</strong></span>
        <span className="ml-auto flex gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>{f.label}</Button>
          ))}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">ID</TableHead>
              <TableHead>Question</TableHead>
              <TableHead className="w-44">Verdicts</TableHead>
              <TableHead>Testers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ids.map((id) => {
              const s = summary.questions[id];
              return (
                <TableRow key={id}>
                  <TableCell className="font-mono text-xs text-signal">{id}</TableCell>
                  <TableCell>
                    {byId[id]?.question}
                    {s?.disagreement && <Badge variant="outline" className="ml-2 border-verdict-partial text-verdict-partial">disagree</Badge>}
                  </TableCell>
                  <TableCell><Bar counts={s?.counts ?? { pass: 0, partial: 0, fail: 0 }} /></TableCell>
                  <TableCell className="text-sm text-muted">{s?.testers.join(", ")}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `AcceptanceView.tsx` — state, saving, the tabs**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sidebar } from "@/components/Sidebar";
import type { AppConfig } from "@/lib/types";
import type { MyVerdict, QuestionGroup, RecordedResult, RunMeta, Summary, Verdict } from "@/lib/acceptance";
import { NameGate } from "./NameGate";
import { QuestionsTab } from "./QuestionsTab";
import { ResultsTab } from "./ResultsTab";
import { SummaryTab } from "./SummaryTab";

interface Props {
  config: AppConfig | null;
  groups: QuestionGroup[];
  run: RunMeta | null;
  results: Record<string, RecordedResult>;
}

export function AcceptanceView({ config, groups, run, results }: Props) {
  const [name, setName] = useState<string | null>(null);
  const [mine, setMine] = useState<Record<string, MyVerdict>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState("questions");
  const total = groups.reduce((n, g) => n + g.questions.length, 0);

  const loadMine = useCallback(async (tester: string) => {
    const r = await fetch(`/api/acceptance/verdicts?tester=${encodeURIComponent(tester)}`);
    if (r.ok) setMine((await r.json()).verdicts);
  }, []);
  const loadSummary = useCallback(async () => {
    const r = await fetch("/api/acceptance/summary");
    if (r.ok) setSummary(await r.json());
  }, []);

  useEffect(() => { if (name) void loadMine(name); }, [name, loadMine]);
  useEffect(() => { if (tab === "summary") void loadSummary(); }, [tab, loadSummary]);

  const save = useCallback(async (questionId: string, verdict: Verdict | null, note: string) => {
    if (!name) return;
    const previous = mine[questionId];
    setMine((m) => {
      const next = { ...m };
      if (verdict) next[questionId] = { verdict, note, updated_at: new Date().toISOString() };
      else delete next[questionId];
      return next;
    });
    const r = await fetch(`/api/acceptance/verdicts/${questionId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tester_name: name, verdict, note }),
    });
    if (!r.ok) {
      setMine((m) => { const next = { ...m }; if (previous) next[questionId] = previous; else delete next[questionId]; return next; });
      const detail = (await r.json().catch(() => ({})))?.detail ?? r.statusText;
      toast.error(`Could not save ${questionId}: ${detail}`);
      return;
    }
    if (summary) void loadSummary();
  }, [name, mine, summary, loadSummary]);

  const scored = Object.keys(mine).length;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar config={config} topK={5} onTopK={() => {}} debug={false} onDebug={() => {}} onReset={() => {}} />
      <main className="flex-1 overflow-y-auto p-6 md:p-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-medium">Acceptance testing</h1>
                <p className="text-sm text-muted">{total} questions written against the Speed WMS corpus. Score each answer against its must-contain facts.</p>
              </div>
              <NameGate name={name} onName={setName} />
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <Progress value={total ? (scored / total) * 100 : 0} className="h-1.5 w-56" />
              <span className="font-mono">{scored}/{total} scored by you</span>
            </div>
          </header>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="questions">Questions</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
            </TabsList>
            <TabsContent value="questions"><QuestionsTab groups={groups} mine={mine} disabled={!name} onSave={save} /></TabsContent>
            <TabsContent value="results"><ResultsTab groups={groups} run={run} results={results} mine={mine} disabled={!name} onSave={save} /></TabsContent>
            <TabsContent value="summary"><SummaryTab groups={groups} summary={summary} /></TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
```

The `Sidebar` here gets inert handlers: its retrieval controls belong to the chat page. If that reads badly in review, add an optional `compact?: boolean` prop to `Sidebar` that hides the Retrieval section and the reset button; that is a two-line change in `Sidebar.tsx` and is the preferred outcome.

- [ ] **Step 7: The route and the nav link**

`web/app/acceptance/page.tsx`:

```tsx
import { AcceptanceView } from "@/components/acceptance/AcceptanceView";
import { getAcceptanceQuestions, getAcceptanceResults, getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function AcceptancePage() {
  const [config, groups, { run, results }] = await Promise.all([
    getConfig(), getAcceptanceQuestions(), getAcceptanceResults(),
  ]);
  return <AcceptanceView config={config} groups={groups} run={run} results={results} />;
}
```

In `web/components/Sidebar.tsx`, after the `About` link add:

```tsx
        <Link href="/acceptance" className="rounded px-2 py-1 hover:bg-rule/40 hover:text-signal">
          Acceptance
        </Link>
```

- [ ] **Step 8: Checks**

Run, in `web/`: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean; vitest still green. Fix any shadcn import-name mismatches by reading the generated file in `components/ui/` (e.g. `ToggleGroupItem` naming) rather than guessing.

- [ ] **Step 9: Commit**

```bash
git add web/components/acceptance web/app/acceptance web/components/Sidebar.tsx
git commit -m "feat(web): /acceptance — name gate, verdicts with notes, results, team summary"
```

---

### Task 9: Manual pass, HTML export check, README

**Files:**
- Modify: `README.md` (§3 layout, §5.1)
- Possibly modify: anything the manual pass finds.

- [ ] **Step 1: Drive it**

With both servers up, in a browser (or via the Playwright MCP tools):

1. Open http://localhost:3000/acceptance → the name dialog appears; enter `Neo` → chip shows "Scoring as Neo".
2. Questions tab: click PASS on R1, type a note "clean", blur → reload the page → R1 still PASS with the note, progress shows 1/65.
3. Results tab: R1 shows the recorded answer, the `Answered` badge, relevance and top source; the verdict controls show PASS.
4. Click "change", enter `Thabo`, mark R1 FAIL. Summary tab: R1 shows a 1/1 bar, "disagree" badge, testers `Neo, Thabo`; pass rate 50%; the *Disagreements* filter shows only R1.
5. Stop uvicorn, click PART on R2 → a toast "Could not save R2: Cannot reach the API…" and the toggle reverts. Restart uvicorn.
6. `python SCRIPTS/build_acceptance_page.py` still builds the standalone HTML.

Anything that fails: fix in the task that owns the file, re-run that task's checks, commit.

- [ ] **Step 2: README**

In §3's layout block, under `web/`, add `  app/acceptance/         team scoring page for the acceptance set (shadcn); verdicts via /api/acceptance` and under `api/` add `  acceptance.py / acceptance_store.py   /api/acceptance routes; SQLite verdict store (PUKS_ACCEPTANCE_DB)`; under `docs/` add `  acceptance-questions.json  ← the questions (source of truth for the page, runner and HTML export)` and `  acceptance-run.json        metadata of the last run`. In §5.1, after the first paragraph add:

> **Scoring happens in the app.** `/acceptance` (sidebar → Acceptance) shows the same questions and recorded answers with PASS / PART / FAIL and a note per tester, stored in SQLite behind the API (`PUKS_ACCEPTANCE_DB`), and a Summary tab with the team tally, disagreements and pass rate. Testers type a name once; there is no login. The HTML sheet remains the shareable export.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: acceptance page in layout and §5.1"
git push origin frontend/nextjs-replaces-streamlit
```

---

## Self-review

**Spec coverage.** Data (questions JSON, results unchanged + run metadata, SQLite schema) → Tasks 1–3. Five routes, validation, engine-not-ready → Task 4. shadcn on AGL tokens, components list → Task 5. Name gate, three tabs, notes on blur/⌘Enter, optimistic save + toast, summary filters, refresh after save/tab open, sidebar link → Tasks 6–8. Proxies so the browser never sees the API host → Task 7. Tests (store, routes, helpers), manual pass, HTML export still builds, `.gitignore`/`.env.example` → Tasks 3, 6, 9. Responsiveness: tables are wrapped in `overflow-x-auto`; the results grid collapses below `md`. Reduced motion is covered by the existing global rule.

**Type consistency.** `Store.upsert(question_id, tester_name, verdict, note)` used identically in Tasks 3 and 4. Row/summary shapes in Task 3 match the `MyVerdict` / `Summary` types in Task 6 and the route tests in Task 4. `onSave(questionId, verdict | null, note)` is the same signature in `VerdictControls`, both tabs and `AcceptanceView`. `resultStatus` values match `statusLabel` keys in `ResultsTab`.

**Known judgement points for the executor.** `Sidebar` on the acceptance page receives inert handlers — the preferred fix is the `compact` prop noted in Task 8 Step 6. shadcn component export names must be read from the generated files. `Next 16` route-handler `params` is a Promise; confirm in `node_modules/next/dist/docs/` if the build complains.
