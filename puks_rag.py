"""
Puks AI — retrieval and generation core.

Provider-neutral at the call sites, Azure Foundry underneath. No Streamlit
imports live here, so this module is reusable by a FastAPI/Next.js backend.

Two providers, selected by PUKS_PROVIDER (see .env.example):

    azure   (default)  one Azure Foundry resource — production
    openai             public OpenAI + public Cohere APIs — local development

The models are the same either way, so an index built on one serves the other:

    embeddings   text-embedding-3-large   (3072-dim)
    reranking    Cohere rerank            (Cohere /v2/rerank route)
    generation   gpt-5                    (reasoning model — see call_llm)

`enrich_text()` and `detect_document_type()` live here rather than in the
notebooks because the index builder and the query path MUST agree on them.
If they drift, retrieval quality drops and nothing errors.
"""

from __future__ import annotations

import json
import os
import pickle
import re as _re
from collections import defaultdict
from pathlib import Path

import faiss
import numpy as np
import requests
from dotenv import load_dotenv
from openai import AzureOpenAI, OpenAI
from rank_bm25 import BM25Okapi

# Local development reads .env.local (overrides) then .env. Neither is ever
# committed; on App Service the app settings are already in the environment
# and take precedence over both — load_dotenv never overwrites a set variable.
_ROOT = Path(__file__).resolve().parent
load_dotenv(_ROOT / ".env.local")
load_dotenv(_ROOT / ".env")

# ==================================================
# PATHS
# ==================================================
BASE            = Path(__file__).resolve().parent
CHUNKS_PATH     = BASE / "DATA" / "unified_semantic_chunks" / "unified_chunks.json"
VECTOR_STORE    = BASE / "DATA" / "vector_store"
FAISS_PATH      = VECTOR_STORE / "faiss.index"
METADATA_PATH   = VECTOR_STORE / "metadata.json"   # written by SCRIPTS/build_index.py
LEGACY_METADATA = VECTOR_STORE / "metadata.pkl"    # MiniLM-era artifact, read-only
CONFIG_PATH     = VECTOR_STORE / "config.json"

# ==================================================
# CONFIG — all from environment (App Service app settings, or .env locally)
# ==================================================
AI_ENDPOINT      = os.getenv("AZURE_AI_ENDPOINT", "")
AI_KEY           = os.getenv("AZURE_AI_KEY", "").strip()
AI_API_VERSION   = os.getenv("AZURE_AI_API_VERSION", "2025-04-01-preview")

OPENAI_KEY       = os.getenv("OPENAI_API_KEY", "").strip()
COHERE_KEY       = os.getenv("COHERE_API_KEY", "").strip()

# Providers, one per role. PUKS_PROVIDER is the default for all three;
# PUKS_CHAT_PROVIDER / PUKS_EMBED_PROVIDER / PUKS_RERANK_PROVIDER override a
# single role. This exists because AGL's Foundry resource (aift003) deploys
# gpt-5 and nothing else — no embedding model, no Cohere rerank — and the
# account that runs this cannot create deployments. Generation therefore runs
# in the tenant while embeddings and rerank reach the public OpenAI and Cohere
# APIs. Same models either way, so one index serves every combination.
#
# Unset, PUKS_PROVIDER prefers Azure when it is configured and falls back to
# OpenAI only when an OpenAI key is the sole credential, so a production box
# with Azure settings can never be redirected by a stray OPENAI_API_KEY.
_PROVIDERS = ("azure", "openai")


def _provider(var: str, default: str) -> str:
    value = os.getenv(var, "").lower() or default
    if value not in _PROVIDERS:
        raise RuntimeError(f"{var} must be one of {_PROVIDERS}, got {value!r}")
    return value


PROVIDER        = _provider("PUKS_PROVIDER", "openai" if OPENAI_KEY and not AI_KEY else "azure")
CHAT_PROVIDER   = _provider("PUKS_CHAT_PROVIDER", PROVIDER)
EMBED_PROVIDER  = _provider("PUKS_EMBED_PROVIDER", PROVIDER)

if CHAT_PROVIDER == "openai":
    CHAT_DEPLOYMENT = os.getenv("OPENAI_CHAT_MODEL", "gpt-5")
else:
    CHAT_DEPLOYMENT = os.getenv("AZURE_CHAT_DEPLOYMENT", "gpt-5")

if EMBED_PROVIDER == "openai":
    EMBED_DEPLOYMENT = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-large")
    EMBED_DIMENSIONS = int(os.getenv("OPENAI_EMBED_DIMENSIONS", "3072"))
else:
    EMBED_DEPLOYMENT = os.getenv("AZURE_EMBED_DEPLOYMENT", "text-embedding-3-large")
    EMBED_DIMENSIONS = int(os.getenv("AZURE_EMBED_DIMENSIONS", "3072"))

# The Cohere rerank models do NOT use the chat/embeddings inference route.
# Microsoft: "To perform inferencing with Cohere rerank models, you're required
# to use Cohere's custom rerank APIs." Read the real route off the deployment
# page in the Foundry portal after deploying, and set AZURE_RERANK_ENDPOINT to
# it. Under the openai provider the same payload goes to Cohere's public API,
# which needs only COHERE_API_KEY.
#
# Rerank falls back on its own: with no AZURE_RERANK_ENDPOINT but a
# COHERE_API_KEY present, public Cohere is used rather than skipping reranking
# — confidence is read from the rerank score, so no reranker means every
# query is refused. Set PUKS_RERANK_PROVIDER to pin it.
_AZURE_RERANK = os.getenv("AZURE_RERANK_ENDPOINT", "")
RERANK_PROVIDER = _provider(
    "PUKS_RERANK_PROVIDER",
    "openai" if (PROVIDER == "openai" or (not _AZURE_RERANK and COHERE_KEY)) else "azure",
)
if RERANK_PROVIDER == "openai":
    RERANK_ENDPOINT = os.getenv("COHERE_RERANK_ENDPOINT", "https://api.cohere.com/v2/rerank") if COHERE_KEY else ""
    RERANK_MODEL    = os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5")
    RERANK_KEY      = COHERE_KEY
