import streamlit as st
from pathlib import Path
import numpy as np
import pickle
from collections import deque
import faiss
from sentence_transformers import SentenceTransformer, CrossEncoder
from groq import Groq
from rank_bm25 import BM25Okapi
import json

# ==================================================
# PAGE CONFIG
# ==================================================
st.set_page_config(
    page_title="Puks AI (Predictive Unified Knowledge System)",
    page_icon="🚀",
    layout="wide"
)

# ==================================================
# PATHS & CONSTANTS
# ==================================================
CHUNKS_PATH   = Path(r"C:\Users\kgathola.puka\OneDrive - MSC\Documents\GitHub\RCP(test)\SPEED CHATBOT PROJECT\DATA\unified_semantic_chunks\unified_chunks.json")
VECTOR_STORE  = Path(r"C:\Users\kgathola.puka\OneDrive - MSC\Documents\GitHub\RCP(test)\SPEED CHATBOT PROJECT\DATA\vector_store")
FAISS_PATH    = VECTOR_STORE / "faiss.index"
METADATA_PATH = VECTOR_STORE / "metadata.pkl"
CONFIG_PATH   = VECTOR_STORE / "config.json"

VECTOR_CANDIDATES  = 40
RERANK_CANDIDATES  = 25
TOP_K_DEFAULT      = 5
CONFIDENCE_THRESHOLD = 0.01

W_VECTOR  = 0.6
W_BM25    = 0.3
W_HYBRID  = 0.7
W_RERANK  = 0.3

SCHEMA_KEYWORDS = {
    "sql", "select", "query", "join", "where", "insert", "update",
    "column", "columns", "table", "schema", "foreign key", "primary key",
    "field", "fields", "datatype", "varchar", "integer", "structure",
    "definition", "describe", "what is the structure"
}

OPERATIONAL_KEYWORDS = {
    "reverse", "reset", "grn", "receipt", "shipment", "mission",
    "cancel", "validate", "close", "reopen", "resend", "loading",
    "inbound", "outbound", "picking", "putaway", "stock", "movement",
    "how do i", "how to", "steps to", "procedure for"
}

SQL_KEYWORDS = {"join", "sql", "query", "select", "write a query"}

AVAILABLE_MODELS = {
    "openai/gpt-oss-120b"        : "openai/gpt-oss-120b",
    "Llama 4 Maverick 17B (Newest Gen)"   : "meta-llama/llama-4-maverick-17b-128e-instruct",
    "Qwen 3 32B (Structured Reasoning)"   : "qwen/qwen3-32b",
    "Llama 3.1 8B (Fast)"                 : "llama-3.1-8b-instant"
}

# ==================================================
# SIDEBAR
# ==================================================
st.sidebar.title("🤖 Puks AI")
st.sidebar.markdown("Enterprise Speed WMS Intelligence")

page = st.sidebar.selectbox("Navigation", ["💬 Chatbot", " Help & Support"])

st.sidebar.divider()
st.sidebar.subheader(" Model Settings")

selected_model_label = st.sidebar.selectbox("Choose Model", list(AVAILABLE_MODELS.keys()))
SELECTED_MODEL       = AVAILABLE_MODELS[selected_model_label]
debug_mode           = st.sidebar.toggle("🔍 Show Retrieved Context", value=False)

st.sidebar.success(f"Active: {selected_model_label}")
st.sidebar.divider()

if st.sidebar.button("🗑 Reset Conversation Memory"):
    st.session_state.memory   = None
    st.session_state.messages = [{
        "role"   : "assistant",
        "content": "👋 Memory has been reset. You can start a new conversation now."
    }]
    st.rerun()

st.sidebar.caption("© Puks AI System (Predictive Unified Knowledge System)")

# ==================================================
# LOAD VECTOR STORE (Cached — loads once)
# ==================================================
@st.cache_resource
def build_vector_system():
    """
    Loads the pre-built FAISS index and enriched chunks from the vector store.
    Falls back to rebuilding from raw chunks if saved index not found.
    BM25 is always built from raw chunks (no duplicates).
    """
    # --- Load raw chunks for BM25 ---
    with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
        all_chunks = json.load(f)
    raw_chunks = [c for c in all_chunks if c.get("text", "").strip()]

    # --- Load model name from config ---
    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        model_name = cfg.get("model_name", model_name)

    embedding_model = SentenceTransformer(model_name)

    # --- Load pre-built FAISS + enriched chunks if available ---
    if FAISS_PATH.exists() and METADATA_PATH.exists():
        index = faiss.read_index(str(FAISS_PATH))
        with open(METADATA_PATH, "rb") as f:
            enriched_chunks = pickle.load(f)
    else:
        # Fallback: build from raw chunks (no enrichment/boosting)
        st.warning("⚠️ Pre-built vector store not found — building from raw chunks. Run the embedding notebook first for best results.")
        texts      = [c["text"] for c in raw_chunks]
        embeddings = embedding_model.encode(texts, convert_to_numpy=True, show_progress_bar=False).astype("float32")
        faiss.normalize_L2(embeddings)
        dimension  = embeddings.shape[1]
        index      = faiss.IndexFlatIP(dimension)
        index.add(embeddings)
        enriched_chunks = raw_chunks

    # --- BM25 always on raw chunks ---
    tokenized = [c["text"].lower().split() for c in raw_chunks]
    bm25      = BM25Okapi(tokenized)

    return index, raw_chunks, enriched_chunks, bm25, embedding_model


