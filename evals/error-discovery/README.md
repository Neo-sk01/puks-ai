# Error discovery — reviewing Puks AI's answers

A review tool for the 65-question acceptance set, at **`/review`** in the
Next.js app. A subject-matter expert reads Puks's answers and marks what is
wrong, in their own words; the notes are grouped into failure modes
afterwards. No grading, no categories, no login.

## For the reviewer

1. Open `/review` (sidebar → **Review**). Read the **How to review** guide —
   two minutes — and enter your name.
2. Work through the queue on the left. Each record shows the **question**, the
   **answer key** (what a correct answer must contain), **what Puks found** (the
   documents it retrieved), and **Puks's answer**. Source excerpts are below.
3. When something is wrong, **select the words** and **write what's wrong** as
   you would to a junior colleague. Enter saves. Nothing wrong — press **Next**.
4. If the *answer key* is wrong or incomplete, say so the same way. It was
   written from the documents, not by the support desk.
5. Purple dashed highlights are suggestions found automatically elsewhere.
   **Accept** if you agree, **Dismiss** if not. Dismissing is quick and costs nothing.

Keyboard: `→` / `←` next and previous, `?` opens the guide.

You will be asked to look at a few records a second time once patterns emerge —
what you notice on the second pass is usually different, and that is expected.

## For whoever runs it

```bash
.venv/bin/python evals/error-discovery/prepare.py    # (re)build records, clusters, initial sample
cd web && npm run dev                                # then open http://localhost:3000/review
```

`prepare.py` joins `docs/acceptance-results.json` to `docs/acceptance-questions.json`
and to the corpus (so each retrieved source file shows its actual passages),
flags statistical outliers, clusters the 65 records (numpy TF-IDF + k-means),
and picks a diverse first sample of 20. It never touches the reviewer's files.

The app reads and writes through `GET/POST /api/review/{key}`
(`web/lib/review-store.ts`; `PUKS_REVIEW_DATA` overrides the local path).
Locally that means this directory. On a standalone deploy (Vercel, where
`POSTGRES_URL`/`DATABASE_URL` is set) the derived documents are bundled into
the build by `web/scripts/prebuild-review-data.mjs` and the mutable ones live
in a `review_doc(key, value)` Postgres table, created on first use — setting
the env var is the entire provisioning story, same as acceptance verdicts.

| File | Written by | Contents |
|---|---|---|
| `annotations.json` | the app | one row per note: record, segment, quoted text, note, reviewer, time |
| `suggestions.json` | the agent, then the app | proposed instances of a failure mode, with `status` pending/accepted/dismissed |
| `patterns.json` | the agent | the running failure-mode taxonomy |
| `samples.json` | `prepare.py`, then the agent | which records are in the queue |
| `records.json`, `graph.json` | `prepare.py` | derived; gitignored — rebuild with `prepare.py` |

The app polls `samples`, `suggestions` and `patterns` every four seconds and
shows a toast when any changes, so an agent (or a person) can push new records
or suggestions while the reviewer works. Annotations are also mirrored to
`localStorage` in the reviewer's browser.

Records are ordered by warehouse area so the reviewer stays in one mental
context at a time. Sample selection is seeded, so `prepare.py` is reproducible.