else:
    RERANK_ENDPOINT = _AZURE_RERANK
    RERANK_MODEL    = os.getenv("AZURE_RERANK_MODEL", "Cohere-rerank-v4.0-pro")
    RERANK_KEY      = os.getenv("AZURE_RERANK_KEY", "") or AI_KEY

PROVIDERS = {"chat": CHAT_PROVIDER, "embed": EMBED_PROVIDER, "rerank": RERANK_PROVIDER}

REASONING_EFFORT = os.getenv("PUKS_REASONING_EFFORT", "low")
VERBOSITY        = os.getenv("PUKS_VERBOSITY", "medium")
MAX_OUTPUT       = int(os.getenv("PUKS_MAX_OUTPUT_TOKENS", "4096"))

# ==================================================
# RETRIEVAL CONSTANTS
# ==================================================
DENSE_CANDIDATES  = 60      # from FAISS, over the whole index
BM25_CANDIDATES   = 60      # from BM25, over the whole corpus — independently
FUSED_CANDIDATES  = 50      # handed to Cohere rerank
TOP_K_DEFAULT     = 5
RRF_K             = 60      # standard Reciprocal Rank Fusion constant

# Cohere returns a calibrated relevance score in [0, 1], so unlike the old
# CrossEncoder logit this threshold means something. It still needs calibrating
# against the eight seed queries in SCRIPTS/05_retrieval_testing.ipynb.
CONFIDENCE_THRESHOLD = float(os.getenv("PUKS_CONFIDENCE_THRESHOLD", "0.30"))

SCHEMA_KEYWORDS = {
    "sql", "select", "query", "join", "where", "insert", "update",
    "column", "columns", "table", "schema", "foreign key", "primary key",
    "field", "fields", "datatype", "varchar", "integer", "structure",
    "definition", "describe", "what is the structure",
}
OPERATIONAL_KEYWORDS = {
    "reverse", "reset", "grn", "receipt", "shipment", "mission",
    "cancel", "validate", "close", "reopen", "resend", "loading",
    "inbound", "outbound", "picking", "putaway", "stock", "movement",
    "how do i", "how to", "steps to", "procedure for",
}
SQL_KEYWORDS = {"join", "sql", "query", "select", "write a query"}


class ConfigError(RuntimeError):
    """Raised when a required credential or endpoint is missing."""


def _require_config(provider: str) -> tuple[str, str]:
    if provider == "openai":
        if not OPENAI_KEY:
            raise ConfigError(
                "OPENAI_API_KEY not set but a role is on the openai provider. "
                "Copy .env.example to .env.local and fill it in."
            )
        return OPENAI_KEY, ""
    missing = [name for name, value in
               (("AZURE_AI_KEY", AI_KEY), ("AZURE_AI_ENDPOINT", AI_ENDPOINT))
               if not value]
    if missing:
        raise ConfigError(
            f"{' and '.join(missing)} not set. Copy .env.example to .env and fill it in.\n"
            "  az cognitiveservices account keys list "
            "-g <resource-group> -n <foundry-resource> --query key1 -o tsv"
        )
    return AI_KEY, AI_ENDPOINT


_clients: dict[str, OpenAI] = {}


def get_client(role: str = "chat") -> OpenAI:
    """Lazily built OpenAI-compatible client for a role ("chat" or "embed").

    One client per provider, shared across roles that use it."""
    provider = PROVIDERS[role]
    if provider not in _clients:
        key, endpoint = _require_config(provider)
        if provider == "openai":
            _clients[provider] = OpenAI(api_key=key)
        else:
            _clients[provider] = AzureOpenAI(
                azure_endpoint=endpoint,
                api_key=key,
                api_version=AI_API_VERSION,
            )
    return _clients[provider]


# ==================================================
# CHUNK CLASSIFICATION  (must match the index builder exactly)
# ==================================================
def detect_document_type(chunk: dict) -> str:
    chunk_type = chunk.get("metadata", {}).get("chunk_type", "")

    if chunk_type in ("schema_overview", "schema_core_columns", "schema_extra_columns"):
        return "TABLE_SCHEMA"
    if chunk_type in ("wms_overview", "wms_join_logic", "wms_procedure", "wms_safety_rules"):
        return "OPERATIONAL_REFERENCE"
    if chunk_type in ("text_prose", "text_table"):
        return "TEXT"

    structured = chunk.get("structured_data")
    if isinstance(structured, dict):
        if "columns" in structured:
            return "TABLE_SCHEMA"
        if "procedures" in structured or "core_tables" in structured:
            return "OPERATIONAL_REFERENCE"
    return "TEXT"


