# Acceptance page — design

*2026-08-26. Approved in conversation; this is the written record.*

## Goal

Replace the standalone acceptance sheet (`docs/acceptance-questions.html`) with a page inside the Next.js app that a **team of testers** can score, with verdicts stored centrally instead of in each tester's browser. The sheet keeps its role as a shareable export.

## Decisions already made

| Question | Decision |
|---|---|
| Tester identity | A name typed once, no login. Remembered in the browser; anyone with the URL can score. |
| Database | SQLite behind the FastAPI backend. Swappable for the provisioned Azure SQL later behind the same routes. |
| Scope beyond the two tabs | A **Summary** tab (team tally per question) and a **note** on each verdict. No live "ask Puks", no auth, no verdict history. |
| Architecture | Next.js is a thin UI; all data lives behind the API (matches the existing chat and the private-API / public-web App Service split). |

## 1. Data

### Questions — `docs/acceptance-questions.json` (new, the source of truth)

One entry per question, extracted once from the HTML by `SCRIPTS/extract_acceptance_questions.py`, then maintained by hand:

```json
{
  "id": "R1",
  "group": "R",
  "group_title": "Receiving goods",
  "group_note": "The best-covered process: 44 chunks, plus the end-to-end SOP.",
  "question": "How do I create a receipt header in Speed WMS?",
  "asked": ["How do I create a receipt header in Speed WMS?"],
  "must_contain": "Receipts module → Create Receipt / Add; …",
  "source": "Creating a receipt header · RECEIVING GOODS",
  "kind": "answer"
}
```