@st.cache_resource
def load_reranker():
    return CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu")


index, raw_chunks, enriched_chunks, bm25, embedding_model = build_vector_system()
reranker = load_reranker()
client   = Groq(api_key=st.secrets["GROQ_API_KEY"])

# ==================================================
# CONVERSATION MEMORY
# ==================================================
class ConversationMemory:
    def __init__(self, max_turns: int = 8):
        self.history = deque(maxlen=max_turns * 2)

    def add_turn(self, question: str, answer: str):
        self.history.append({"role": "user",      "content": question})
        self.history.append({"role": "assistant",  "content": answer})

    def format(self) -> str:
        if not self.history:
            return "(No prior conversation)"
        lines = []
        for m in self.history:
            role    = "USER" if m["role"] == "user" else "ASSISTANT"
            content = m["content"]
            if m["role"] == "assistant" and len(content) > 400:
                content = content[:400] + "... [truncated]"
            lines.append(f"{role}: {content}")
        return "\n".join(lines)

    def clear(self):
        self.history.clear()


if "memory" not in st.session_state or st.session_state.memory is None:
    st.session_state.memory = ConversationMemory(max_turns=8)

# ==================================================
# DOCUMENT TYPE DETECTOR
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

# ==================================================
# QUERY CLASSIFIER
# ==================================================
def classify_query(query: str) -> dict:
    query_lower      = query.lower()
    schema_hits      = [k for k in SCHEMA_KEYWORDS      if k in query_lower]
    operational_hits = [k for k in OPERATIONAL_KEYWORDS if k in query_lower]
    sql_hits         = [k for k in SQL_KEYWORDS          if k in query_lower]

    is_schema      = len(schema_hits) > 0
    is_operational = len(operational_hits) > 0
    is_sql         = len(sql_hits) > 0

    if is_schema and is_operational:
        is_schema = False

    return {
        "is_schema"       : is_schema,
        "is_operational"  : is_operational,
        "is_sql"          : is_sql,
        "schema_hits"     : schema_hits,
        "operational_hits": operational_hits,
    }

# ==================================================
# RETRIEVAL
# ==================================================
def retrieve_context(query: str, top_k: int = TOP_K_DEFAULT):
    query_lower  = query.lower()
    query_tokens = query_lower.split()
    intent       = classify_query(query)

    # --- Vector search ---
    q_emb = embedding_model.encode([query], convert_to_numpy=True).astype("float32")
    faiss.normalize_L2(q_emb)
    scores, indices = index.search(q_emb, VECTOR_CANDIDATES)

    # --- BM25 ---
    bm25_scores = bm25.get_scores(query_tokens)
    bm25_max    = bm25_scores.max() if bm25_scores.max() > 0 else 1.0
    bm25_norm   = bm25_scores / bm25_max

    # --- Merge & deduplicate ---
    seen_texts = {}

    for vector_score, idx in zip(scores[0], indices[0]):
        if idx == -1:
            continue

        chunk    = enriched_chunks[idx]
        metadata = chunk.get("metadata", {})
        doc_type = detect_document_type(chunk)
        text     = chunk["text"]

        if text in seen_texts:
            continue

        # Map to raw chunk for BM25 score
        source   = metadata.get("source", "")
        chunk_id = chunk.get("chunk_id", -1)
        raw_idx  = next(
            (i for i, c in enumerate(raw_chunks)
             if c.get("metadata", {}).get("source") == source
             and c.get("chunk_id") == chunk_id),
            None
        )
        bm25_score = float(bm25_norm[raw_idx]) if raw_idx is not None else 0.0

        v_norm = (float(vector_score) + 1) / 2
        hybrid = (W_VECTOR * v_norm) + (W_BM25 * bm25_score)

        # Intent boosts
        if intent["is_operational"] and doc_type == "OPERATIONAL_REFERENCE":
            hybrid += 0.4
        if intent["is_schema"] and doc_type == "TABLE_SCHEMA":
            hybrid += 0.3

        # Name match boosts
        table_name = metadata.get("table_name", "")
        if table_name and table_name.lower() in query_lower:
            hybrid += 0.5

        proc_name = metadata.get("procedure_name", "")
        if proc_name and proc_name.lower() in query_lower:
            hybrid += 0.4

        for rt in metadata.get("related_tables", []):
            if rt and rt.lower() in query_lower:
                hybrid += 0.2
                break

        seen_texts[text] = {
            "hybrid_score"   : hybrid,
            "vector_score"   : v_norm,
            "bm25_score"     : bm25_score,
            "doc_type"       : doc_type,
            "text"           : text,
            "metadata"       : metadata,
            "structured_data": chunk.get("structured_data")
        }

    if not seen_texts:
        return [], 0.0

    results    = sorted(seen_texts.values(), key=lambda x: x["hybrid_score"], reverse=True)
    candidates = results[:RERANK_CANDIDATES]

    # --- Rerank ---
    pairs         = [(query, r["text"]) for r in candidates]
    rerank_scores = reranker.predict(pairs)

    for i, r in enumerate(candidates):
        r["rerank_score"] = float(rerank_scores[i])
        r["final_score"]  = (W_HYBRID * r["hybrid_score"]) + (W_RERANK * r["rerank_score"])

    candidates  = sorted(candidates, key=lambda x: x["final_score"], reverse=True)
    top_results = candidates[:top_k]
    confidence  = float(np.mean([r["final_score"] for r in top_results]))

    return top_results, confidence