def enrich_text(chunk: dict) -> str:
    """
    Prepend structured metadata to chunk text before embedding.

    Ported verbatim from SCRIPTS/04_embeddings_and_vector_store.ipynb cell 4.
    Do not change this without re-embedding the whole corpus — the index and
    the query path must have been built by the same function.
    """
    text       = chunk["text"]
    metadata   = chunk.get("metadata", {})
    structured = chunk.get("structured_data")
    doc_type   = detect_document_type(chunk)
    chunk_type = metadata.get("chunk_type", "")

    prefix = []

    if metadata.get("category"):
        prefix.append(f"CATEGORY: {metadata['category']}")
    if metadata.get("source"):
        prefix.append(f"SOURCE: {metadata['source']}")
    prefix.append(f"DOCUMENT TYPE: {doc_type}")

    if doc_type == "TABLE_SCHEMA":
        table_name = metadata.get("table_name", "")
        if table_name:
            prefix.append(f"TABLE NAME: {table_name}")

        related = metadata.get("related_tables", [])
        if related:
            prefix.append(f"RELATED TABLES: {', '.join(related)}")

        if chunk_type == "schema_overview" and isinstance(structured, dict):
            columns = structured.get("columns", [])
            fk_cols = [c for c in columns if c.get("is_foreign_key")]
            prefix.append(f"PRIMARY KEY: {structured.get('primary_key', 'N/A')}")
            if fk_cols:
                fk_summary = ", ".join(
                    f"{c['name']}→{c.get('references_table', '?')}" for c in fk_cols
                )
                prefix.append(f"FOREIGN KEYS: {fk_summary}")

    if doc_type == "OPERATIONAL_REFERENCE":
        prefix.append("CONTAINS VERIFIED OPERATIONAL SQL PROCEDURES")

        if chunk_type == "wms_procedure" and isinstance(structured, dict):
            if structured.get("procedure_name"):
                prefix.append(f"PROCEDURE: {structured['procedure_name']}")
            if structured.get("business_logic"):
                prefix.append(f"BUSINESS LOGIC: {structured['business_logic']}")
            if structured.get("access_level"):
                prefix.append(f"ACCESS LEVEL: {structured['access_level']}")

        if chunk_type == "wms_join_logic" and isinstance(structured, dict):
            inbound  = structured.get("inbound", {})
            outbound = structured.get("outbound", {})
            if inbound:
                prefix.append(f"INBOUND JOIN KEYS: {', '.join(inbound.get('primary_keys', []))}")
            if outbound:
                prefix.append(f"OUTBOUND JOIN KEYS: {', '.join(outbound.get('primary_keys', []))}")

        related = metadata.get("related_tables", [])
        if related:
            prefix.append(f"TABLES INVOLVED: {', '.join(related)}")

        prefix.append(
            "KEYWORDS: reverse, resend, reset, grn, receipt, order, "
            "movement, mission, loading, stock, inbound, outbound"
        )

    if doc_type == "TEXT":
        if metadata.get("page_number"):
            prefix.append(f"PAGE: {metadata['page_number']}")
        if metadata.get("content_type"):
            prefix.append(f"CONTENT TYPE: {metadata['content_type']}")

    return "\n".join(prefix) + "\n\n" + text


def bm25_text(chunk: dict) -> str:
    """
    Lexical index text. Deliberately NOT `enrich_text` — the KEYWORDS line it
    appends is identical across every operational chunk, so indexing it would
    make "reverse" match all 82 of them equally. Table and procedure names are
    included because WMS queries turn on exact codes (REE_DAT, ZPA, DLUO).
    """
    metadata = chunk.get("metadata", {})
    parts = [chunk.get("text", "")]
    for field in ("table_name", "procedure_name", "source", "category"):
        if metadata.get(field):
            parts.append(str(metadata[field]))
    parts.extend(str(t) for t in metadata.get("related_tables", []) if t)
    return " ".join(parts)


# ==================================================
# PROVIDERS
# ==================================================
def embed_texts(texts: list[str], batch_size: int = 64) -> np.ndarray:
    """Embed with text-embedding-3-large. Returns L2-normalised float32."""
    client = get_client("embed")
    vectors: list[list[float]] = []

    for start in range(0, len(texts), batch_size):
        batch = texts[start:start + batch_size]
        response = client.embeddings.create(
            model=EMBED_DEPLOYMENT,
            input=batch,
            dimensions=EMBED_DIMENSIONS,
        )
        vectors.extend(item.embedding for item in sorted(response.data, key=lambda d: d.index))

    array = np.asarray(vectors, dtype="float32")
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    return array / np.clip(norms, 1e-10, None)


