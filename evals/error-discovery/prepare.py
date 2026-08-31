"""Build the error-discovery dataset from the acceptance set.

Joins docs/acceptance-results.json (what Puks answered) to
docs/acceptance-questions.json (what a correct answer must contain) and to the
corpus (what text was actually available under each retrieved source file),
then clusters the records and picks a diverse initial sample.

Writes data/records.json, data/graph.json, data/samples.json. Idempotent;
never touches annotations.json, patterns.json or suggestions.json.

numpy only — no scikit-learn in the project venv.
"""
from __future__ import annotations

import json
import math
import re
import random
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
DATA.mkdir(exist_ok=True)

RESULTS = ROOT / "docs" / "acceptance-results.json"
QUESTIONS = ROOT / "docs" / "acceptance-questions.json"
CORPUS = ROOT / "DATA" / "unified_semantic_chunks" / "unified_chunks.json"

SEED = 20260828
N_CLUSTERS = 8
SAMPLE_TARGET = 20


def norm_source(s: str | None) -> str:
    """'Creating a receipt header.txt' and 'Creating a receipt header · RECEIVING GOODS'
    should compare equal. Lowercase, drop extension, keep the part before any separator."""
    if not s:
        return ""
    s = s.split("·")[0].split("/")[0]
    s = re.sub(r"\.(txt|json)$", "", s.strip(), flags=re.I)
    return re.sub(r"\s+", " ", s).strip().lower()


def source_matches(expected: str, top: str | None) -> bool | None:
    e, t = norm_source(expected), norm_source(top)
    if not e:
        return None
    return bool(t) and (e == t or e in t or t in e)


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z][a-z_]{2,}", text.lower())


def tfidf(docs: list[list[str]]) -> np.ndarray:
    df = Counter()
    for d in docs:
        df.update(set(d))
    vocab = {w: i for i, w in enumerate(w for w, c in df.items() if c >= 2)}
    n = len(docs)
    X = np.zeros((n, len(vocab)), dtype=np.float32)
    for r, d in enumerate(docs):
        tf = Counter(w for w in d if w in vocab)
        for w, c in tf.items():
            X[r, vocab[w]] = (1 + math.log(c)) * math.log(n / df[w])
    norms = np.linalg.norm(X, axis=1, keepdims=True)
    norms[norms == 0] = 1
    return X / norms


def kmeans(X: np.ndarray, k: int, seed: int, iters: int = 50) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    # k-means++ init
    centers = [X[rng.integers(len(X))]]
    for _ in range(1, k):
        d2 = np.min([np.sum((X - c) ** 2, axis=1) for c in centers], axis=0)
        probs = d2 / d2.sum()
        centers.append(X[rng.choice(len(X), p=probs)])
    C = np.stack(centers)
    labels = np.zeros(len(X), dtype=int)
    for _ in range(iters):
        d = ((X[:, None, :] - C[None, :, :]) ** 2).sum(axis=2)
        new = d.argmin(axis=1)
        if np.array_equal(new, labels):
            break
        labels = new
        for j in range(k):
            m = labels == j
            if m.any():
                C[j] = X[m].mean(axis=0)
    return labels, C


def pca2(X: np.ndarray) -> np.ndarray:
    Xc = X - X.mean(axis=0)
    U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
    P = Xc @ Vt[:2].T
    # Sparse TF-IDF PCA piles most points into one blob with a few far outliers.
    # Blend the raw projection with its rank order so the map stays readable
    # while preserving the gross cluster geometry.
    lo, hi = P.min(axis=0), P.max(axis=0)
    lin = (P - lo) / np.where(hi - lo == 0, 1, hi - lo)
    rank = np.argsort(np.argsort(P, axis=0), axis=0) / max(1, len(P) - 1)
    return 0.4 * lin + 0.6 * rank


