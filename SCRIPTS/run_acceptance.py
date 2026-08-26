"""Run docs/acceptance-questions.html against the local API (uvicorn on :8001)
Reads docs/acceptance-questions.json; writes docs/acceptance-results.json and docs/acceptance-run.json."""
import json, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

API = "http://127.0.0.1:8001/api/chat"
OUT = Path(__file__).resolve().parent.parent / "docs" / "acceptance-results.json"
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

def chat(message, history, attempts=2):
    """One streamed turn. A transport failure is recorded on the result, not
    raised — one slow gpt-5 answer must not lose the other 64."""
    t = time.time()
    out = {"tokens": [], "retrieved": None, "done": None, "error": None}
    for attempt in range(attempts):
        try:
            r = requests.post(API, json={"message": message, "history": history}, stream=True, timeout=(10, 300))
            r.raise_for_status()
            ev = None
            for line in r.iter_lines(decode_unicode=True):
                if line.startswith("event: "): ev = line[7:].strip()
                elif line.startswith("data: ") and ev:
                    d = json.loads(line[6:])
                    if ev == "token": out["tokens"].append(d["text"])
                    elif ev == "retrieved": out["retrieved"] = d
                    elif ev == "done": out["done"] = d
                    elif ev == "error": out["error"] = d.get("message")
            break
        except requests.RequestException as exc:
            out = {"tokens": [], "retrieved": None, "done": None, "error": f"{type(exc).__name__}: {exc}"}
    out["elapsed_s"] = round(time.time() - t, 1)
    return out

def run_one(q):
    qid, text = q["id"], q["question"]
    history, last, asked = [], None, []
    for msg in q["asked"]:
        last = chat(msg, history)
        asked.append(msg)
        answer = "".join(last["tokens"]) or ("I do not have enough information to answer this. Please contact support." if (last["done"] or {}).get("refused") else "")
        history += [{"role": "user", "content": msg}]
        if not (last["done"] or {}).get("refused"):
            history += [{"role": "assistant", "content": answer}]
    done = last["done"] or {}
    top = ((last["retrieved"] or {}).get("chunks") or [None])[0]
    res = {
        "id": qid, "question": text, "asked": asked,
        "answer": "".join(last["tokens"]),
        "refused": bool(done.get("refused")), "reason": done.get("reason"),
        "threshold": done.get("threshold"),
        "confidence": (last["retrieved"] or {}).get("confidence"),
        "top_source": (top or {}).get("metadata", {}).get("source_file") or (top or {}).get("metadata", {}).get("source") if top else None,
        "top_category": (top or {}).get("metadata", {}).get("category") if top else None,
        "sources": list(dict.fromkeys(((c.get("metadata") or {}).get("source_file") or (c.get("metadata") or {}).get("source")) for c in ((last["retrieved"] or {}).get("chunks") or []))),
        "elapsed_s": last["elapsed_s"], "error": last["error"],
    }
    state = "ERROR  " if res["error"] else "REFUSED" if res["refused"] else "ok     "
    print(f"{qid:4} {state} {res['confidence'] if res['confidence'] is not None else '-':>6} {res['elapsed_s']:>5}s  {res['top_source'] or res['error'] or ''}", flush=True)
    return res

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