- `asked` holds the scripted turns for the follow-up group (C1 = [R1's question, "and which of those fields can I change?"]); a single-turn question has one entry equal to `question`.
- `must_contain` is markdown (the HTML used `<b>` and `<code>`; convert to `**` and backticks).
- `kind` is `answer` or `refuse` (the N group). N5 is `answer` (self-description).
- Groups keep their order R, O, L, S, M, G, D, T, X, C, N.

`SCRIPTS/run_acceptance.py` and `SCRIPTS/build_acceptance_page.py` read this file instead of parsing the HTML. The HTML export still builds and still works standalone.

### Results — `docs/acceptance-results.json` (unchanged)

The runner's output: one recorded answer per question with `confidence`, `top_source`, `sources`, `elapsed_s`, `refused`, `reason`, `threshold`, `error`. Read-only to the app. A run is an artefact of the code state, not a database record. The runner additionally writes `docs/acceptance-run.json` with run metadata: `{ "ran_at": ISO-8601, "providers": {...}, "chat_deployment", "embed_deployment", "rerank_model", "threshold" }`, taken from `/api/config` at the start of the run.

### Verdicts — SQLite

File `data/acceptance.db` (path from `PUKS_ACCEPTANCE_DB`, directory created on first open; `data/` is gitignored). WAL journal mode. One table:

```sql
CREATE TABLE IF NOT EXISTS verdict (
  question_id TEXT NOT NULL,
  tester      TEXT NOT NULL,          -- normalised key: trimmed, case-folded, single-spaced
  tester_name TEXT NOT NULL,          -- as typed, for display
  verdict     TEXT NOT NULL CHECK (verdict IN ('pass','partial','fail')),
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,          -- ISO-8601 UTC
  PRIMARY KEY (question_id, tester)
);
```

A tester's later verdict replaces the earlier one. Clearing a verdict deletes the row. No history.

## 2. API — `api/acceptance.py`, router mounted in `api/main.py`

| Route | Behaviour |
|---|---|
| `GET /api/acceptance/questions` | `{ groups: [{ key, title, note, questions: [...] }] }` from the JSON, cached in memory for the process lifetime. |
| `GET /api/acceptance/results` | `{ run: {...} \| null, results: { "<id>": {...} } }`. Missing files → `run: null, results: {}` (page still renders, Results tab says "no run recorded"). |
| `GET /api/acceptance/verdicts?tester=` | `{ verdicts: { "<id>": { verdict, note, updated_at } } }` for that tester. Empty tester → 400. |
| `PUT /api/acceptance/verdicts/{question_id}` | body `{ tester_name, verdict: "pass"\|"partial"\|"fail"\|null, note }`. Upsert; `verdict: null` deletes. Returns the stored row. Unknown id → 404; bad verdict / empty name / name > 60 / note > 500 → 400. |
| `GET /api/acceptance/summary` | per question `{ id, counts: {pass, partial, fail}, testers: [names], disagreement }` plus totals `{ questions, scored, testers, pass_rate }`. |

Rules: `disagreement` is true when a question has verdicts of more than one kind. `pass_rate` = pass / (pass + partial + fail) over all verdicts, or `null` when none. Store access goes through `api/acceptance_store.py` only (`upsert`, `delete`, `for_tester`, `summary`); that module is the seam for a later Azure SQL adapter. Errors are JSON `{ detail }` like the chat routes. Nothing here requires the corpus or a model — the routes work in `PUKS_MOCK=1` and when the engine is not ready.

## 3. UI — `web/app/acceptance/page.tsx`, `web/components/acceptance/*`

### shadcn

`npx shadcn@latest init` in `web/` (Tailwind v4 / CSS-variables style). The generated `--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--destructive` variables are mapped onto the existing AGL tokens in `globals.css` (`--color-ink`, `--color-type`, `--color-agl-blue`, `--color-agl-blue-70/20`, `--color-hazard`) so components render in the charter palette; no second theme. Components added: `tabs, table, badge, button, toggle-group, textarea, dialog, input, progress, tooltip, sonner` (toast).

### Page structure

- Lives inside the app shell (sidebar stays; new **Acceptance** link in the nav). Route `/acceptance`.
- **Name gate**: on first visit a `Dialog` asks for the tester's name (Input, 1–60 chars). Stored in `localStorage` under `puks-tester`. A chip in the page header shows "Scoring as *Name* · change". Nothing is saved until a name exists.
- Header strip: title, the run metadata (date, providers, gate) when a run exists, and the tester's own progress (`Progress`: scored / 65).

### Tabs (`Tabs`)

1. **Questions** — one `Table` per group with the group's title and note. Columns: ID (mono, accent colour; N group in the refuse colour) · question, must-contain (markdown), source (mono) · verdict `ToggleGroup` PASS / PART / FAIL · note `Textarea` (saves on blur or ⌘/Ctrl+Enter). Verdict and note save via `PUT`; optimistic update, revert + toast on failure.
2. **Results** — same grouping. Each row: question, scripted turns when they differ, a status `Badge` (answered / gated refusal / model refusal / self-description / needs context / error), relevance, elapsed, top source, the recorded answer rendered with the existing `Markdown` component, retrieved sources. The same verdict controls as tab 1, bound to the same state, so a tester can score while reading the answer.
3. **Summary** — one `Table`: ID · question · stacked bar of pass/partial/fail counts (pass green, partial ochre, fail red — semantic colours, not the accent) · tester names · "disagree" `Badge` when verdicts differ. Top strip: questions scored, testers, overall pass rate. Filter chips: *all / unscored / disagreements / failures*. Refreshes on tab focus and after each of the tester's own saves.

### Data flow

The page's server component loads questions and results (both static per deploy). The tester's name lives only in the browser, so the client component fetches that tester's verdicts once the name is known, and the summary when the Summary tab is opened. All calls go to Next route handlers under `web/app/api/acceptance/*` that proxy to `FASTAPI_URL` — the browser never learns the API host, same pattern as the chat route.

### Responsiveness and quality floor

Tables scroll horizontally in their own container; the verdict toggle wraps under the question below `md`. Keyboard: toggle group and textarea are focusable with the existing visible focus ring. `prefers-reduced-motion` already covers toasts and dialog transitions via the global rule.

## 4. Testing

- **Python** (`tests/test_acceptance.py`, no network): store upsert / replace / delete / normalisation of tester keys; summary counts, disagreement rule, pass-rate with zero verdicts; route validation (400/404), verdict round-trip through `TestClient` on a temp DB; questions and results routes with missing files.
- **Web**: vitest for the summary/filter helpers and the tester-name normaliser; `tsc --noEmit` and eslint clean.
- **Manual pass before hand-off** (Playwright): name gate, score a question, note persists across reload, second tester name produces a disagreement in Summary, HTML export still builds.

## 5. Migration and compatibility

1. `SCRIPTS/extract_acceptance_questions.py` — one-off HTML → JSON; committed output; script kept for reference.
2. `run_acceptance.py` reads the JSON and writes `acceptance-run.json`.
3. `build_acceptance_page.py` reads the JSON for questions and keeps producing the standalone HTML (still the shareable artifact).
4. `.gitignore` gains `data/`. `.env.example` gains `PUKS_ACCEPTANCE_DB`.

## Out of scope

Authentication, live "ask Puks" from the page, verdict history / audit, exporting verdicts (the summary route is enough for now), the Azure SQL adapter (the store module is its seam), deleting or editing questions from the UI (edit the JSON).