# ==================================================
# VALIDATORS
# ==================================================
def validate_context(retrieved: list, confidence: float) -> bool:
    if not retrieved:
        return False
    if confidence < CONFIDENCE_THRESHOLD:
        return False
    return True


def validate_answer(answer: str) -> bool:
    if not answer or len(answer.strip()) < 20:
        return False
    error_phrases = ["error occurred", "exception", "traceback"]
    if any(p in answer.lower() for p in error_phrases):
        return False
    return True

# ==================================================
# PROMPT BUILDER
# ==================================================
def build_context_text(retrieved: list) -> tuple:
    context_sections = []
    has_schema        = False
    has_operational   = False

    for r in retrieved:
        metadata   = r.get("metadata", {})
        text       = r.get("text", "")
        structured = r.get("structured_data")
        doc_type   = r.get("doc_type", "TEXT")

        if doc_type == "TABLE_SCHEMA" and isinstance(structured, dict) and "columns" in structured:
            has_schema  = True
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
                "─" * 80
            ]
            for col in columns:
                col_lines = [
                    f"  Name        : {col.get('name', 'UNKNOWN')}",
                    f"  Description : {col.get('description', 'N/A')}",
                    f"  SQL Server  : {col.get('type_sql_server', 'N/A')}",
                    f"  Oracle      : {col.get('type_oracle', 'N/A')}",
                    f"  Primary Key : {'Yes' if col.get('is_primary_key') else 'No'}",
                    f"  Foreign Key : {'Yes' if col.get('is_foreign_key') else 'No'}",
                ]
                if col.get("references_table"):
                    col_lines.append(
                        f"  References  : {col['references_table']}.{col.get('references_column','?')}"
                    )
                lines.extend(col_lines)
                lines.append("  " + "─" * 40)
            text = "\n".join(lines)

        elif doc_type == "OPERATIONAL_REFERENCE":
            has_operational = True

        context_sections.append(
            f"[SOURCE: {metadata.get('source','unknown')} | "
            f"CATEGORY: {metadata.get('category','unknown')} | "
            f"TYPE: {doc_type} | "
            f"TABLE: {metadata.get('table_name','N/A')}]\n{text}"
        )

    return "\n\n".join(context_sections), has_schema, has_operational


def build_prompt(query: str, retrieved: list, memory_text: str, intent: dict) -> str:
    context_text, has_schema, has_operational = build_context_text(retrieved)

    query_lower        = query.lower()
    is_schema_question = any(w in query_lower for w in [
        "column", "columns", "schema", "structure", "fields",
        "table definition", "describe", "what is the structure"
    ])

    schema_hint = ""
    if has_schema and is_schema_question:
        schema_hint = """
SCHEMA MODE ACTIVE:
- Provide the COMPLETE schema definition
- Include: Table Name, Description, Primary Key, Total Columns
- List ALL columns with: Name, Description, SQL Server Type, Oracle Type, PK (Yes/No), FK (Yes/No), References
- Do NOT skip any columns
- Do NOT omit metadata
- If schema is incomplete in context, state that explicitly
"""

    sql_hint = ""
    if intent["is_sql"]:
        sql_hint = """
SQL MODE ACTIVE:
- Generate production-ready SQL only
- Use explicit JOIN conditions based on FK relationships in the context
- Do NOT use SELECT *
- Do NOT invent tables or columns not present in the context
- Use proper indentation and formatting
- Only return SELECT queries unless the user explicitly asks for UPDATE/INSERT
- Base all JOIN logic strictly on the foreign key relationships in the metadata
"""

    operational_hint = ""
    if has_operational:
        operational_hint = """
OPERATIONAL MODE ACTIVE:
- Follow the exact procedure steps described in the context
- Reference the specific SQL provided if present
- Respect all safety rules listed in the context
- State the access level required for the procedure
"""

    prompt = f"""You are the Technical Architect of Speed WMS.

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
{schema_hint}
{sql_hint}
{operational_hint}

Provide a clear, professional, well-structured response:"""

    return prompt.strip()