def main() -> None:
    results = json.loads(RESULTS.read_text())
    questions = {q["id"]: q for q in json.loads(QUESTIONS.read_text())}
    corpus = json.loads(CORPUS.read_text())

    by_source: dict[str, list[dict]] = {}
    for ch in corpus:
        sf = (ch.get("metadata") or {}).get("source_file")
        if sf:
            by_source.setdefault(sf, []).append(ch)

    # dataset-level stats for outlier flags
    answerable = [r for r in results if questions[r["id"]]["kind"] == "answer"]
    lengths = sorted(len(r["answer"]) for r in results)
    elapsed = sorted(r["elapsed_s"] for r in results)
    confs = sorted(r["confidence"] for r in answerable if r.get("confidence") is not None)
    p90_len = lengths[int(0.9 * len(lengths))]
    p90_el = elapsed[int(0.9 * len(elapsed))]
    p10_conf = confs[int(0.1 * len(confs))]

    records = []
    for r in results:
        q = questions[r["id"]]
        match = source_matches(q.get("source", ""), r.get("top_source"))
        flags = []
        if len(r["answer"]) >= p90_len and r["answer"]:
            flags.append(f"answer longer than 90% ({len(r['answer']):,} chars)")
        if r["elapsed_s"] >= p90_el:
            flags.append(f"slower than 90% ({r['elapsed_s']}s)")
        if match is False:
            flags.append("top source ≠ expected")
        if q["kind"] == "answer" and r.get("confidence") is not None and r["confidence"] <= p10_conf:
            flags.append(f"relevance in bottom 10% ({r['confidence']:.3f})")
        if q["kind"] == "refuse" and not r["refused"]:
            flags.append("answered a should-refuse question")
        if q["kind"] == "answer" and r["refused"]:
            flags.append("refused an answerable question")

        excerpts = []
        for sf in r.get("sources") or []:
            chunks = by_source.get(sf, [])
            excerpts.append({
                "source_file": sf,
                "is_top": sf == r.get("top_source"),
                "category": (chunks[0].get("metadata") or {}).get("category") if chunks else None,
                "chunks": [{"chunk_type": (c.get("metadata") or {}).get("chunk_type"), "text": c["text"]} for c in chunks[:4]],
                "n_chunks": len(chunks),
            })

        records.append({
            "id": r["id"],
            "group": q["group"],
            "group_title": q["group_title"],
            "kind": q["kind"],
            "question": r["question"],
            "asked": r["asked"],
            "must_contain": q["must_contain"],
            "expected_source": q.get("source", ""),
            "answer": r["answer"],
            "refused": r["refused"],
            "reason": r["reason"],
            "confidence": r.get("confidence"),
            "threshold": r.get("threshold"),
            "top_source": r.get("top_source"),
            "top_category": r.get("top_category"),
            "sources": r.get("sources") or [],
            "source_match": match,
            "elapsed_s": r["elapsed_s"],
            "error": r.get("error"),
            "flags": flags,
            "excerpts": excerpts,
        })

    # features: tf-idf over question + answer + group label, plus a few scalars
    docs = [tokenize(f"{x['group_title']} {x['question']} {x['answer']}") for x in records]
    X = tfidf(docs)
    scal = np.array([
        [math.log1p(len(x["answer"])), x["confidence"] or 0.0, 1.0 if x["refused"] else 0.0,
         0.0 if x["source_match"] is None else (1.0 if x["source_match"] else -1.0)]
        for x in records
    ], dtype=np.float32)
    scal = (scal - scal.mean(axis=0)) / (scal.std(axis=0) + 1e-6)
    F = np.hstack([X, 0.35 * scal])

    labels, C = kmeans(F, N_CLUSTERS, SEED)
    P = pca2(F)

    graph = [{
        "id": x["id"], "x": float(P[i, 0]), "y": float(P[i, 1]), "cluster": int(labels[i]),
        "group": x["group"], "kind": x["kind"], "refused": x["refused"],
        "source_match": x["source_match"], "title": x["question"][:90],
    } for i, x in enumerate(records)]

    # sample: 1–2 nearest each centroid, then random fill
    rng = random.Random(SEED)
    chosen: list[str] = []
    for j in range(N_CLUSTERS):
        idx = np.where(labels == j)[0]
        if not len(idx):
            continue
        d = ((F[idx] - C[j]) ** 2).sum(axis=1)
        order = idx[np.argsort(d)]
        take = 2 if len(idx) >= 6 else 1
        for i in order[:take]:
            chosen.append(records[i]["id"])
    # guarantee coverage of the interesting minorities
    for x in records:
        if x["kind"] == "refuse" and x["id"] not in chosen and sum(1 for c in chosen if questions[c]["kind"] == "refuse") < 2:
            chosen.append(x["id"])
    mism = [x["id"] for x in records if x["source_match"] is False and x["id"] not in chosen]
    rng.shuffle(mism)
    chosen.extend(mism[:3])
    pool = [x["id"] for x in records if x["id"] not in chosen]
    rng.shuffle(pool)
    while len(chosen) < SAMPLE_TARGET and pool:
        chosen.append(pool.pop())
    # order the sample by group so the reviewer moves through one area at a time
    chosen.sort(key=lambda i: (questions[i]["group"], i))

    (DATA / "records.json").write_text(json.dumps(records, ensure_ascii=False, indent=1))
    (DATA / "graph.json").write_text(json.dumps(graph, ensure_ascii=False))
    (DATA / "samples.json").write_text(json.dumps({"ids": chosen, "note": "Initial sample: cluster representatives + refusals + source mismatches + random."}, indent=1))
    for name, default in (("annotations.json", []), ("patterns.json", {}), ("suggestions.json", [])):
        p = DATA / name
        if not p.exists():
            p.write_text(json.dumps(default))

    print(f"{len(records)} records, {N_CLUSTERS} clusters, sample of {len(chosen)}: {', '.join(chosen)}")
    print("cluster sizes:", Counter(int(l) for l in labels))


if __name__ == "__main__":
    main()
