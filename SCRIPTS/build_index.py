#!/usr/bin/env python3
"""
Rebuild DATA/vector_store from DATA/unified_semantic_chunks/unified_chunks.json.

Replaces the embedding half of 04_embeddings_and_vector_store.ipynb. Embeddings
now come from text-embedding-3-large on Foundry rather than a local MiniLM, so
the index dimension changes from 384 to 3072 and the old store is unusable.

    export AZURE_AI_KEY=$(az cognitiveservices account keys list \
      -g <resource-group> -n <foundry-resource> --query key1 -o tsv)
    python SCRIPTS/build_index.py

One deliberate change from the notebook: each chunk is embedded ONCE.

The notebook embedded wms_procedure and schema_overview chunks twice
(OPERATIONAL_BOOST = 2, plus a hardcoded schema_overview duplication), giving
673 vectors for 627 chunks. It never worked as a ranking boost — identical
vectors produce identical inner products in an exact IndexFlatIP search, land
adjacently, and the app's dedup kept the first at exactly the rank it would
have held anyway. It only consumed a candidate slot, and now it would also cost
duplicate embedding calls.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import faiss
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from puks_rag import (  # noqa: E402
    CHUNKS_PATH,
    CONFIG_PATH,
    EMBED_DEPLOYMENT,
    EMBED_DIMENSIONS,
    FAISS_PATH,
    METADATA_PATH,
    PROVIDER,
    VECTOR_STORE,
    detect_document_type,
    embed_texts,
    enrich_text,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would be embedded, call nothing.")
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()

    if not CHUNKS_PATH.exists():
        print(f"✗ No corpus at {CHUNKS_PATH}", file=sys.stderr)
        return 1

    chunks = json.loads(CHUNKS_PATH.read_text(encoding="utf-8"))
    print(f"📂 Corpus        : {CHUNKS_PATH}")
    print(f"📊 Chunks        : {len(chunks)}")

    type_counts = Counter(c.get("metadata", {}).get("chunk_type", "unknown") for c in chunks)
    doc_counts  = Counter(detect_document_type(c) for c in chunks)

    print("\n📊 chunk_type breakdown:")
    for name, count in type_counts.most_common():
        print(f"   {name:<28} {count:>5}")
    print("\n📊 document type breakdown:")
    for name, count in doc_counts.most_common():
        print(f"   {name:<28} {count:>5}")

    texts = [enrich_text(c) for c in chunks]
    chars = sum(len(t) for t in texts)
    print(f"\n🔤 Enriched texts: {len(texts)}  ({chars:,} chars, ~{chars // 4:,} tokens)")

    if args.dry_run:
        print("\n— dry run, nothing embedded —")
        print(f"   would call  : {EMBED_DEPLOYMENT} @ {EMBED_DIMENSIONS} dims")
        print(f"   would write : {FAISS_PATH}")
        return 0

    print(f"\n🔄 Embedding via {EMBED_DEPLOYMENT} ({EMBED_DIMENSIONS} dims)...")
    embeddings = embed_texts(texts, batch_size=args.batch_size)
    print(f"✅ Embeddings    : {embeddings.shape}")

    norms = np.linalg.norm(embeddings, axis=1)
    print(f"   norms min/max : {norms.min():.4f} / {norms.max():.4f}")

    index = faiss.IndexFlatIP(embeddings.shape[1])
    index.add(embeddings)
    print(f"✅ Index         : IndexFlatIP, {index.ntotal} vectors, d={index.d}")

    VECTOR_STORE.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(FAISS_PATH))
    METADATA_PATH.write_text(json.dumps(chunks, ensure_ascii=False), encoding="utf-8")
    CONFIG_PATH.write_text(json.dumps({
        "model_name":        EMBED_DEPLOYMENT,
        "provider":          PROVIDER,
        "total_vectors":     index.ntotal,
        "dimension":         index.d,
        "index_type":        "IndexFlatIP",
        "normalised":        True,
        "duplicated_chunks": False,
        "chunk_type_counts": dict(type_counts),
    }, indent=2), encoding="utf-8")

    print(f"\n💾 {FAISS_PATH}")
    print(f"💾 {METADATA_PATH}")
    print(f"💾 {CONFIG_PATH}")

    stale = VECTOR_STORE / "metadata.pkl"
    if stale.exists():
        print(f"\n⚠️  {stale} is the MiniLM-era artifact and is now unused. Delete it.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
