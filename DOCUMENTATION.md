# Speed WMS AI System - Complete Technical Documentation

> [!WARNING]
> **Superseded — do not follow.** This document describes a Groq-based Streamlit
> deployment into a greenfield resource group (`rg-agl-ai` / `rg-puks-ai`) that
> does not exist, in a region this project does not use. Generation, embeddings
> and reranking now all run on Azure Foundry; there is no Groq key to set.
> The current architecture and the working deployment runbook are in
> [`README.md`](README.md) §6-§7.

**Project Name:** Puks AI - Predictive Unified Knowledge System  
**Version:** 1.0  
**Last Updated:** June 2026  
**Authors:** Kgathola Puka, Speed WMS Support Team

---

## Table of Contents

1. [Architecture Documentation](#1-architecture-documentation)
2. [Deployment Guide](#2-deployment-guide)
3. [Operations Manual](#3-operations-manual)
4. [Developer Guide](#4-developer-guide)
5. [User Documentation](#5-user-documentation)
6. [Configuration Guide](#6-configuration-guide)

---

# 1. Architecture Documentation

## 1.1 System Overview

Puks AI is a Retrieval-Augmented Generation (RAG) system designed to provide intelligent support for Speed WMS (Warehouse Management System) operations. The system combines document ingestion, semantic search, and LLM-powered answer generation to deliver accurate, context-aware responses.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │   Streamlit     │    │    Power Apps   │    │   Power Apps    │          │
│  │   Chatbot UI    │    │    (Puks AI)    │    │    (Commo)      │          │
│  │   (APP.py)      │    │                 │    │                 │          │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘          │
│           │                      │                      │                    │
└───────────┼──────────────────────┼──────────────────────┼────────────────────┘
            │                      │                      │
            ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          APPLICATION LAYER                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │                    RAG Pipeline Engine                          │         │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │         │
│  │  │ Query        │  │ Hybrid       │  │ LLM Answer           │  │         │
│  │  │ Classifier   │→ │ Retrieval    │→ │ Generation           │  │         │
│  │  │ (Intent)     │  │ (Vector+BM25)│  │ (Groq API)           │  │         │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘  │         │
│  └────────────────────────────────────────────────────────────────┘         │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────┐         │
│  │                    Embedding & Reranking                        │         │
│  │  ┌─────────────────────────┐   ┌─────────────────────────────┐ │         │
│  │  │ SentenceTransformer     │   │ CrossEncoder Reranker       │ │         │
│  │  │ (all-MiniLM-L6-v2)      │   │ (ms-marco-MiniLM-L-6-v2)    │ │         │
│  │  └─────────────────────────┘   └─────────────────────────────┘ │         │
│  └────────────────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
            │                              │
            ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐       │
│  │   FAISS Index    │  │   Metadata       │  │   Unified Chunks     │       │
│  │   (faiss.index)  │  │   (metadata.pkl) │  │   (unified_chunks.   │       │
│  │   384 dimensions │  │                  │  │    json)             │       │
│  │   673 vectors    │  │                  │  │                      │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘       │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                    Source Documents                               │       │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │       │
│  │  │ Database │  │ Speed    │  │ Support  │  │ SOP Documents    │  │       │
│  │  │ Schemas  │  │ Support  │  │ Ticket   │  │ (PDF/DOCX)       │  │       │
│  │  │ (JSON)   │  │ Docs     │  │ Docs     │  │                  │  │       │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘  │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL SERVICES                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐                                                        │
│  │   Groq API       │  LLM Provider (Llama 4, Qwen 3, Llama 3.1)            │
│  └──────────────────┘                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1.2 Component Interaction Flow

### Query Processing Pipeline

```
┌──────────────┐
│ User Query   │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                  QUERY CLASSIFICATION                         │
│  ┌────────────────────┐  ┌────────────────────┐              │
│  │ Schema Keywords    │  │ Operational        │              │
│  │ Detection          │  │ Keywords Detection │              │
│  │ (SQL, column,      │  │ (reverse, cancel,  │              │
│  │  table, schema)    │  │  mission, receipt) │              │
│  └────────────────────┘  └────────────────────┘              │
│                                                               │
│  Output: {is_schema, is_operational, is_sql}                 │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                  HYBRID RETRIEVAL                             │
│  ┌─────────────────┐      ┌─────────────────┐                │
│  │ VECTOR SEARCH   │      │ BM25 LEXICAL    │                │
│  │ • Encode query  │      │ • Tokenize query│                │
│  │ • FAISS search  │      │ • Score all docs│                │
│  │ • Top 40 results│      │                 │                │
│  └────────┬────────┘      └────────┬────────┘                │
│           │                        │                          │
│           └────────┬───────────────┘                          │
│                    ▼                                          │
│           ┌───────────────────┐                               │
│           │ SCORE FUSION      │                               │
│           │ hybrid = 0.6×vec  │                               │
│           │        + 0.3×bm25 │                               │
│           │ + intent boosts   │                               │
│           └───────────────────┘                               │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                  RERANKING                                    │
│  • Cross-Encoder scoring (ms-marco-MiniLM-L-6-v2)            │
│  • Final = 0.7×hybrid + 0.3×rerank                           │
│  • Return top 5 chunks                                        │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                  PROMPT CONSTRUCTION                          │
│  • Conversation history injection                             │
│  • Context text assembly                                      │
│  • Mode-specific hints (SCHEMA/SQL/OPERATIONAL)              │
│  • Safety rules and constraints                               │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                  LLM ANSWER GENERATION                        │
│  • Groq API call with selected model                         │
│  • Temperature: 0 (deterministic)                            │
│  • Max tokens: 2048                                          │
│  • Response validation                                        │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                  RESPONSE & MEMORY UPDATE                     │
│  • Store Q&A in conversation memory (max 8 turns)            │
│  • Display answer with confidence score                       │
│  • Optional debug panel with retrieval details               │
└──────────────────────────────────────────────────────────────┘
```

## 1.3 Data Flow Diagrams

### Document Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DOCUMENT INGESTION PIPELINE                             │
│                      (SCRIPTS/01-04 Notebooks)                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│ RAW DOCUMENTS    │
│ • PDFs           │
│ • DOCX           │
│ • JSON schemas   │
│ • Excel files    │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 01_document_ingestion.ipynb                                   │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ • PDF extraction (pdfplumber)                           │   │
│ │ • Table detection and preservation                      │   │
│ │ • Text cleaning and normalization                       │   │
│ │ • Output: Extracted text files per document             │   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 02_text_cleaning_preprocessing.ipynb                          │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ • Remove noise and artifacts                            │   │
│ │ • Normalize whitespace                                  │   │
│ │ • Structure preservation                                │   │
│ │ • Output: Cleaned text files                            │   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 03_text_chunking.ipynb                                        │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ • Semantic chunking strategy                            │   │
│ │ • Chunk types:                                          │   │
│ │   - schema_overview, schema_core_columns                │   │
│ │   - wms_overview, wms_procedure, wms_safety_rules       │   │
│ │   - text_prose, text_table                              │   │
│ │ • Metadata extraction (source, category, table_name)   │   │
│ │ • Output: unified_chunks.json (673 chunks)              │   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│ 04_embeddings_and_vector_store.ipynb                          │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ • Load SentenceTransformer model                        │   │
│ │ • Text enrichment with metadata                         │   │
│ │ • Operational boost (2x duplication)                    │   │
│ │ • Generate 384-dimensional embeddings                   │   │
│ │ • Build FAISS IndexFlatIP (normalized)                  │   │
│ │ • Output: faiss.index, metadata.pkl, config.json        │   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐
│ VECTOR STORE     │
│ • faiss.index    │
│ • metadata.pkl   │
│ • config.json    │
└──────────────────┘
```

### Data Source Categories

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────┐                                 │
│  │ DATABASE SCHEMAS (18 tables)           │                                 │
│  │ ├── OPE_DAT.json (Order Header)        │                                 │
│  │ ├── OPL_DAT.json (Order Lines)         │                                 │
│  │ ├── REE_DAT.json (Reception Header)    │                                 │
│  │ ├── REL_DAT.json (Reception Lines)     │                                 │
│  │ ├── MIE_DAT.json (Mission Header)      │                                 │
│  │ ├── MIL_DAT.json (Mission Lines)       │                                 │
│  │ ├── STK_DAT.json (Current Stock)       │                                 │
│  │ ├── MVT_DAT.json (Stock Movement)      │                                 │
│  │ ├── CHG_DAT.json (Loading Header)      │                                 │
│  │ ├── CHL_DAT.json (Loading Lines)       │                                 │
│  │ ├── SEX_DAT.json (Shipping Support)    │                                 │
│  │ ├── ZEM_DAT.json (Location Zone)       │                                 │
│  │ ├── REA_DAT.json (Expected Reception)  │                                 │
│  │ ├── ART_PAR.json (Article Master)      │                                 │
│  │ ├── ACT_PAR.json (Activity Master)     │                                 │
│  │ ├── TIE_PAR.json (Third Party)         │                                 │
│  │ └── QUA_PAR.json (Quality Parameters)  │                                 │
│  └────────────────────────────────────────┘                                 │
│                                                                              │
│  ┌────────────────────────────────────────┐                                 │
│  │ OPERATIONAL PROCEDURES                  │                                 │
│  │ ├── 01_general_rules.json              │                                 │
│  │ ├── 02_base_data.json                  │                                 │
│  │ ├── 03_inbound.json                    │                                 │
│  │ ├── 04_outbound.json                   │                                 │
│  │ ├── 05_loading.json                    │                                 │
│  │ ├── 06_inventory.json                  │                                 │
│  │ └── [40+ procedure JSONs]              │                                 │
│  └────────────────────────────────────────┘                                 │
│                                                                              │
│  ┌────────────────────────────────────────┐                                 │
│  │ SOP DOCUMENTS (PDF)                     │                                 │
│  │ ├── Speed WMS - SOP Knowledge Base     │                                 │
│  │ ├── Loading Management Guide           │                                 │
│  │ ├── Serial Number Resolution           │                                 │
│  │ ├── Remote Desktop SOP                 │                                 │
│  │ └── [15+ procedure PDFs]               │                                 │
│  └────────────────────────────────────────┘                                 │
│                                                                              │
│  ┌────────────────────────────────────────┐                                 │
│  │ SUPPORT TICKET DOCUMENTATION            │                                 │
│  │ ├── Historical ticket resolutions      │                                 │
│  │ ├── Common error patterns              │                                 │
│  │ └── Troubleshooting workflows          │                                 │
│  └────────────────────────────────────────┘                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1.4 Security Architecture

### Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SECURITY ARCHITECTURE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ SECRETS MANAGEMENT                                                      │ │
│  │ ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │ │ Streamlit Secrets (.streamlit/secrets.toml)                       │  │ │
│  │ │ • GROQ_API_KEY: LLM service authentication                        │  │ │
│  │ │ • Never committed to version control                              │  │ │
│  │ │ • Azure Key Vault recommended for production                      │  │ │
│  │ └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ DATA SECURITY                                                           │ │
│  │ ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │ │ • Vector store contains no raw credentials                        │  │ │
│  │ │ • Database schemas are documentation-only (no live connections)   │  │ │
│  │ │ • All data stored locally or in enterprise OneDrive               │  │ │
│  │ │ • No PII stored in knowledge base                                 │  │ │
│  │ └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ LLM GUARDRAILS                                                          │ │
│  │ ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │ │ • Strict context-only answering (no hallucination)               │  │ │
│  │ │ • "I do not know" fallback for insufficient context              │  │ │
│  │ │ • No direct database modification queries generated              │  │ │
│  │ │ • SELECT-only SQL generation unless explicitly requested         │  │ │
│  │ │ • Confidence threshold (0.01) for response validation            │  │ │
│  │ └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ACCESS CONTROL (Production Recommendations)                             │ │
│  │ ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │ │ • Azure AD integration for user authentication                   │  │ │
│  │ │ • Role-based access to admin features                            │  │ │
│  │ │ • Audit logging for all queries                                  │  │ │
│  │ │ • Rate limiting on API endpoints                                 │  │ │
│  │ └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# 2. Deployment Guide

## 2.1 Prerequisites

### System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Python | 3.9+ | 3.11 |
| RAM | 8 GB | 16 GB |
| Storage | 10 GB | 50 GB |
| CPU | 4 cores | 8 cores |
| GPU | Not required | CUDA-capable (optional) |

### Required Services

- **Groq API Account**: Free tier available at [console.groq.com](https://console.groq.com)
- **Azure Subscription** (for production deployment)

## 2.2 Step-by-Step Azure Setup

### Step 1: Create Azure Resources

```bash
# Login to Azure CLI
az login

# Create resource group
az group create --name rg-puks-ai --location southafricanorth

# Create App Service Plan
az appservice plan create \
  --name asp-puks-ai \
  --resource-group rg-puks-ai \
  --sku B2 \
  --is-linux

# Create Web App for Containers
az webapp create \
  --resource-group rg-puks-ai \
  --plan asp-puks-ai \
  --name puks-ai-webapp \
  --runtime "PYTHON:3.11"
```

### Step 2: Create Azure Key Vault

```bash
# Create Key Vault
az keyvault create \
  --name kv-puks-ai \
  --resource-group rg-puks-ai \
  --location southafricanorth

# Store Groq API Key
az keyvault secret set \
  --vault-name kv-puks-ai \
  --name GROQ-API-KEY \
  --value "your-groq-api-key-here"
```

### Step 3: Create Azure Storage for Vector Store

```bash
# Create Storage Account
az storage account create \
  --name stpuksai \
  --resource-group rg-puks-ai \
  --location southafricanorth \
  --sku Standard_LRS

# Create Container for vector store
az storage container create \
  --name vector-store \
  --account-name stpuksai
```

### Step 4: Configure App Settings

```bash
# Set environment variables
az webapp config appsettings set \
  --resource-group rg-puks-ai \
  --name puks-ai-webapp \
  --settings \
    GROQ_API_KEY="@Microsoft.KeyVault(SecretUri=https://kv-puks-ai.vault.azure.net/secrets/GROQ-API-KEY/)" \
    VECTOR_STORE_PATH="/home/site/wwwroot/data/vector_store" \
    CHUNKS_PATH="/home/site/wwwroot/data/unified_semantic_chunks/unified_chunks.json"
```

## 2.3 Infrastructure-as-Code (ARM Template)

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "appName": {
      "type": "string",
      "defaultValue": "puks-ai",
      "metadata": {
        "description": "Name of the Puks AI application"
      }
    },
    "location": {
      "type": "string",
      "defaultValue": "[resourceGroup().location]"
    },
    "groqApiKey": {
      "type": "securestring",
      "metadata": {
        "description": "Groq API Key for LLM access"
      }
    }
  },
  "variables": {
    "appServicePlanName": "[concat('asp-', parameters('appName'))]",
    "webAppName": "[concat('wa-', parameters('appName'))]",
    "keyVaultName": "[concat('kv-', parameters('appName'))]",
    "storageAccountName": "[concat('st', replace(parameters('appName'), '-', ''))]"
  },
  "resources": [
    {
      "type": "Microsoft.Web/serverfarms",
      "apiVersion": "2022-03-01",
      "name": "[variables('appServicePlanName')]",
      "location": "[parameters('location')]",
      "sku": {
        "name": "B2",
        "tier": "Basic"
      },
      "kind": "linux",
      "properties": {
        "reserved": true
      }
    },
    {
      "type": "Microsoft.Web/sites",
      "apiVersion": "2022-03-01",
      "name": "[variables('webAppName')]",
      "location": "[parameters('location')]",
      "dependsOn": [
        "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]"
      ],
      "properties": {
        "serverFarmId": "[resourceId('Microsoft.Web/serverfarms', variables('appServicePlanName'))]",
        "siteConfig": {
          "linuxFxVersion": "PYTHON|3.11",
          "appSettings": [
            {
              "name": "GROQ_API_KEY",
              "value": "[parameters('groqApiKey')]"
            }
          ]
        }
      }
    },
    {
      "type": "Microsoft.KeyVault/vaults",
      "apiVersion": "2022-07-01",
      "name": "[variables('keyVaultName')]",
      "location": "[parameters('location')]",
      "properties": {
        "sku": {
          "family": "A",
          "name": "standard"
        },
        "tenantId": "[subscription().tenantId]",
        "accessPolicies": []
      }
    },
    {
      "type": "Microsoft.Storage/storageAccounts",
      "apiVersion": "2022-09-01",
      "name": "[variables('storageAccountName')]",
      "location": "[parameters('location')]",
      "sku": {
        "name": "Standard_LRS"
      },
      "kind": "StorageV2"
    }
  ],
  "outputs": {
    "webAppUrl": {
      "type": "string",
      "value": "[concat('https://', variables('webAppName'), '.azurewebsites.net')]"
    }
  }
}
```

## 2.4 Terraform Configuration

```hcl
# main.tf

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "puks_ai" {
  name     = "rg-puks-ai"
  location = "South Africa North"
}

resource "azurerm_service_plan" "puks_ai" {
  name                = "asp-puks-ai"
  resource_group_name = azurerm_resource_group.puks_ai.name
  location            = azurerm_resource_group.puks_ai.location
  os_type             = "Linux"
  sku_name            = "B2"
}

resource "azurerm_linux_web_app" "puks_ai" {
  name                = "wa-puks-ai"
  resource_group_name = azurerm_resource_group.puks_ai.name
  location            = azurerm_resource_group.puks_ai.location
  service_plan_id     = azurerm_service_plan.puks_ai.id

  site_config {
    application_stack {
      python_version = "3.11"
    }
  }

  app_settings = {
    "GROQ_API_KEY"      = var.groq_api_key
    "VECTOR_STORE_PATH" = "/home/site/wwwroot/data/vector_store"
  }
}

resource "azurerm_key_vault" "puks_ai" {
  name                = "kv-puks-ai"
  location            = azurerm_resource_group.puks_ai.location
  resource_group_name = azurerm_resource_group.puks_ai.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"
}

resource "azurerm_storage_account" "puks_ai" {
  name                     = "stpuksai"
  resource_group_name      = azurerm_resource_group.puks_ai.name
  location                 = azurerm_resource_group.puks_ai.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

variable "groq_api_key" {
  type        = string
  sensitive   = true
  description = "Groq API Key for LLM access"
}

data "azurerm_client_config" "current" {}

output "webapp_url" {
  value = azurerm_linux_web_app.puks_ai.default_hostname
}
```

## 2.5 Environment Configuration Checklist

### Pre-Deployment Checklist

- [ ] Python 3.11 installed
- [ ] All dependencies from `requirements.txt` installed
- [ ] Groq API key obtained and configured
- [ ] Vector store files present:
  - [ ] `faiss.index`
  - [ ] `metadata.pkl`
  - [ ] `config.json`
- [ ] Unified chunks file present: `unified_chunks.json`
- [ ] Streamlit secrets configured (`.streamlit/secrets.toml`)

### Production Deployment Checklist

- [ ] Azure Resource Group created
- [ ] App Service Plan provisioned
- [ ] Web App created with Python 3.11 runtime
- [ ] Key Vault created with secrets stored
- [ ] Storage account configured for vector store
- [ ] App Settings configured with environment variables
- [ ] SSL certificate configured (managed by Azure)
- [ ] Custom domain configured (if applicable)
- [ ] Health checks enabled
- [ ] Application Insights connected

## 2.6 Rollback Procedures

### Application Rollback

```bash
# List deployment slots
az webapp deployment slot list \
  --resource-group rg-puks-ai \
  --name puks-ai-webapp

# Swap slots to rollback
az webapp deployment slot swap \
  --resource-group rg-puks-ai \
  --name puks-ai-webapp \
  --slot staging \
  --target-slot production

# Or restore from backup
az webapp config snapshot restore \
  --resource-group rg-puks-ai \
  --name puks-ai-webapp \
  --time "2026-06-20T10:00:00Z"
```

### Vector Store Rollback

```bash
# Download previous vector store from blob storage
az storage blob download-batch \
  --account-name stpuksai \
  --source vector-store-backup \
  --destination ./data/vector_store \
  --pattern "*.pkl;*.index;*.json"
```

---

# 3. Operations Manual

## 3.1 Monitoring and Alerting Setup

### Azure Application Insights Configuration

```bash
# Create Application Insights
az monitor app-insights component create \
  --app puks-ai-insights \
  --location southafricanorth \
  --resource-group rg-puks-ai \
  --application-type web

# Link to Web App
az webapp config appsettings set \
  --resource-group rg-puks-ai \
  --name puks-ai-webapp \
  --settings \
    APPINSIGHTS_INSTRUMENTATIONKEY="<instrumentation-key>" \
    ApplicationInsightsAgent_EXTENSION_VERSION="~3"
```

### Key Metrics to Monitor

| Metric | Threshold | Alert Severity |
|--------|-----------|----------------|
| Response Time | > 5 seconds | Warning |
| Response Time | > 15 seconds | Critical |
| Error Rate | > 5% | Warning |
| Error Rate | > 15% | Critical |
| Memory Usage | > 80% | Warning |
| CPU Usage | > 90% | Critical |
| Failed LLM Calls | > 10/hour | Warning |
| Low Confidence Responses | > 30% | Warning |

### Custom Logging Implementation

Add to `APP.py`:

```python
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('puks_ai.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('puks_ai')

def log_query(query: str, confidence: float, model: str, response_time: float):
    logger.info(f"QUERY: {query[:100]}... | CONFIDENCE: {confidence:.3f} | MODEL: {model} | TIME: {response_time:.2f}s")

def log_error(error_type: str, details: str):
    logger.error(f"ERROR: {error_type} | DETAILS: {details}")
```

## 3.2 Troubleshooting Guide

### Common Issues and Solutions

#### Issue 1: "Vector store not found" Error

**Symptoms:**
- Application shows warning about missing pre-built vector store
- Slow startup as system rebuilds from raw chunks

**Solution:**
1. Verify vector store files exist:
   ```bash
   ls -la DATA/vector_store/
   # Should contain: faiss.index, metadata.pkl, config.json
   ```
2. Re-run embedding notebook:
   ```bash
   cd SCRIPTS
   jupyter nbconvert --execute 04_embeddings_and_vector_store.ipynb
   ```
3. Verify config.json contents match model name

#### Issue 2: Low Confidence Scores

**Symptoms:**
- Confidence scores consistently below 0.3
- Responses include "I do not have enough information"

**Solution:**
1. Check if query matches knowledge base domain
2. Verify unified_chunks.json is up-to-date
3. Review chunk type distribution in config.json
4. Consider rerunning the chunking pipeline with different parameters

#### Issue 3: Groq API Errors

**Symptoms:**
- "❌ LLM error" messages
- Rate limit errors (429)

**Solution:**
1. Verify API key is valid:
   ```python
   from groq import Groq
   client = Groq(api_key="your-key")
   # Test with simple completion
   ```
2. Check rate limits at [console.groq.com](https://console.groq.com)
3. Implement retry logic with exponential backoff
4. Consider upgrading Groq plan if needed

#### Issue 4: Memory Issues

**Symptoms:**
- Application crashes on startup
- "Out of memory" errors

**Solution:**
1. Reduce `VECTOR_CANDIDATES` from 40 to 20
2. Reduce `RERANK_CANDIDATES` from 25 to 10
3. Scale up Azure App Service plan
4. Implement lazy loading for models

#### Issue 5: Slow Response Times

**Symptoms:**
- Queries taking > 10 seconds
- Users experiencing timeouts

**Solution:**
1. Pre-load models at startup (already implemented with `@st.cache_resource`)
2. Reduce number of chunks retrieved
3. Use faster LLM model (Llama 3.1 8B)
4. Consider caching frequent queries

## 3.3 Common Errors and Solutions

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `FAISS index dimension mismatch` | Model changed after embedding | Re-run embedding notebook with same model |
| `KeyError: 'GROQ_API_KEY'` | Missing secrets configuration | Add key to `.streamlit/secrets.toml` |
| `JSONDecodeError in unified_chunks.json` | Corrupted chunks file | Re-run chunking pipeline |
| `CrossEncoder model not found` | Network/HuggingFace issue | Check internet, retry download |
| `BM25 tokenization error` | Empty chunks in corpus | Filter empty chunks before BM25 init |

## 3.4 Knowledge Base Update Procedures

### Adding New Documents

1. **Prepare documents:**
   - Place new PDFs/DOCX in appropriate `DATA/` subfolder
   - Ensure proper naming convention

2. **Run ingestion pipeline:**
   ```bash
   cd SCRIPTS
   jupyter nbconvert --execute 01_document_ingestion.ipynb
   jupyter nbconvert --execute 02_text_cleaning_preprocessing.ipynb
   jupyter nbconvert --execute 03_text_chunking.ipynb
   jupyter nbconvert --execute 04_embeddings_and_vector_store.ipynb
   ```

3. **Verify update:**
   - Check `config.json` for updated vector count
   - Test with relevant queries

### Adding New Database Schemas

1. **Create schema JSON file:**
   ```json
   {
     "table_name": "NEW_DAT",
     "description": "Description of table",
     "primary_key": "NEW_KEYU",
     "columns": [
       {
         "name": "COLUMN_NAME",
         "description": "Column description",
         "type_sql_server": "VARCHAR(50)",
         "type_oracle": "NVARCHAR2(50)",
         "is_primary_key": false,
         "is_foreign_key": false
       }
     ]
   }
   ```

2. **Place in `DATA/Database Tables/`**

3. **Re-run chunking and embedding notebooks**

### Updating Operational Procedures

1. **Edit or create JSON in `DATA/Speed Support Document/`**

2. **Follow the established structure:**
   ```json
   {
     "document_name": "Procedure Name",
     "version": "1.0",
     "procedures": [
       {
         "name": "Step Name",
         "steps": ["Step 1", "Step 2"],
         "sql": "SELECT * FROM table"
       }
     ]
   }
   ```

3. **Re-run pipeline notebooks**

---

# 4. Developer Guide

## 4.1 Local Development Setup

### Prerequisites

```bash
# Install Python 3.11
# Windows: Download from python.org
# macOS: brew install python@3.11
# Linux: sudo apt install python3.11

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

### Install Dependencies

```bash
# Navigate to project
cd "SPEED CHATBOT PROJECT"

# Install application dependencies
pip install -r "APPLICATION(STREAMLIT)/requirements.txt"

# Install development dependencies
pip install -r SCRIPTS/requirements.txt
```

### Configure Secrets

Create `.streamlit/secrets.toml`:

```toml
GROQ_API_KEY = "your-groq-api-key-here"
```

### Run Application Locally

```bash
cd "APPLICATION(STREAMLIT)"
streamlit run APP.py
```

The application will be available at `http://localhost:8501`

## 4.2 Running Tests and Notebooks

### Notebook Execution Order

The notebooks must be executed in sequence:

| Order | Notebook | Purpose |
|-------|----------|---------|
| 1 | `01_document_ingestion.ipynb` | Extract text from PDFs/DOCX |
| 2 | `02_text_cleaning_preprocessing.ipynb` | Clean and normalize text |
| 3 | `03_text_chunking.ipynb` | Create semantic chunks |
| 4 | `04_embeddings_and_vector_store.ipynb` | Generate embeddings and FAISS index |
| 5 | `05_retrieval_testing.ipynb` | Test retrieval quality |
| 6 | `06_rag_pipeline.ipynb` | Test end-to-end RAG |
| 7 | `07_llm_answer_generation.ipynb` | Test LLM response quality |
| 8 | `08_end_to_end_validation.ipynb` | Full system validation |

### Running Notebooks

```bash
cd SCRIPTS

# Interactive execution
jupyter notebook 01_document_ingestion.ipynb

# Command-line execution
jupyter nbconvert --execute --to notebook 01_document_ingestion.ipynb
```

### Testing Retrieval Quality

```python
# Quick retrieval test
from sentence_transformers import SentenceTransformer
import faiss
import pickle

# Load components
index = faiss.read_index("DATA/vector_store/faiss.index")
with open("DATA/vector_store/metadata.pkl", "rb") as f:
    chunks = pickle.load(f)
model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

# Test query
query = "How do I reverse a GRN?"
embedding = model.encode([query], convert_to_numpy=True).astype("float32")
faiss.normalize_L2(embedding)
scores, indices = index.search(embedding, 5)

for score, idx in zip(scores[0], indices[0]):
    print(f"Score: {score:.3f}")
    print(f"Text: {chunks[idx]['text'][:200]}...")
    print("---")
```

## 4.3 Contributing to Schema/Glossary Files

### Database Schema JSON Structure

```json
{
  "table_name": "TABLE_DAT",
  "description": "Human-readable table description",
  "primary_key": "TABLE_KEYU",
  "columns": [
    {
      "name": "COLUMN_NAME",
      "description": "Human-readable column description",
      "type_sql_server": "VARCHAR(50)",
      "type_oracle": "NVARCHAR2(50)",
      "is_primary_key": false,
      "is_foreign_key": true,
      "references_table": "OTHER_TABLE",
      "references_column": "OTHER_COLUMN"
    }
  ]
}
```

### Naming Conventions

- **Table suffixes:**
  - `_SYS`: System tables (internal)
  - `_PAR`: Parameter/master data
  - `_DAT`: Transactional data
  - `_BAS`: Base/reference data

- **Primary keys:** Always `XXX_KEYU`
- **Activity code:** Always `ACT_CODE` (except `SEX_DAT` uses `SEX_ACT`)

### Validation Rules

Before committing schema changes:

1. Validate JSON syntax
2. Ensure all columns have descriptions
3. Verify foreign key references exist
4. Test with retrieval queries

## 4.4 Retraining and Redeployment Process

### Retraining Pipeline

```bash
#!/bin/bash
# retrain.sh - Full retraining script

echo "Starting retraining pipeline..."

cd SCRIPTS

echo "Step 1: Document Ingestion"
jupyter nbconvert --execute 01_document_ingestion.ipynb --to notebook

echo "Step 2: Text Cleaning"
jupyter nbconvert --execute 02_text_cleaning_preprocessing.ipynb --to notebook

echo "Step 3: Chunking"
jupyter nbconvert --execute 03_text_chunking.ipynb --to notebook

echo "Step 4: Embedding Generation"
jupyter nbconvert --execute 04_embeddings_and_vector_store.ipynb --to notebook

echo "Step 5: Validation"
jupyter nbconvert --execute 08_end_to_end_validation.ipynb --to notebook

echo "Retraining complete!"
echo "Vector store updated at: DATA/vector_store/"
```

### Redeployment Steps

1. **Backup current vector store:**
   ```bash
   cp -r DATA/vector_store DATA/vector_store_backup_$(date +%Y%m%d)
   ```

2. **Run retraining pipeline:**
   ```bash
   ./retrain.sh
   ```

3. **Test locally:**
   ```bash
   streamlit run "APPLICATION(STREAMLIT)/APP.py"
   ```

4. **Deploy to Azure:**
   ```bash
   # Using Azure CLI
   az webapp deployment source config-zip \
     --resource-group rg-puks-ai \
     --name puks-ai-webapp \
     --src deploy.zip
   ```

5. **Verify deployment:**
   - Test critical queries
   - Check confidence scores
   - Monitor error rates

---

# 5. User Documentation

## 5.1 How to Use Puks AI (Streamlit Web App)

### Accessing the Application

1. Open your web browser
2. Navigate to the application URL (provided by your administrator)
3. The chatbot interface will load automatically

### Main Features

#### Chat Interface

1. **Ask Questions:**
   - Type your question in the chat input at the bottom
   - Press Enter or click Send
   - Wait for Puks AI to analyze and respond

2. **Model Selection:**
   - Use the sidebar dropdown to select the AI model:
     - **Llama 4 Maverick 17B**: Best for complex queries
     - **Qwen 3 32B**: Best for structured reasoning
     - **Llama 3.1 8B**: Fastest responses

3. **Debug Mode:**
   - Toggle "Show Retrieved Context" in sidebar
   - View the chunks used to generate the answer
   - See confidence scores and retrieval metrics

4. **Reset Memory:**
   - Click "Reset Conversation Memory" to start fresh
   - Previous context will be cleared

### Help & Support

1. Navigate to "Help & Support" in sidebar
2. Fill in the support form:
   - Your name and email
   - Issue category (SQL Generation, Schema Query, etc.)
   - Detailed description of your issue
3. Submit for team follow-up

## 5.2 How to Use Puks AI (Power Apps Guide)

### Accessing via Power Apps

1. Open Microsoft Power Apps
2. Search for "Puks AI" or "Speed WMS Support"
3. Click to launch the application

### Features

- **Ticket Creation:** Submit support tickets with categorization
- **Knowledge Search:** Search the Speed WMS knowledge base
- **Status Tracking:** Track ticket resolution status

### Using Support Ticket Forms

1. **Create New Ticket:**
   - Click "New Ticket"
   - Fill required fields:
     - Ticket Title
     - Category (Inbound, Outbound, Loading, etc.)
     - Module Affected
     - Warehouse
     - Priority (Low, Medium, High, Critical)
   - Add issue description
   - Submit

2. **View Ticket History:**
   - Access "My Tickets" section
   - Filter by status, date, or category
   - Click ticket ID for details

## 5.3 How to Use Commo (Power Apps Guide)

### Overview

Commo is the companion Power Apps application for commodity-specific workflows in Speed WMS.

### Key Features

1. **Stock Queries:**
   - Search current stock by article code
   - View location details
   - Check stock movements

2. **Receipt Management:**
   - View pending receipts
   - Track GRN status
   - Report discrepancies

3. **Order Tracking:**
   - Search orders by reference
   - View order line details
   - Check shipment status

### Navigation

- Use the bottom navigation bar to switch between modules
- Use search bars to find specific records
- Pull down to refresh data

## 5.4 Example Queries for Both Systems

### Schema Queries

```
"What columns are in the OPE_DAT table?"
"Describe the structure of the reception header table"
"What are the foreign keys in MIL_DAT?"
"List all columns in the stock movement table"
```

### Operational Queries

```
"How do I reverse a closed GRN?"
"Steps to cancel a shipped order"
"How to reset a mission status?"
"Procedure for handling unknown supports"
```

### SQL Queries

```
"Write a query to find all orders for customer X"
"SQL to check stock levels by location"
"Query to join orders with missions"
"How to find receipts from last 7 days?"
```

### Troubleshooting Queries

```
"Mission is stuck in status 50, what should I do?"
"LPN missing on manifest, how to resolve?"
"Serial number validation failed, steps to fix?"
"Loading support ticket shows wrong warehouse"
```

## 5.5 Limitations and When to Escalate

### Known Limitations

| Limitation | Description |
|------------|-------------|
| **Context-only answers** | Cannot answer questions outside the knowledge base |
| **No live database access** | Cannot query actual Speed WMS database |
| **Read-only SQL** | Only generates SELECT queries by default |
| **No file modifications** | Cannot modify or create files |
| **Language support** | English only |

### When to Escalate to Human Support

1. **Data Issues:**
   - Actual database corruption
   - Production data discrepancies
   - Master data corrections needed

2. **System Access:**
   - New user provisioning
   - Permission changes
   - Password resets

3. **Critical Operations:**
   - Bulk data corrections
   - Status changes affecting shipped orders
   - Loading reversals

4. **Complex Scenarios:**
   - Multi-warehouse issues
   - Interface/integration failures
   - Custom report requests

### Escalation Contacts

- **L1 Support:** [support@speedwms.local]
- **L2 Support:** [escalation@speedwms.local]
- **Emergency:** Contact Kgathola Puka directly

---

# 6. Configuration Guide

## 6.1 Config.json Reference

Located at: `DATA/vector_store/config.json`

```json
{
  "model_name": "sentence-transformers/all-MiniLM-L6-v2",
  "total_vectors": 673,
  "dimension": 384,
  "index_type": "IndexFlatIP",
  "normalised": true,
  "operational_boost": 2,
  "schema_boost": 1,
  "chunk_type_counts": {
    "schema_overview": 18,
    "schema_core_columns": 17,
    "schema_extra_columns": 15,
    "text_prose": 470,
    "text_table": 25,
    "wms_overview": 18,
    "wms_join_logic": 18,
    "wms_safety_rules": 18,
    "wms_procedure": 28
  }
}
```

### Configuration Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `model_name` | string | SentenceTransformer model used for embeddings |
| `total_vectors` | int | Total number of vectors in FAISS index |
| `dimension` | int | Embedding dimension (384 for MiniLM) |
| `index_type` | string | FAISS index type (IndexFlatIP for inner product) |
| `normalised` | bool | Whether vectors are L2 normalized |
| `operational_boost` | int | Duplication factor for operational chunks |
| `schema_boost` | int | Duplication factor for schema chunks |
| `chunk_type_counts` | object | Count of each chunk type in the index |

## 6.2 Schema Registry Structure

Database schemas are stored as JSON files in `DATA/Database Tables/`:

### File Naming Convention

```
TABLE_NAME.json
```

Examples:
- `OPE_DAT.json` - Order Header
- `OPL_DAT.json` - Order Lines
- `REE_DAT.json` - Reception Header

### Schema JSON Structure

```json
{
  "table_name": "TABLE_DAT",
  "description": "Human-readable description",
  "primary_key": "TABLE_KEYU",
  "columns": [
    {
      "name": "COLUMN_NAME",
      "description": "Column purpose",
      "type_sql_server": "VARCHAR(50)",
      "type_oracle": "NVARCHAR2(50)",
      "is_primary_key": false,
      "is_foreign_key": true,
      "references_table": "RELATED_TABLE",
      "references_column": "RELATED_COLUMN"
    }
  ]
}
```

### Column Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Column name in database |
| `description` | string | Yes | Human-readable description |
| `type_sql_server` | string | Yes | SQL Server data type |
| `type_oracle` | string | Yes | Oracle data type |
| `is_primary_key` | bool | Yes | Is this the primary key? |
| `is_foreign_key` | bool | Yes | Is this a foreign key? |
| `references_table` | string | No | FK referenced table |
| `references_column` | string | No | FK referenced column |

## 6.3 Glossary/Procedure JSON Format

Located in `DATA/Speed Support Document/`:

### General Rules Format (01_general_rules.json)

```json
{
  "document_name": "Speed WMS Data Model — General Rules",
  "version": "1.0",
  "authoritative": true,
  "source": "BK_Systèmes_MDD.pdf",
  "naming_convention": {
    "pattern": "XXX_YYY",
    "XXX": "Table name prefix",
    "YYY": "Extension suffix",
    "extensions": {
      "_SYS": "System info",
      "_PAR": "Parameters",
      "_DAT": "Transactional data",
      "_BAS": "Base/reference data"
    }
  },
  "rules": {
    "primary_key": "Every table has XXX_KEYU",
    "access_pattern": "ACT_CODE + entity code",
    "exceptions": ["List of exceptions"]
  },
  "safety_rules": [
    "Rule 1",
    "Rule 2"
  ]
}
```

### Procedure Format

```json
{
  "document_name": "Procedure Name",
  "version": "1.0",
  "category": "Category Name",
  "procedures": [
    {
      "name": "Step Name",
      "description": "What this step does",
      "steps": [
        "Step 1 description",
        "Step 2 description"
      ],
      "sql": "SELECT * FROM table WHERE condition",
      "related_tables": ["TABLE1", "TABLE2"],
      "access_level": "Support/Admin",
      "safety_notes": ["Note 1", "Note 2"]
    }
  ]
}
```

## 6.4 Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GROQ_API_KEY` | Groq API authentication key | `gsk_...` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VECTOR_STORE_PATH` | `DATA/vector_store` | Path to FAISS index |
| `CHUNKS_PATH` | `DATA/unified_semantic_chunks/unified_chunks.json` | Path to chunks file |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
| `MAX_TOKENS` | `2048` | Maximum LLM response tokens |
| `TEMPERATURE` | `0` | LLM temperature (determinism) |

### Streamlit Secrets Configuration

Create `.streamlit/secrets.toml`:

```toml
# Required
GROQ_API_KEY = "gsk_your_api_key_here"

# Optional overrides
[paths]
vector_store = "/custom/path/to/vector_store"
chunks = "/custom/path/to/unified_chunks.json"

[model]
default = "meta-llama/llama-4-maverick-17b-128e-instruct"
temperature = 0
max_tokens = 2048
```

### Azure App Service Configuration

When deploying to Azure, set these in Application Settings:

```bash
az webapp config appsettings set \
  --resource-group rg-puks-ai \
  --name puks-ai-webapp \
  --settings \
    GROQ_API_KEY="your-key" \
    WEBSITES_PORT="8501" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

---

## Appendix A: Quick Reference

### Retrieval Parameters (APP.py)

```python
VECTOR_CANDIDATES = 40      # Number of candidates from vector search
RERANK_CANDIDATES = 25      # Number to pass to reranker
TOP_K_DEFAULT = 5           # Final results returned
CONFIDENCE_THRESHOLD = 0.01 # Minimum confidence to respond

W_VECTOR = 0.6              # Vector score weight
W_BM25 = 0.3                # BM25 score weight
W_HYBRID = 0.7              # Hybrid score weight in final
W_RERANK = 0.3              # Rerank score weight in final
```

### Supported LLM Models

| Display Name | Model ID |
|--------------|----------|
| openai/gpt-oss-120b | openai/gpt-oss-120b |
| Llama 4 Maverick 17B | meta-llama/llama-4-maverick-17b-128e-instruct |
| Qwen 3 32B | qwen/qwen3-32b |
| Llama 3.1 8B (Fast) | llama-3.1-8b-instant |

### Chunk Types

| Type | Description | Count |
|------|-------------|-------|
| `schema_overview` | Table overview and description | 18 |
| `schema_core_columns` | Primary columns documentation | 17 |
| `schema_extra_columns` | Extended columns documentation | 15 |
| `text_prose` | General documentation text | 470 |
| `text_table` | Extracted tables as text | 25 |
| `wms_overview` | WMS module overviews | 18 |
| `wms_join_logic` | Table relationship documentation | 18 |
| `wms_safety_rules` | Safety and access rules | 18 |
| `wms_procedure` | Step-by-step procedures | 28 |

---

## Appendix B: File Structure

```
SPEED CHATBOT PROJECT/
├── APPLICATION(STREAMLIT)/
│   ├── APP.py                    # Main Streamlit application
│   ├── home.py                   # Alternate home page
│   ├── Help Page.py              # Support form page
│   ├── requirements.txt          # App dependencies
│   ├── data/
│   │   └── vector_store/         # Local vector store (optional)
│   ├── Pictures/                 # UI assets
│   └── style/
│       └── style.css             # Custom CSS
│
├── DATA/
│   ├── Database Tables/          # Schema JSON files (18 tables)
│   ├── Speed Support Document/   # Procedure JSONs and PDFs
│   ├── unified_semantic_chunks/
│   │   └── unified_chunks.json   # All processed chunks
│   ├── vector_store/
│   │   ├── faiss.index           # FAISS vector index
│   │   ├── metadata.pkl          # Chunk metadata
│   │   └── config.json           # Index configuration
│   ├── Extracted/                # Intermediate extraction output
│   ├── Cleaned_Generative/       # Cleaned text files
│   └── [Category folders]/       # Raw documents by category
│
├── SCRIPTS/
│   ├── 01_document_ingestion.ipynb
│   ├── 02_text_cleaning_preprocessing.ipynb
│   ├── 03_text_chunking.ipynb
│   ├── 04_embeddings_and_vector_store.ipynb
│   ├── 05_retrieval_testing.ipynb
│   ├── 06_rag_pipeline.ipynb
│   ├── 07_llm_answer_generation.ipynb
│   ├── 08_end_to_end_validation.ipynb
│   ├── requirements.txt          # Notebook dependencies
│   └── document_list.txt         # Source document manifest
│
├── Powerapps/
│   ├── HTML FORM/                # Support ticket HTML templates
│   └── HTML FORM Report/         # Report templates
│
├── Handover Documents/
│   └── AGL_Handover_1_Overview.pdf
│
└── DOCUMENTATION.md              # This file
```

---

**Document Version:** 1.0  
**Last Updated:** June 2026  
**Maintained By:** Speed WMS Support Team
