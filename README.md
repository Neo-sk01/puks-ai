<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-blue?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Streamlit-1.31+-red?logo=streamlit&logoColor=white" alt="Streamlit">
  <img src="https://img.shields.io/badge/FAISS-Vector_Search-green" alt="FAISS">
  <img src="https://img.shields.io/badge/LLM-Groq_API-purple" alt="Groq">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

# 🚀 Puks AI — Speed WMS Intelligent Support System

> **Predictive Unified Knowledge System** — An enterprise RAG (Retrieval-Augmented Generation) solution providing intelligent, context-aware support for Speed WMS warehouse management operations.

<p align="center">
  <img src="docs/images/architecture-overview.png" alt="Architecture Overview" width="800">
</p>

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [Configuration](#-configuration)
- [Data Pipeline](#-data-pipeline)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🎯 Overview

**Puks AI** is an AI-powered knowledge assistant designed for Speed WMS (Warehouse Management System) support teams. It combines semantic search with large language models to deliver accurate, contextual answers from:

- 📊 **18+ Database Schema Definitions** — Complete table structures with foreign key relationships
- 📖 **40+ Operational Procedures** — Step-by-step guides for common WMS tasks
- 🔧 **Support Ticket Knowledge Base** — Historical resolutions and troubleshooting patterns
- 📄 **SOP Documentation** — Standard operating procedures in PDF/DOCX format

### Problem Statement

Support teams struggle with:
- Scattered documentation across multiple sources
- Time-consuming manual searches for procedures
- Inconsistent answers to recurring questions
- Knowledge loss when experienced staff leave

### Solution

Puks AI provides:
- **Instant answers** from unified knowledge base
- **SQL query generation** based on actual schema definitions
- **Step-by-step procedures** with safety rules and validation steps
- **Conversation memory** for multi-turn interactions

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🔍 **Hybrid Search** | Combines dense vector search (FAISS) with sparse BM25 for optimal retrieval |
| 🎯 **Intent Classification** | Automatically detects query type (schema, operational, SQL) |
| 🔄 **Cross-Encoder Reranking** | MS-MARCO trained reranker for precision |
| 💬 **Conversation Memory** | Maintains context across 8 conversation turns |
| 🤖 **Multi-Model Support** | Switch between Llama 4, Qwen 3, and Llama 3.1 |
| 📊 **Debug Mode** | Transparent retrieval with confidence scores |
| 🛡️ **Guardrails** | Strict context-only answering, no hallucination |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                           │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │  Streamlit  │   │  Power Apps │   │  Power Apps │           │
│  │   Web App   │   │  (Puks AI)  │   │   (Commo)   │           │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘           │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RAG PIPELINE                                │
│  ┌────────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│  │   Query    │──▶│   Hybrid     │──▶│  Answer Generation   │  │
│  │ Classifier │   │  Retrieval   │   │    (Groq LLM)        │  │
│  └────────────┘   └──────────────┘   └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐    │
│  │ FAISS Index  │   │   BM25       │   │ Unified Chunks   │    │
│  │ (384 dims)   │   │   Corpus     │   │   (673 docs)     │    │
│  └──────────────┘   └──────────────┘   └──────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | Streamlit, Power Apps |
| **Embedding Model** | sentence-transformers/all-MiniLM-L6-v2 |
| **Vector Store** | FAISS (IndexFlatIP, normalized) |
| **Reranker** | cross-encoder/ms-marco-MiniLM-L-6-v2 |
| **Lexical Search** | BM25 (rank_bm25) |
| **LLM Provider** | Groq API (Llama 4, Qwen 3, Llama 3.1) |
| **Data Processing** | pdfplumber, python-docx, LangChain |

---

## 🚀 Quick Start

### Prerequisites

- Python 3.9+ (3.11 recommended)
- [Groq API Key](https://console.groq.com) (free tier available)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/puks-ai.git
cd puks-ai

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Configuration

Create `.streamlit/secrets.toml`:

```toml
GROQ_API_KEY = "your-groq-api-key-here"
```

### Run the Application

```bash
cd app
streamlit run APP.py
```

The application will be available at `http://localhost:8501`

---

## 📁 Project Structure

```
puks-ai/
├── 📂 app/                          # Streamlit application
│   ├── APP.py                       # Main application entry point
│   ├── home.py                      # Home page component
│   ├── Help Page.py                 # Support form
│   ├── requirements.txt             # App dependencies
│   └── style/
│       └── style.css                # Custom styling
│
├── 📂 data/                         # Knowledge base
│   ├── database_tables/             # Schema definitions (JSON)
│   │   ├── OPE_DAT.json            # Order Header
│   │   ├── OPL_DAT.json            # Order Lines
│   │   ├── REE_DAT.json            # Reception Header
│   │   └── ...                      # 18 total tables
│   ├── procedures/                  # Operational procedures
│   │   ├── 01_general_rules.json
│   │   ├── 03_inbound.json
│   │   ├── 04_outbound.json
│   │   └── ...                      # 40+ procedures
│   ├── unified_semantic_chunks/
│   │   └── unified_chunks.json      # Processed chunks
│   └── vector_store/
│       ├── faiss.index              # FAISS vector index
│       ├── metadata.pkl             # Chunk metadata
│       └── config.json              # Index configuration
│
├── 📂 notebooks/                    # Data pipeline notebooks
│   ├── 01_document_ingestion.ipynb
│   ├── 02_text_cleaning.ipynb
│   ├── 03_text_chunking.ipynb
│   ├── 04_embeddings.ipynb
│   ├── 05_retrieval_testing.ipynb
│   └── 08_validation.ipynb
│
├── 📂 docs/                         # Documentation
│   ├── DOCUMENTATION.md             # Full technical docs
│   ├── DEPLOYMENT.md                # Deployment guide
│   └── images/                      # Documentation assets
│
├── 📂 powerapps/                    # Power Apps templates
│   └── html_forms/                  # Support ticket HTML
│
├── .gitignore
├── LICENSE
├── README.md
└── requirements.txt                 # Project dependencies
```

---

## ⚙️ Configuration

### Vector Store Configuration

`data/vector_store/config.json`:

```json
{
  "model_name": "sentence-transformers/all-MiniLM-L6-v2",
  "total_vectors": 673,
  "dimension": 384,
  "index_type": "IndexFlatIP",
  "normalised": true
}
```

### Retrieval Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `VECTOR_CANDIDATES` | 40 | Initial vector search results |
| `RERANK_CANDIDATES` | 25 | Candidates for reranking |
| `TOP_K` | 5 | Final results returned |
| `W_VECTOR` | 0.6 | Vector score weight |
| `W_BM25` | 0.3 | BM25 score weight |
| `W_RERANK` | 0.3 | Rerank score weight |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ | Groq API authentication |
| `VECTOR_STORE_PATH` | ❌ | Custom vector store location |
| `LOG_LEVEL` | ❌ | Logging verbosity (default: INFO) |

---

## 🔄 Data Pipeline

The knowledge base is built through a sequential notebook pipeline:

```
Raw Documents → Ingestion → Cleaning → Chunking → Embedding → Index
     📄            📥          🧹         ✂️          🔢        🗄️
```

### Pipeline Steps

| Step | Notebook | Input | Output |
|------|----------|-------|--------|
| 1 | `01_document_ingestion` | PDFs, DOCX, JSON | Extracted text |
| 2 | `02_text_cleaning` | Extracted text | Cleaned text |
| 3 | `03_text_chunking` | Cleaned text | Semantic chunks |
| 4 | `04_embeddings` | Chunks | FAISS index |
| 5 | `05_retrieval_testing` | Index | Quality metrics |

### Chunk Types

| Type | Count | Description |
|------|-------|-------------|
| `text_prose` | 470 | General documentation |
| `wms_procedure` | 28 | Step-by-step procedures |
| `schema_overview` | 18 | Table descriptions |
| `schema_core_columns` | 17 | Primary columns |
| `wms_safety_rules` | 18 | Safety guidelines |

---

## 🚢 Deployment

### Local Development

```bash
streamlit run app/APP.py
```

### Docker

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY data/ ./data/

EXPOSE 8501
CMD ["streamlit", "run", "app/APP.py", "--server.address=0.0.0.0"]
```

### Azure App Service

```bash
# Deploy to Azure
az webapp up --name puks-ai --runtime "PYTHON:3.11"
```

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed instructions.

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) first.

### Adding New Documents

1. Place documents in appropriate `data/` subfolder
2. Run the notebook pipeline (01-04)
3. Test retrieval quality
4. Submit PR with updated vector store

### Adding New Schemas

1. Create JSON file following the schema format
2. Place in `data/database_tables/`
3. Re-run chunking and embedding notebooks

---

## 📊 Performance Metrics

| Metric | Value |
|--------|-------|
| Average Response Time | < 3 seconds |
| Retrieval Precision@5 | 0.85 |
| Knowledge Base Size | 673 chunks |
| Supported Query Types | Schema, Operational, SQL |

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **BK Systèmes** — Speed WMS documentation
- **Sentence Transformers** — Embedding models
- **FAISS** — Vector similarity search
- **Groq** — LLM inference API
- **Streamlit** — Web application framework

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/puks-ai/issues)
- **Email**: support@example.com
- **Documentation**: [Full Documentation](docs/DOCUMENTATION.md)

---

<p align="center">
  <b>Built with ❤️ by the Speed WMS Support Team</b>
</p>