def cohere_rerank(query: str, documents: list[str], top_n: int) -> list[tuple[int, float]]:
    """
    Rerank via Cohere on Foundry. Returns [(original_index, relevance_score)]
    ordered best-first, scores in [0, 1].

    Degrades to identity order on failure rather than taking the app down —
    a reranker outage should cost precision, not availability.
    """
    if not documents:
        return []
    if not RERANK_ENDPOINT:
        print("[rerank] AZURE_RERANK_ENDPOINT not set — using fusion order")
        return [(i, 0.0) for i in range(min(top_n, len(documents)))]

    try:
        response = requests.post(
            RERANK_ENDPOINT,
            headers={
                "Authorization": f"Bearer {RERANK_KEY}",
                "api-key": RERANK_KEY,
                "Content-Type": "application/json",
            },
            json={
                "model": RERANK_MODEL,
                "query": query,
                "documents": documents,
                "top_n": min(top_n, len(documents)),
            },
            timeout=20,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        return [(r["index"], float(r["relevance_score"])) for r in results]
    except Exception as exc:  # noqa: BLE001 — availability beats precision here
        print(f"[rerank] falling back to fusion order: {exc}")
        return [(i, 0.0) for i in range(min(top_n, len(documents)))]


def call_llm(prompt: str, system: str) -> str:
    """
    Generate with gpt-5.

    gpt-5 is a reasoning model: it takes `max_completion_tokens`, and rejects
    `temperature`, `top_p`, `max_tokens` and the penalty parameters outright.
    The old Groq call passed temperature=0 and max_tokens — both would 400 here.
    """
    try:
        completion = get_client().chat.completions.create(
            model=CHAT_DEPLOYMENT,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_completion_tokens=MAX_OUTPUT,
            reasoning_effort=REASONING_EFFORT,
            verbosity=VERBOSITY,
        )
        return (completion.choices[0].message.content or "").strip()
    except TypeError:
        # Older openai SDKs do not know `verbosity`. Retry without it.
        completion = get_client().chat.completions.create(
            model=CHAT_DEPLOYMENT,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_completion_tokens=MAX_OUTPUT,
            reasoning_effort=REASONING_EFFORT,
        )
        return (completion.choices[0].message.content or "").strip()


def call_llm_stream(prompt: str, system: str):
    """Stream generation with gpt-5. Yields content deltas as they arrive.

    Same parameter set as call_llm — reasoning models take max_completion_tokens
    and reject temperature/top_p/max_tokens. Verified against Microsoft Learn
    2026-08-21: gpt-5 (2025-08-07) supports streaming on Chat Completions
    alongside reasoning_effort.

    The `verbosity` retry sits around create() only, which runs before the first
    yield — retrying after tokens had been emitted would replay them.
    """
    kwargs = {
        "model":                 CHAT_DEPLOYMENT,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
        "max_completion_tokens": MAX_OUTPUT,
        "reasoning_effort":      REASONING_EFFORT,
        "stream":                True,
    }

    try:
        stream = get_client().chat.completions.create(verbosity=VERBOSITY, **kwargs)
    except TypeError:
        # Older openai SDKs do not know `verbosity`. Retry without it.
        stream = get_client().chat.completions.create(**kwargs)

    for chunk in stream:
        # Azure emits chunks with an empty `choices` list for prompt filter
        # results and for the final usage chunk.
        if not chunk.choices:
            continue
        text = chunk.choices[0].delta.content
        if text:
            yield text


# ==================================================
# INDEX LOADING
# ==================================================
class Corpus:
    """The loaded index, chunk metadata and lexical index."""

    def __init__(self) -> None:
        if not FAISS_PATH.exists():
            raise ConfigError(
                f"No index at {FAISS_PATH}. Build one with:\n"
                "  python SCRIPTS/build_index.py"
            )

        self.index  = faiss.read_index(str(FAISS_PATH))
        self.config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}

        if METADATA_PATH.exists():
            self.chunks: list[dict] = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
        elif LEGACY_METADATA.exists():
            # The MiniLM-era store shipped metadata.pkl. Chunks are plain dicts,
            # so the current builder writes JSON instead; unpickling is kept only
            # to read that pre-existing local artifact, which we produced
            # ourselves. Never point this at a file from an untrusted source —
            # and note the dimension check below rejects that index anyway.
            with open(LEGACY_METADATA, "rb") as fh:
                self.chunks = pickle.load(fh)  # noqa: S301
        else:
            raise ConfigError(
                f"No chunk metadata beside the index at {VECTOR_STORE}. "
                "Rebuild with: python SCRIPTS/build_index.py"
            )

        expected = self.config.get("dimension", EMBED_DIMENSIONS)
        if self.index.d != expected or self.index.d != EMBED_DIMENSIONS:
            raise ConfigError(
                f"Index is {self.index.d}-dim but AZURE_EMBED_DIMENSIONS is "
                f"{EMBED_DIMENSIONS} (config says {expected}). The index was built "
                "with a different embedding model. Rebuild it: python SCRIPTS/build_index.py"
            )
        if self.index.ntotal != len(self.chunks):
            raise ConfigError(
                f"Index has {self.index.ntotal} vectors but metadata has "
                f"{len(self.chunks)} chunks. They are out of sync — rebuild."
            )

        self.bm25 = BM25Okapi([bm25_text(c).lower().split() for c in self.chunks])

        # source+chunk_id → position, for exact-name lookups
        self._by_table: dict[str, list[int]] = defaultdict(list)
        self._by_proc: dict[str, list[int]] = defaultdict(list)
        for i, chunk in enumerate(self.chunks):
            meta = chunk.get("metadata", {})
            if meta.get("table_name"):
                self._by_table[str(meta["table_name"]).lower()].append(i)
            if meta.get("procedure_name"):
                self._by_proc[str(meta["procedure_name"]).lower()].append(i)

    def exact_name_hits(self, query_lower: str) -> list[int]:
        """Chunks whose table or procedure name appears literally in the query."""
        hits: list[int] = []
        for name, positions in self._by_table.items():
            if name and name in query_lower:
                hits.extend(positions)
        for name, positions in self._by_proc.items():
            if name and name in query_lower:
                hits.extend(positions)
        seen, ordered = set(), []
        for i in hits:
            if i not in seen:
                seen.add(i)
                ordered.append(i)
        return ordered


# ==================================================
# QUERY CLASSIFIER
# ==================================================
def classify_query(query: str) -> dict:
    """
    Note: the old implementation zeroed `is_schema` whenever both fired, which
    inverted intent on queries like "list all columns in the receipt header
    table REE_DAT" — "receipt" is an operational keyword. Both flags now stand;
    fusion and reranking sort out precedence.
    """
    q = query.lower()
    schema_hits      = [k for k in SCHEMA_KEYWORDS if k in q]
    operational_hits = [k for k in OPERATIONAL_KEYWORDS if k in q]
    sql_hits         = [k for k in SQL_KEYWORDS if k in q]

    return {
        "is_schema":        bool(schema_hits),
        "is_operational":   bool(operational_hits),
        "is_sql":           bool(sql_hits),
        "schema_hits":      schema_hits,
        "operational_hits": operational_hits,
    }


