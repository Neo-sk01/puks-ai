"""Run docs/acceptance-questions.html against the local API (uvicorn on :8001)
and write docs/acceptance-results.json. Then: python SCRIPTS/build_acceptance_page.py"""
import json, re, sys, time, html
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

API = "http://127.0.0.1:8001/api/chat"
SHEET = Path(__file__).resolve().parent.parent / "docs" / "acceptance-questions.html"
OUT = Path(__file__).resolve().parent.parent / "docs" / "acceptance-results.json"

# Questions the sheet phrases as instructions; run them as scripted turns.
SCRIPTED = {
    "C1": [("R1", "How do I create a receipt header in Speed WMS?"), (None, "and which of those fields can I change?")],
    "C2": [("D1", "What does the STK_DAT table hold and what is its primary key?"), (None, "what about its foreign keys?")],
    "C3": [(None, "how to close a grn")],
    "C4": [(None, "stk_dat vs mvt_dat")],
    "C5": [(None, "and which of those fields can I change?")],   # fresh conversation = memory reset
}

def questions():
    s = SHEET.read_text()
    for m in re.finditer(r'data-id="([A-Z]\d+)".*?<p class="ask">(.*?)</p>', s, re.S):
        qid, raw = m.group(1), m.group(2)
        text = html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()
        text = re.sub(r"\s+", " ", text)
        yield qid, text

def chat(message, history):
    t = time.time()
    r = requests.post(API, json={"message": message, "history": history}, stream=True, timeout=180)
    r.raise_for_status()
    ev, out = None, {"tokens": [], "retrieved": None, "done": None, "error": None}
    for line in r.iter_lines(decode_unicode=True):
        if line.startswith("event: "): ev = line[7:].strip()
        elif line.startswith("data: ") and ev:
            d = json.loads(line[6:])
            if ev == "token": out["tokens"].append(d["text"])
            elif ev == "retrieved": out["retrieved"] = d
            elif ev == "done": out["done"] = d
            elif ev == "error": out["error"] = d.get("message")
    out["elapsed_s"] = round(time.time() - t, 1)
    return out

def run_one(item):
    qid, text = item
    turns = SCRIPTED.get(qid, [(None, text)])
    history, last, asked = [], None, []
    for _, msg in turns:
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
        "confidence": (last["retrieved"] or {}).get("confidence"),
        "top_source": (top or {}).get("metadata", {}).get("source_file") or (top or {}).get("metadata", {}).get("source") if top else None,
        "top_category": (top or {}).get("metadata", {}).get("category") if top else None,
        "sources": list(dict.fromkeys(((c.get("metadata") or {}).get("source_file") or (c.get("metadata") or {}).get("source")) for c in ((last["retrieved"] or {}).get("chunks") or []))),
        "elapsed_s": last["elapsed_s"], "error": last["error"],
    }
    print(f"{qid:4} {'REFUSED' if res['refused'] else 'ok     '} {res['confidence'] if res['confidence'] is not None else '-':>6} {res['elapsed_s']:>5}s  {res['top_source']}", flush=True)
    return res

items = list(questions())
print(len(items), "questions"); 
with ThreadPoolExecutor(max_workers=4) as ex:
    results = list(ex.map(run_one, items))
OUT.write_text(json.dumps(results, indent=1, ensure_ascii=False))
print("saved", OUT, "refused:", sum(r["refused"] for r in results), "errors:", sum(bool(r["error"]) for r in results))