# ==================================================
# LLM CALL
# ==================================================
def get_llm_answer(prompt: str, model: str) -> str:
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role"   : "system",
                    "content": (
                        "You are a Speed WMS expert and Technical Architect. "
                        "You answer strictly from provided context. "
                        "You never invent information."
                    )
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0,
            max_tokens=2048
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        return f"❌ LLM error: {e}"

# ==================================================
# MAIN ASK FUNCTION
# ==================================================
def ask(question: str, model: str) -> tuple:
    memory = st.session_state.memory

    retrieved, confidence = retrieve_context(question)
    intent                = classify_query(question)

    if not validate_context(retrieved, confidence):
        return (
            "I do not have enough information to answer this confidently. "
            "Please contact support.",
            [],
            confidence
        )

    prompt = build_prompt(
        query       = question,
        retrieved   = retrieved,
        memory_text = memory.format(),
        intent      = intent
    )

    answer = get_llm_answer(prompt, model=model)

    if not validate_answer(answer):
        return (
            "I was unable to generate a valid response. "
            "Please rephrase your question or contact support.",
            retrieved,
            confidence
        )

    memory.add_turn(question, answer)

    return answer, retrieved, confidence

# ==================================================
# CHAT PAGE
# ==================================================
if page == "💬 Chatbot":
    st.title("🚀 Puks AI")
    st.caption("Speed WMS Retrieval-Augmented Intelligence System")

    if "messages" not in st.session_state:
        st.session_state.messages = [{
            "role"   : "assistant",
            "content": "👋 Welcome. I am Puks — your Speed WMS Retrieval-Augmented Intelligence System. How can I help you today?"
        }]

    # Render chat history
    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    # Handle new input
    user_input = st.chat_input("Ask anything about Speed WMS...")

    if user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})

        with st.chat_message("user"):
            st.markdown(user_input)

        with st.chat_message("assistant"):
            with st.spinner("🔍 Analyzing documentation..."):
                answer, retrieved, confidence = ask(user_input, model=SELECTED_MODEL)

            # Debug panel
            if debug_mode and retrieved:
                with st.expander(f"🔍 Retrieved Context ({len(retrieved)} chunks | confidence: {confidence:.3f})"):
                    for i, r in enumerate(retrieved, 1):
                        st.markdown(f"**Rank {i}**")
                        cols = st.columns(4)
                        cols[0].metric("Final Score",  round(r.get("final_score",  0), 3))
                        cols[1].metric("Hybrid Score", round(r.get("hybrid_score", 0), 3))
                        cols[2].metric("Rerank Score", round(r.get("rerank_score", 0), 3))
                        cols[3].metric("Doc Type",     r.get("doc_type", "?"))
                        st.json(r["metadata"])
                        st.text(r["text"][:600])
                        st.divider()

            st.markdown(answer)
            st.caption(f" Confidence: {confidence:.3f} | Model: {selected_model_label}")

        st.session_state.messages.append({"role": "assistant", "content": answer})

# ==================================================
# HELP PAGE
# ==================================================
if page == " Help & Support":
    st.header(" Help & Support")
    st.markdown("Use this form to report issues or request assistance.")

    with st.form("support_form"):
        name      = st.text_input("Your Name")
        email     = st.text_input("Your Email")
        category  = st.selectbox("Issue Category", [
            "SQL Generation", "Schema Query", "Operational Procedure",
            "Wrong Answer", "Missing Information", "Other"
        ])
        issue     = st.text_area("Describe your issue", height=150)
        submitted = st.form_submit_button("Submit")

    if submitted:
        if not name or not email or not issue:
            st.error("❌ Please fill in all fields before submitting.")
        else:
            st.success("✅ Support request captured. The team will follow up shortly.")
            st.info(f"**Name:** {name} | **Email:** {email} | **Category:** {category}")