# ==================================================
# CONVERSATION MEMORY
# ==================================================
# Ported verbatim from the Streamlit ConversationMemory. These rules are part
# of the prompt, not a display concern: the model sees this text. The API is
# stateless — the client sends raw history and the server formats it — so that
# the truncation and labelling rules cannot drift into the front end.
MEMORY_MAX_TURNS   = 8
MEMORY_TRUNCATE_AT = 400


def format_memory(history: list[dict], max_turns: int = MEMORY_MAX_TURNS) -> str:
    """Render a message list as the CONVERSATION HISTORY block of the prompt."""
    if not history:
        return "(No prior conversation)"

    lines = []
    for message in history[-(max_turns * 2):]:
        role    = "USER" if message["role"] == "user" else "ASSISTANT"
        content = message["content"]
        if message["role"] == "assistant" and len(content) > MEMORY_TRUNCATE_AT:
            content = content[:MEMORY_TRUNCATE_AT] + "... [truncated]"
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


# ==================================================
# RETRIEVAL — true hybrid, fused by RRF, reranked by Cohere
# ==================================================
# Warehouse shorthand the documentation does not use. "how to close a grn"
# embedded and reranked as written lands on the one ticket whose title says
# GRN (Jinko Solar, 0.69) while "Receipt closure" ranks sixth (0.54); the
# same question with "receipt" scores 0.895 on the right file. Substituting
# the corpus's own word fixes the dense and rerank signals. Merely appending
# the word does not: the reranker still prefers the literal-GRN ticket. The
# original tokens are kept for BM25 only (see retrieve_context) so files
# titled with the abbreviation stay reachable lexically.
_QUERY_ALIASES = {
    "grn":  "receipt",
    "grns": "receipts",
    "gdn":  "delivery note",
    "gdns": "delivery notes",
    "lpn":  "support",
    "lpns": "supports",
    "mo":   "manufacturing order",
    "po":   "purchase order",
    "sku":  "item",
    "skus": "items",
    "asn":  "expected reception",
}
_ALIAS_RE = _re.compile(r"\b(" + "|".join(sorted(_QUERY_ALIASES, key=len, reverse=True)) + r")\b", _re.IGNORECASE)


def expand_query(query: str) -> str:
    """Replace warehouse abbreviations with the word the documentation uses."""
    return _ALIAS_RE.sub(lambda m: _QUERY_ALIASES[m.group(1).lower()], query)


def retrieve_context(corpus: Corpus, query: str, top_k: int = TOP_K_DEFAULT):
    """
    Dense and lexical retrieval run INDEPENDENTLY over the full corpus, then
    fuse by Reciprocal Rank Fusion.

    The previous implementation searched FAISS for 40 candidates and then only
    re-weighted those same 40 with BM25, so BM25 could never surface anything
    dense retrieval had missed — a recall ceiling of 40/627. A document findable
    only by an exact code (REE_DAT, LPN, ZPA, DLUO) was invisible if the
    semantic search missed it. Both retrievers now see everything.
    """
    original_lower = query.lower()
    query = expand_query(query)
    query_lower = query.lower()
    intent = classify_query(original_lower)

    # --- Dense, over the whole index ---
    q_vec = embed_texts([query])
    scores, indices = corpus.index.search(q_vec, min(DENSE_CANDIDATES, corpus.index.ntotal))
    dense_ranked = [int(i) for i in indices[0] if i != -1]

    # --- Lexical, over the whole corpus, independently ---
    bm25_terms = list(dict.fromkeys(original_lower.split() + query_lower.split()))
    bm25_scores = corpus.bm25.get_scores(bm25_terms)
    bm25_ranked = [
        int(i) for i in np.argsort(bm25_scores)[::-1][:BM25_CANDIDATES]
        if bm25_scores[int(i)] > 0
    ]

    # --- Exact table/procedure name match, a third signal ---
    exact_ranked = corpus.exact_name_hits(original_lower)

    # --- Reciprocal Rank Fusion ---
    fused: dict[int, float] = defaultdict(float)
    for weight, ranking in ((1.0, dense_ranked), (1.0, bm25_ranked), (0.5, exact_ranked)):
        for rank, idx in enumerate(ranking):
            fused[idx] += weight / (RRF_K + rank + 1)

    if not fused:
        return [], 0.0

    ordered = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)[:FUSED_CANDIDATES]

    candidates = []
    for idx, fusion_score in ordered:
        chunk = corpus.chunks[idx]
        candidates.append({
            "index":           idx,
            "fusion_score":    fusion_score,
            "in_dense":        idx in dense_ranked,
            "in_bm25":         idx in bm25_ranked,
            "in_exact":        idx in exact_ranked,
            "doc_type":        detect_document_type(chunk),
            "text":            chunk["text"],
            "metadata":        chunk.get("metadata", {}),
            "structured_data": chunk.get("structured_data"),
        })

    # --- Cohere rerank ---
    reranked = cohere_rerank(query, [c["text"] for c in candidates], top_n=max(top_k * 3, 15))

    results = []
    for position, relevance in reranked:
        if position >= len(candidates):
            continue
        item = dict(candidates[position])
        item["relevance_score"] = relevance
        results.append(item)

    top_results = results[:top_k]
    # Confidence is Cohere's relevance for the single best hit — a calibrated
    # 0-1 quantity, not the unbounded CrossEncoder logit the old threshold
    # compared against.
    confidence = float(top_results[0]["relevance_score"]) if top_results else 0.0

    return top_results, confidence


def validate_context(retrieved: list, confidence: float) -> bool:
    return bool(retrieved) and confidence >= CONFIDENCE_THRESHOLD


# ==================================================
# CONTEXT ASSEMBLY
# ==================================================
# Keys already shown in the header block, so not repeated in the body.
_HEADER_KEYS = {"procedure_name", "business_logic", "access_level",
                "category", "document_name"}
