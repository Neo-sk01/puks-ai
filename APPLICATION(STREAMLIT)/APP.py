"""
Puks AI — Streamlit front end.

UI only. Retrieval, reranking and generation live in puks_rag.py at the repo
root so a FastAPI or Next.js backend can reuse them unchanged.
"""

import sys
from collections import deque
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import puks_rag  # noqa: E402
from puks_rag import ConfigError, Corpus, TOP_K_DEFAULT  # noqa: E402

st.set_page_config(
    page_title="Puks AI (Predictive Unified Knowledge System)",
    page_icon="🚀",
    layout="wide",
)


# ==================================================
# CORPUS (loaded once per worker)
# ==================================================
@st.cache_resource
def load_corpus() -> Corpus:
    return Corpus()


# ==================================================
# CONVERSATION MEMORY
# ==================================================
class ConversationMemory:
    def __init__(self, max_turns: int = 8):
        self.history = deque(maxlen=max_turns * 2)

    def add_turn(self, question: str, answer: str):
        self.history.append({"role": "user", "content": question})
        self.history.append({"role": "assistant", "content": answer})

    def format(self) -> str:
        if not self.history:
            return "(No prior conversation)"
        lines = []
        for m in self.history:
            role = "USER" if m["role"] == "user" else "ASSISTANT"
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
# SIDEBAR
# ==================================================
st.sidebar.title("🤖 Puks AI")
st.sidebar.markdown("Enterprise Speed WMS Intelligence")

page = st.sidebar.selectbox("Navigation", ["💬 Chatbot", "ℹ️ About"])

st.sidebar.divider()
st.sidebar.subheader("Retrieval")

top_k = st.sidebar.slider("Chunks passed to the model", 3, 10, TOP_K_DEFAULT)
debug_mode = st.sidebar.toggle("🔍 Show retrieved context", value=False)

st.sidebar.divider()
st.sidebar.caption(
    f"**Generation** `{puks_rag.CHAT_DEPLOYMENT}`  \n"
    f"**Embeddings** `{puks_rag.EMBED_DEPLOYMENT}`  \n"
    f"**Reranker** `{puks_rag.RERANK_MODEL}`"
)

if st.sidebar.button("🗑 Reset conversation memory"):
    st.session_state.memory = None
    st.session_state.messages = [{
        "role": "assistant",
        "content": "👋 Memory has been reset. You can start a new conversation now.",
    }]
    st.rerun()

st.sidebar.caption("© Puks AI (Predictive Unified Knowledge System)")


# ==================================================
# CHAT
# ==================================================
if page == "💬 Chatbot":
    st.title("🚀 Puks AI")
    st.caption("Speed WMS Retrieval-Augmented Intelligence System")

    try:
        corpus = load_corpus()
    except ConfigError as exc:
        st.error(f"**Not ready to answer questions.**\n\n```\n{exc}\n```")
        st.stop()

    if "messages" not in st.session_state:
        st.session_state.messages = [{
            "role": "assistant",
            "content": "👋 Welcome. I am Puks — your Speed WMS Retrieval-Augmented "
                       "Intelligence System. How can I help you today?",
        }]

    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    user_input = st.chat_input("Ask anything about Speed WMS...")

    if user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})
        with st.chat_message("user"):
            st.markdown(user_input)

        with st.chat_message("assistant"):
            with st.spinner("🔍 Searching documentation..."):
                try:
                    result = puks_rag.answer(
                        corpus,
                        user_input,
                        memory_text=st.session_state.memory.format(),
                        top_k=top_k,
                    )
                except ConfigError as exc:
                    st.error(str(exc))
                    st.stop()
                except Exception as exc:  # noqa: BLE001 — surface, don't crash the session
                    st.error(f"Generation failed: {exc}")
                    st.stop()

            answer_text = result["answer"]
            retrieved = result["retrieved"]
            confidence = result["confidence"]

            if debug_mode and retrieved:
                header = f"🔍 Retrieved context — {len(retrieved)} chunks, top relevance {confidence:.3f}"
                with st.expander(header):
                    for rank, r in enumerate(retrieved, 1):
                        found_in = [
                            label for label, key in
                            (("dense", "in_dense"), ("bm25", "in_bm25"), ("exact", "in_exact"))
                            if r.get(key)
                        ]
                        st.markdown(f"**Rank {rank}** — found by: `{', '.join(found_in) or 'fusion'}`")
                        cols = st.columns(3)
                        cols[0].metric("Cohere relevance", round(r.get("relevance_score", 0), 3))
                        cols[1].metric("Fusion score", round(r.get("fusion_score", 0), 4))
                        cols[2].metric("Doc type", r.get("doc_type", "?"))
                        st.json(r["metadata"])
                        st.text(r["text"][:600])
                        st.divider()

            st.markdown(answer_text)
            if result["refused"]:
                st.caption(
                    f"Refused — top relevance {confidence:.3f} is below the "
                    f"{puks_rag.CONFIDENCE_THRESHOLD:.2f} threshold."
                )
            else:
                st.caption(f"Top relevance: {confidence:.3f} · {puks_rag.CHAT_DEPLOYMENT}")
                st.session_state.memory.add_turn(user_input, answer_text)

        st.session_state.messages.append({"role": "assistant", "content": answer_text})


# ==================================================
# ABOUT
# ==================================================
if page == "ℹ️ About":
    st.header("About Puks AI")
    st.markdown(
        """
**Puks AI** — Predictive Unified Knowledge System — answers Speed WMS support
questions from AGL's warehouse documentation. It answers only from documents it
retrieves, and refuses rather than guessing.

**Pipeline**

| Stage | Model |
|---|---|
| Dense retrieval | `text-embedding-3-large`, over the full corpus |
| Lexical retrieval | BM25, over the full corpus, independently |
| Fusion | Reciprocal Rank Fusion |
| Reranking | `Cohere-rerank-v4.0-pro` |
| Generation | `gpt-5` |

Everything runs on AGL's own Azure Foundry resource. No request leaves the tenant.

**It cannot** query live warehouse data, answer outside the knowledge base, or
change any system. It is read-only by design.
"""
    )
    st.info(
        "Found a wrong or missing answer? Raise it with the Speed WMS support "
        "team — resolved tickets are the highest-value source for improving this "
        "knowledge base."
    )