# Wrappers whose only job is to hold a SQL string.
_SQL_KEYS = {"sql", "example_sql", "query_sql"}


def _render_value(value, indent: int = 2) -> list[str]:
    """Render arbitrary structured_data into flat, model-readable lines."""
    pad = " " * indent

    if value is None or value == "" or value == [] or value == {}:
        return []

    if isinstance(value, str):
        return [f"{pad}{line}" for line in value.strip().splitlines() if line.strip()]

    if isinstance(value, (int, float, bool)):
        return [f"{pad}{value}"]

    if isinstance(value, list):
        lines: list[str] = []
        for item in value:
            if isinstance(item, (dict, list)):
                lines.extend(_render_value(item, indent))
            else:
                lines.append(f"{pad}- {item}")
        return lines

    if isinstance(value, dict):
        # {"sql": "SELECT ..."} and friends carry nothing but the statement.
        if value and set(value) <= _SQL_KEYS:
            return [f"{pad}{v}" for v in value.values() if v]

        # Keys are printed verbatim. Prettifying them (underscores to spaces,
        # upper-casing) corrupts the ones that are database identifiers rather
        # than labels — `core_tables` is keyed by table name, so REE_DAT would
        # reach the model as "REE DAT" and it would echo that back in SQL.
        lines = []
        for key, val in value.items():
            if isinstance(val, (dict, list)):
                rendered = _render_value(val, indent + 2)
                if rendered:
                    lines.append(f"{pad}{key}:")
                    lines.extend(rendered)
            elif val not in (None, ""):
                lines.append(f"{pad}{key}: {val}")
        return lines

    return [f"{pad}{value}"]


def _render_steps(steps: list) -> list[str]:
    """Numbered procedure steps, each of which may carry SQL and operator actions."""
    lines: list[str] = []
    for position, step in enumerate(steps, 1):
        if not isinstance(step, dict):
            lines.append(f"  {position}. {step}")
            continue

        number = step.get("step_number", position)
        lines.append(f"  {number}. {step.get('description', '(no description)')}")

        for key in ("query", "validate_before_update"):
            if step.get(key):
                lines.append("     VALIDATE:")
                lines.extend(_render_value(step[key], 7))
        if step.get("update"):
            lines.append("     UPDATE:")
            lines.extend(_render_value(step["update"], 7))
        for key in ("sql", "example_sql"):
            if step.get(key):
                lines.append("     SQL:")
                lines.extend(_render_value(step[key], 7))
        if step.get("actions"):
            lines.append("     ACTIONS:")
            lines.extend(_render_value(step["actions"], 7))
        lines.append("")
    return lines


def _render_procedure(structured) -> str:
    """
    Render an OPERATIONAL_REFERENCE chunk's structured_data.

    The old build_context_text set a flag for this branch and fell through to
    raw text, so everything here — validate_before_update queries, UPDATE
    statements, numbered steps, join conditions, core table glossaries — was
    silently dropped before the prompt was built. Twenty-two procedure chunks
    under 400 characters carried content the model never saw.

    Rendering is generic rather than an allowlist: the corpus carries 40+
    distinct keys (`query`, `core_tables`, `inbound`, `locations_to_zones`,
    `article_to_dimensions`, ...) and an allowlist silently drops whatever it
    has not been told about — which is how this bug happened the first time.
    """
    if not isinstance(structured, dict):
        return ""

    lines: list[str] = []

    if structured.get("procedure_name"):
        lines.append(f"PROCEDURE     : {structured['procedure_name']}")
    if structured.get("document_name"):
        lines.append(f"DOCUMENT      : {structured['document_name']}")
    if structured.get("business_logic"):
        lines.append(f"BUSINESS LOGIC: {structured['business_logic']}")
    if structured.get("access_level"):
        lines.append(f"ACCESS LEVEL  : {structured['access_level']}")

    for key, value in structured.items():
        if key in _HEADER_KEYS or value in (None, "", [], {}):
            continue

        label = key.replace("_", " ").upper()

        if key in ("steps", "procedures") and isinstance(value, list):
            rendered = _render_steps(value)
        else:
            rendered = _render_value(value, 2)

        if rendered:
            lines.append("")
            lines.append(f"{label}:")
            lines.extend(rendered)

    return "\n".join(lines).rstrip()


def _render_schema(structured) -> str:
    table_name  = structured.get("table_name", "UNKNOWN")
    description = structured.get("description", "N/A")
    primary_key = structured.get("primary_key", "N/A")
    columns     = structured.get("columns", [])

    lines = [
        f"TABLE NAME   : {table_name}",
        f"DESCRIPTION  : {description}",
        f"PRIMARY KEY  : {primary_key}",
        f"TOTAL COLUMNS: {len(columns)}",
        "",
        "COLUMNS:",
        "─" * 80,
    ]
    for col in columns:
        lines.extend([
            f"  Name        : {col.get('name', 'UNKNOWN')}",
            f"  Description : {col.get('description', 'N/A')}",
            f"  SQL Server  : {col.get('type_sql_server', 'N/A')}",
            f"  Oracle      : {col.get('type_oracle', 'N/A')}",
            f"  Primary Key : {'Yes' if col.get('is_primary_key') else 'No'}",
            f"  Foreign Key : {'Yes' if col.get('is_foreign_key') else 'No'}",
        ])
        if col.get("references_table"):
            lines.append(
                f"  References  : {col['references_table']}.{col.get('references_column', '?')}"
            )
        lines.append("  " + "─" * 40)
    return "\n".join(lines)


def build_context_text(retrieved: list) -> tuple[str, bool, bool]:
    sections        = []
    has_schema      = False
    has_operational = False

    for r in retrieved:
        metadata   = r.get("metadata", {})
        structured = r.get("structured_data")
        doc_type   = r.get("doc_type", "TEXT")
        text       = r.get("text", "")

        if doc_type == "TABLE_SCHEMA" and isinstance(structured, dict) and "columns" in structured:
            has_schema = True
            text = _render_schema(structured)

        elif doc_type == "OPERATIONAL_REFERENCE":
            has_operational = True
            rendered = _render_procedure(structured)
            if rendered:
                text = f"{text}\n\n{rendered}" if text.strip() else rendered

        sections.append(
            f"[SOURCE: {metadata.get('source', 'unknown')} | "
            f"CATEGORY: {metadata.get('category', 'unknown')} | "
            f"TYPE: {doc_type} | "
            f"TABLE: {metadata.get('table_name', 'N/A')}]\n{text}"
        )

    return "\n\n".join(sections), has_schema, has_operational


SYSTEM_PROMPT = (
    "You are a Speed WMS expert and Technical Architect. "
    "You answer strictly from provided context. "
    "You never invent information."
)


def build_prompt(query: str, retrieved: list, memory_text: str, intent: dict) -> str:
    context_text, has_schema, has_operational = build_context_text(retrieved)

    hints = []

    # Fires on any retrieved schema chunk that carries columns, including
    # schema_core_columns and schema_extra_columns — the old version gated on
    # schema_overview alone, so the 32 chunks that actually enumerate columns
    # never triggered schema mode.
    if has_schema:
        hints.append(
            "SCHEMA MODE ACTIVE:\n"
            "- Provide the COMPLETE schema definition\n"
            "- Include: Table Name, Description, Primary Key, Total Columns\n"
            "- List ALL columns with: Name, Description, SQL Server Type, "
            "Oracle Type, PK (Yes/No), FK (Yes/No), References\n"
            "- Do NOT skip any columns\n"
            "- If the schema is incomplete in the context, state that explicitly"
        )

    if intent["is_sql"]:
        hints.append(
            "SQL MODE ACTIVE:\n"
            "- Generate production-ready SQL only\n"
            "- Use explicit JOIN conditions based on FK relationships in the context\n"
            "- Do NOT use SELECT *\n"
            "- Do NOT invent tables or columns not present in the context\n"
            "- Only return SELECT queries unless the user explicitly asks for UPDATE/INSERT\n"
            "- Base all JOIN logic strictly on the foreign key relationships in the metadata"
        )

    if has_operational:
        hints.append(
            "OPERATIONAL MODE ACTIVE:\n"
            "- Follow the exact procedure steps described in the context\n"
            "- Reproduce the specific SQL provided, including any "
            "validate-before-update query, verbatim\n"
            "- Respect all safety rules listed in the context\n"
            "- State the access level required for the procedure"
        )

    return f"""You are the Technical Architect of Speed WMS.

CRITICAL RULES:
- Answer STRICTLY using the provided context below
- Do NOT invent columns, tables, relationships, or procedures
- Do NOT use general SQL knowledge to fill gaps
- If the answer is not in the context, respond exactly:
  "I do not have enough information to answer this. Please contact support."

======================
CONVERSATION HISTORY
======================
{memory_text}

======================
RETRIEVED CONTEXT
======================
{context_text}

======================
USER QUESTION
======================
{query}

======================
INSTRUCTIONS
======================
{chr(10).join(hints) if hints else "(none)"}

Provide a clear, professional, well-structured response:""".strip()


REFUSAL_TEXT = ("I do not have enough information to answer this. "
                "Please contact support.")


def _prepare(corpus: Corpus, query: str, memory_text: str, top_k: int):
    """Shared front half of both answer paths: retrieve, classify, guard, build prompt.

    Returns (retrieved, confidence, intent, prompt). `prompt` is None when the
    context fails the confidence gate — the single place that decision is made,
    so the streaming and non-streaming paths cannot drift apart.
    """
    retrieved, confidence = retrieve_context(corpus, query, top_k=top_k)
    intent = classify_query(query)

    if not validate_context(retrieved, confidence):
        return retrieved, confidence, intent, None

    return retrieved, confidence, intent, build_prompt(query, retrieved, memory_text, intent)


# ==================================================
# SELF-DESCRIPTION — "what can you do?" is a question about the assistant,
# not about Speed WMS. Nothing in the corpus matches it, so retrieval would
# refuse (measured: top hit Gauge.txt at 0.205). Answer it from a description
# built off the loaded corpus instead, and never call the model for it.
# ==================================================
_SELF_PATTERNS = [
    r"\byour (capabilit|abilit|feature|purpose|function|scope|limit)",
    r"\bwhat (can|do|could) you (do|know|help|answer|cover)\b",
    r"\bwhat (are|is) you\b",
    r"\bwho (are|made|built|created) you\b",
    r"\bwhat (are you|is this|is puks|does puks)\b",
    r"\b(how|what) (do|should) i (ask|use) (you|this|puks)\b",
    r"\bwhat topics\b",
    r"^\s*(hi|hello|hey|help|\?)\s*[!.?]*\s*$",
]
_SELF_RE = _re.compile("|".join(_SELF_PATTERNS), _re.IGNORECASE)

_CATEGORY_LABELS = {
    "Database Tables":     "Speed database tables (schemas, keys, joins)",
    "Speed Support Document": "Internal support procedures and SQL fixes",
    "Support Ticket Docs": "Resolved support tickets",
    "LOREAL":              "L'Oréal-specific specifications",
}


def is_self_description(query: str) -> bool:
    """True for questions about the assistant itself rather than about Speed WMS."""
    return bool(_SELF_RE.search(query))


def self_description(corpus) -> str:
    """Capabilities answer, listing the documentation areas actually loaded."""
    counts: dict[str, int] = defaultdict(int)
    for chunk in getattr(corpus, "chunks", []) or []:
        category = (chunk.get("metadata") or {}).get("category")
        if category:
            counts[category] += 1
    areas = sorted(counts, key=lambda c: -counts[c])
    bullets = "\n".join(
        f"- {_CATEGORY_LABELS.get(a, a.capitalize())}" for a in areas
    ) or "- Speed WMS documentation"

    return (
        "I am **Puks**, a support assistant for **Speed WMS**. I answer questions "
        "strictly from the warehouse documentation loaded into my knowledge base — "
        "I retrieve the relevant pages first and answer only from what they say, "
        "citing the source document.\n\n"
        "**Documentation areas I cover:**\n"
        f"{bullets}\n\n"
        "**Good questions to ask:** how a procedure works (\"How do I close a receipt?\"), "
        "what a status code or field means, which table or column holds something, "
        "how tables join, and how a known support issue was resolved.\n\n"
        "**What I cannot do:** I cannot see live warehouse data or stock levels, "
        "run queries, change anything in Speed, or answer questions outside this "
        "documentation. When the documents do not cover a question, I say so "
        "rather than guessing."
    )


# A follow-up with nothing to follow. After "Reset conversation memory" the
# UI sends no history, and "and which of those fields can I change?" then
# retrieves *something* (Global changes.txt at 0.47) and gets answered as if
# it were about that. Leading anaphora with no history means the question
# cannot be resolved; say so instead of guessing what "those" was.
NO_HISTORY = "(No prior conversation)"
_FOLLOWUP_RE = _re.compile(
    r"^\s*(and|also|what about|how about|same for|the same|those|these|it|its|that|then|"
    r"what about its|and its|and the other|the other one)\b",
    _re.IGNORECASE,
)
NEEDS_CONTEXT_TEXT = (
    "That sounds like a follow-up, but there is no earlier conversation for me to "
    "connect it to — conversation memory may have been reset. Which receipt, order, "
    "table or procedure are you asking about? Ask the full question and I will answer "
    "from the Speed WMS documentation."
)


def is_unanchored_followup(query: str, memory_text: str) -> bool:
    """True when the question leans on prior context and there is none."""
    return memory_text.strip() == NO_HISTORY and bool(_FOLLOWUP_RE.match(query))


def answer(corpus: Corpus, query: str, memory_text: str = "(No prior conversation)",
           top_k: int = TOP_K_DEFAULT) -> dict:
    """End-to-end: retrieve, guard, generate. Blocking; see answer_stream to stream."""
    if is_unanchored_followup(query, memory_text):
        return {
            "answer":     NEEDS_CONTEXT_TEXT,
            "retrieved":  [],
            "confidence": 0.0,
            "intent":     classify_query(query),
            "refused":    False,
        }

    if is_self_description(query):
        return {
            "answer":     self_description(corpus),
            "retrieved":  [],
            "confidence": 0.0,
            "intent":     classify_query(query),
            "refused":    False,
        }

    retrieved, confidence, intent, prompt = _prepare(corpus, query, memory_text, top_k)

    if prompt is None:
        return {
            "answer":     REFUSAL_TEXT,
            "retrieved":  retrieved,
            "confidence": confidence,
            "intent":     intent,
            "refused":    True,
        }

    return {
        "answer":     call_llm(prompt, SYSTEM_PROMPT),
        "retrieved":  retrieved,
        "confidence": confidence,
        "intent":     intent,
        "refused":    False,
    }


# Fields sent to the browser. `structured_data` is deliberately absent: the UI
# never displayed it, build_context_text already folded it into the prompt, and
# it is not uniformly shaped (README 5.2).
WIRE_FIELDS = ("index", "fusion_score", "in_dense", "in_bm25", "in_exact",
               "doc_type", "relevance_score", "metadata", "text")


def wire_chunk(chunk: dict) -> dict:
    """Project a retrieved chunk down to the fields the front end renders."""
    return {field: chunk[field] for field in WIRE_FIELDS if field in chunk}


def answer_stream(corpus: Corpus, query: str, memory_text: str = "(No prior conversation)",
                  top_k: int = TOP_K_DEFAULT):
    """Streaming sibling of answer().

    Yields ("retrieved", {chunks, confidence, intent}) as soon as retrieval is
    done — before generation begins — then ("token", {"text": ...}) per delta,
    then ("done", {...}). A refusal short-circuits straight to "done".

    A self-description question emits no "retrieved" event at all — nothing
    was retrieved — just the canned text as tokens, then "done" with
    reason "self_description".
    """
    if is_unanchored_followup(query, memory_text):
        yield "token", {"text": NEEDS_CONTEXT_TEXT}
        yield "done", {"refused": False, "reason": "needs_context", "model": "none"}
        return

    if is_self_description(query):
        for paragraph in self_description(corpus).split("\n\n"):
            yield "token", {"text": paragraph + "\n\n"}
        yield "done", {"refused": False, "reason": "self_description", "model": "none"}
        return

    retrieved, confidence, intent, prompt = _prepare(corpus, query, memory_text, top_k)

    yield "retrieved", {
        "chunks":     [wire_chunk(chunk) for chunk in retrieved],
        "confidence": confidence,
        "intent":     intent,
    }

    if prompt is None:
        yield "done", {
            "refused":    True,
            "reason":     "below_threshold",
            "confidence": confidence,
            "threshold":  CONFIDENCE_THRESHOLD,
        }
        return

    for token in call_llm_stream(prompt, SYSTEM_PROMPT):
        yield "token", {"text": token}

    yield "done", {"refused": False, "model": CHAT_DEPLOYMENT}
