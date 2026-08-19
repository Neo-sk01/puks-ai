# Puks AI — Speed WMS Support Assistant

> **Predictive Unified Knowledge System.** A RAG assistant that answers Speed WMS support questions from AGL's warehouse documentation.

**Status: not deployed. Does not currently run outside its original author's laptop.** Read [§1](#1-read-this-first) before doing anything.

Built for **AGL / Africa Global Logistics** (MSC group). Original author: Siyanda Matolengwe. Azure environment owner (per resource tags): **Dominique Kouassi**, ServiceNow case `INC2620802`.

---

## Table of contents

1. [Read this first](#1-read-this-first)
2. [What it does and how](#2-what-it-does-and-how)
3. [Repository layout](#3-repository-layout)
4. [Running it locally](#4-running-it-locally)
5. [The knowledge base and how to rebuild it](#5-the-knowledge-base-and-how-to-rebuild-it)
6. [The Azure environment](#6-the-azure-environment)
7. [Deploying](#7-deploying)
8. [What the bicep does not contain](#8-what-the-bicep-does-not-contain)
9. [Traps](#9-traps)
10. [Known defects](#10-known-defects)
11. [Security and compliance](#11-security-and-compliance)
12. [Cost](#12-cost)
13. [Where this is going](#13-where-this-is-going)

---

## 1. Read this first

Five things that will otherwise cost you a day each.

| # | Thing |
|---|---|
| 1 | **Three live Groq API keys were published to a public GitHub repo.** They are redacted here but **not revoked**. Rotate them at `console.groq.com` before anything else. See [§11](#11-security-and-compliance). |
| 2 | **The app cannot start anywhere but its author's machine.** `APP.py:24-25` hardcodes `C:\Users\kgathola.puka\OneDrive - MSC\...`. See [§4](#4-running-it-locally). |
| 3 | **BM25 contributes no recall.** It only re-ranks the 40 documents dense retrieval already picked, so the search ceiling is 40/627 = **6.4%** of the corpus. This is a design fault, not a tuning problem. See [§10](#10-known-defects). |
| 4 | **You probably cannot see the Azure subscription.** The resources live in `f700ffcf-…`, which most AGL accounts cannot reach. Verify before planning anything. See [§6](#6-the-azure-environment). |
| 5 | **`ci-cd.yml` and `docs/DEPLOYMENT.md` are fiction.** They deploy to app names that do not exist, in a region this project does not use. Do not follow them. See [§7](#7-deploying). |

### Trust map

The repo ships more documentation than code, and most of it describes a system that was never built. Before you open anything:

| File | Verdict |
|---|---|
| **`README.md`** (this) | Trust. Every fact dated and sourced; see the closing note. |
| **`DOCUMENTATION.md`** (68 KB) | **Trust the code sections only.** Its deployment half is fiction: it creates `rg-puks-ai` in `southafricanorth`, supplies Terraform for infrastructure that does not exist, rolls back via slot swap on a **B1 plan that cannot have slots**, and references a `retrain.sh` that is not in the tree. |
| **`docs/DEPLOYMENT.md`** | **Do not follow.** Same greenfield fantasy, wrong region, wrong resource group. |
| **`.github/workflows/ci-cd.yml`** | **Do not follow.** Builds an image with `push: false` and deploys to app names that do not exist. |
| **`Dockerfile`** / **`docker-compose.yml`** | Delete. Streamlit/torch image, unused, and Compose multi-container on App Service retires 2027-03-31. |
| **`CONTRIBUTING.md`** / **`SECURITY.md`** / **`CHANGELOG.md`** | Generic boilerplate. Harmless, not project-specific. |
| **`Handover Documents/AGL_Handover_1_Overview.pdf`** | Unreviewed. Read it before assuming this README is complete. |
| **`APPLICATION(STREAMLIT)/data/vector_store/`** | Delete. Wrong model, wrong size — see §4. |
| **`SCRIPTS/07_llm_answer_generation - Copy.ipynb`** | Delete. Unreconciled duplicate. |
| **`SCRIPTS/08_end_to_end_validation.ipynb`** | A stub. There is no end-to-end validation — see §5. |
| **`home.py`** / **`Help Page.py`** | Deletable. A redundant landing page and a form that submits nowhere. |

The previous marketing-style README is preserved in git history at commit `ed3b4d6`.

---

## 2. What it does and how

A support agent asks *"how do I reverse a closed GRN?"*. Puks AI finds the most relevant documents from a 627-chunk knowledge base, hands them to an LLM, and the LLM answers **using only what it was given**.

```
Question
   │
   ├─ classify_query()        schema / operational / SQL intent
   │
   ├─ FAISS dense search      all-MiniLM-L6-v2, 384-dim, IndexFlatIP, top 40
   │     └─ BM25 re-weights   ⚠ only those same 40 — see §10.1
   │
   ├─ CrossEncoder rerank     ms-marco-MiniLM-L-6-v2, top 25 → top 5
   │
   ├─ build_prompt()          context-only guardrails, 8-turn memory
   │
   └─ Groq API                gpt-oss-120b / llama-4-maverick / qwen3-32b / llama-3.1-8b
```

**Retrieval weights** (`APP.py:36-39`): `W_VECTOR 0.6`, `W_BM25 0.3`, then `W_HYBRID 0.7`, `W_RERANK 0.3`.

> These weights do not mean what they appear to. `ms-marco-MiniLM-L-6-v2` is configured with Identity activation, so `predict()` returns unbounded BCE logits (roughly ±11) which are summed onto a bounded quantity. The reranker actually carries **77–95%** of the score variance, not 30%. Tuning those constants moves very little.

---

## 3. Repository layout

```
APPLICATION(STREAMLIT)/
  APP.py                  main app (22 KB) — chat, retrieval, prompt assembly
  home.py                 landing page — the ONLY file with correct relative paths
  Help Page.py            help form (a no-op mock; submits nowhere)
  data/vector_store/      ⚠ STALE — 200 vectors at 768 dims, a different model. See §4.
  style/style.css
  Pictures/

DATA/
  Cleaned_Generative/     cleaned source documents, by WMS area
    Database Tables/      18 table schemas as JSON
    LOREAL/               19 client-specific procedure documents
    Speed Support Document/
    GENERAL/ LOADING/ ORDER PREPARATION/ RECEIVING GOODS/ ...
  Extracted/              raw text extracted from PDF/DOCX (pipeline stage 1 output)
  unified_semantic_chunks/
    unified_chunks.json   ← THE CORPUS. 627 chunks, 1.3 MB.
  vector_store/           ← THE REAL INDEX. 673 vectors. faiss.index + metadata.pkl + config.json
  Support Ticket Docs/    only 2 tickets

SCRIPTS/                  9 notebooks — the build pipeline, see §5
Powerapps/                Power Automate HTML email templates (Dataverse-backed, separate system)
Handover Documents/       AGL_Handover_1_Overview.pdf
docs/DEPLOYMENT.md        ⚠ boilerplate, targets a greenfield RG that does not exist
.github/workflows/        ⚠ aspirational, see §7
Dockerfile                ⚠ Streamlit/torch image. Not used. Slated for deletion — see §7.
docker-compose.yml        ⚠ same
```

---

## 4. Running it locally

**It will not start as-is.** `APP.py:24-25` and `Help Page.py:39` point at an absolute Windows path on the original author's OneDrive.

Minimum change to run:

```python
# APP.py — replace lines 24-25
from pathlib import Path
BASE          = Path(__file__).resolve().parent.parent          # repo root
CHUNKS_PATH   = BASE / "DATA" / "unified_semantic_chunks" / "unified_chunks.json"
VECTOR_STORE  = BASE / "DATA" / "vector_store"                  # NOT APPLICATION(STREAMLIT)/data
```

> **Point `VECTOR_STORE` at `DATA/vector_store`, not the copy beside the app.** The one under `APPLICATION(STREAMLIT)/data/vector_store` is from a different experiment entirely and has no `config.json`.

Read the FAISS headers rather than trusting file size — the two are indistinguishable by size alone:

```python
import struct
d, ntotal = struct.unpack('<iq', open("<path>/faiss.index", 'rb').read(16)[4:16])
```

| Index | `d` | `ntotal` | Bytes |
|---|---:|---:|---:|
| `DATA/vector_store/` ✅ | **384** | **673** | 1,033,773 |
| `APPLICATION(STREAMLIT)/data/vector_store/` ❌ | **768** | **200** | 614,445 |

`d = 768` means the stale index was built with a **different embedding model**, not merely fewer documents — 384 is `all-MiniLM-L6-v2`. Loading it against a MiniLM query vector fails outright on dimension mismatch; there is no silent-wrong-answer mode, which is the one mercy here.

> Do not try to identify these by byte count. `400 × 384 × 4` and `200 × 768 × 4` are **both** 614,400. Only the header distinguishes them.

There are **three** `st.secrets["GROQ_API_KEY"]` call sites, not one — `APP.py:145`, `home.py:52`, `Help Page.py:54`. If you only fix `APP.py` the other two still raise on import. The cleaner fix is to delete `home.py` and `Help Page.py`: the first is a redundant landing page and the second is a form that submits nowhere.

Then:

```bash
python3.11 -m venv .venv && source .venv/bin/activate      # 3.11 pinned for reproducibility; 3.10+ also resolves
pip install -r requirements.txt                            # ~2 GB: torch, faiss, transformers
mkdir -p "APPLICATION(STREAMLIT)/.streamlit"
echo 'GROQ_API_KEY = "<your-own-new-key>"' > "APPLICATION(STREAMLIT)/.streamlit/secrets.toml"
streamlit run "APPLICATION(STREAMLIT)/APP.py"
```

`.streamlit/secrets.toml` is gitignored. Get your own key; do not reuse the redacted ones.

---

## 5. The knowledge base and how to rebuild it

**627 chunks** from **194 source files**, no exact duplicates.

| `chunk_type` | Count | What it is |
|---|---:|---|
| `text_prose` | 470 | narrative procedure text |
| `wms_procedure` | 28 | step-by-step operations with SQL |
| `text_table` | 25 | tabular content |
| `schema_overview` | 18 | table definitions |
| `wms_overview` | 18 | area introductions |
| `wms_join_logic` | 18 | table relationships |
| `wms_safety_rules` | 18 | do-not-do rules |
| `schema_core_columns` | 17 | primary columns |
| `schema_extra_columns` | 15 | remaining columns |

Chunk text: min 45 chars, median 680, mean 754, max 6,059. 100 chunks carry `structured_data`.

### The pipeline

Run in order. Every notebook has hardcoded Windows paths that need the same fix as §4.

| Notebook | Reads | Writes |
|---|---|---|
| `01_document_ingestion` | `DATA/` (PDF, DOCX) | `DATA/Extracted/` |
| `02_text_cleaning_preprocessing` | `DATA/Extracted/` | `DATA/Cleaned_Generative/` |
| `03_text_chunking` | `DATA/Cleaned_Generative/` | `DATA/unified_semantic_chunks/` |
| `04_embeddings_and_vector_store` | `unified_chunks.json` | `DATA/vector_store/` |
| `05_retrieval_testing` | index | — evaluation. **Contains the 8 seed queries** — see §5.1 |
| `06_rag_pipeline` | index | — context assembly |
| `07_llm_answer_generation` | — | — prompt/answer testing |
| `07_llm_answer_generation - Copy` | — | **duplicate, delete it** |
| `08_end_to_end_validation` | — | ⚠ **a 4-cell stub.** Its entire code is `print('Full system validation')` and `pip install streamlit`. There is no end-to-end validation. |
| `table_scheme` | `DATA/Database Tables/` (xlsx) | schema JSON |

### 5.1 The only evaluation asset that exists

`05_retrieval_testing.ipynb` carries an 8-query `test_queries` list. It is not a golden set — there are no expected answers — but it is the seed of one, and it is the only thing in the repo resembling a test:

```python
# Operational
"How do I reverse a GRN?"
"Reset a mission in Speed"
"Resend outbound shipment"
# Schema
"What is the primary key of REE_DAT?"
"Show join between REE_DAT and DOS_DAT"
"List columns of REE_DAT"
"How does receipt relate to STK_DAT table?"
# Text/General
"Explain warehouse picking process"
```

**Capture a baseline against these before you change retrieval.** Record which source documents come back in the top 5 for each. Without that, fixing defect §10.1 is unfalsifiable — you will have no way to show the change helped rather than hurt. Note that *"How do I reverse a GRN?"* retrieves a 165-character chunk whose SQL exists but is never rendered into the prompt (§10.6) — a useful canary for the context-assembly bug as well as for retrieval.

### 5.2 `structured_data` is not uniformly shaped

Of the 100 chunks with non-empty `structured_data`: **82 are dicts, 18 are lists.** Any code touching it must handle both. `chunk_type` lives under `metadata`, not at the top level.

**To add a document:** drop it in the right `DATA/Cleaned_Generative/<AREA>/` folder, then re-run `03` and `04`. There is no incremental path — it is a full rebuild.

### Why the index has 673 vectors for 627 chunks

`04_embeddings_and_vector_store.ipynb` cell 5 embeds `wms_procedure` and `schema_overview` chunks **twice** (`OPERATIONAL_BOOST = 2`, plus a hardcoded duplication of `schema_overview` that ignores `SCHEMA_BOOST = 1`). 627 + 28 + 18 = 673.

**This never worked as a ranking boost.** Identical vectors produce identical inner products in an exact `IndexFlatIP` search, land adjacently in the results, and `APP.py:252`'s `if text in seen_texts: continue` keeps the first at exactly the rank it would have held without duplication. It only consumed a candidate slot. Do not reproduce it.

### `enrich_text()` — load-bearing, easy to lose

`04` cell 4 prepends metadata to each chunk **before embedding**: `CATEGORY`, `SOURCE`, `DOCUMENT TYPE`, plus type-specific fields (`TABLE NAME`, `RELATED TABLES`, `PRIMARY KEY`, `FOREIGN KEYS` for schemas; `PROCEDURE`, `BUSINESS LOGIC`, `ACCESS LEVEL`, join keys for operational chunks).

It also appends a keyword-stuffing line **only for `OPERATIONAL_REFERENCE` chunks**:

```
KEYWORDS: reverse, resend, reset, grn, receipt, order, movement, mission, loading, stock, inbound, outbound
```

That asymmetry is why *"reverse a GRN"* finds operational content. If you re-embed without porting `enrich_text()` verbatim, retrieval quality drops and the cause is not obvious.

---

## 6. The Azure environment

Everything below is from the ARM export (`main.bicep`, 3,059 lines, 33 params) taken 2026-08-18.

**Subscription** `f700ffcf-f34a-462a-9876-234f445307d0` · **RG** `CH011AGL0C8-AGEW-RGRT001` · **Region** West Europe · **Tenant** `088e9b00-ffd0-458e-bfa1-acf4c596d3cb`

### Check your access first

```bash
az login --tenant 088e9b00-ffd0-458e-bfa1-acf4c596d3cb
az account show --subscription f700ffcf-f34a-462a-9876-234f445307d0
```

If that returns `Subscription 'f700ffcf-…' not found`, you have tenant access but not subscription access, and **every Azure step in this README is blocked**. Raise it immediately — it is the longest-lead item in the project. Ask for:

- **Contributor** on `CH011AGL0C8-AGEW-RGRT001` — deploy, site config, model deployments
- **User Access Administrator** on the same scope — to create the role assignments the app's managed identity needs

Ask for both at once. Requesting Contributor alone gets you blocked a week later.

### Why the estate looks incoherent

The environment makes no sense until you see that **it was provisioned for a different, more ambitious system than the one in this repo.** The evidence is in `Powerapps/` — nine HTML templates full of Power Automate bindings (`@{triggerOutputs()?['body/TicketID']}`, `body/RootCause`, `body/FinalResolutionSummary`, `body/ValidationSteps`, `body/PreventionSteps`) against a Dataverse ticket system.

| | Intended | Actually built |
|---|---|---|
| Retrieval | Azure AI Search | local FAISS |
| Generation | Foundry `gpt-5` | Groq API |
| Ticket capture | Power Automate → Azure SQL | the Help form saves nothing |
| Knowledge growth | resolved tickets feed the corpus | static 627-chunk snapshot |

That single gap explains everything otherwise puzzling here: why **$245/month of AI Search sits idle**, why a `gpt-5` deployment with capacity 50 has no caller, why there is an empty Cosmos account wired into AI Foundry, why the SQL database `0C8_wmsspeedai_puksai` exists with no schema this repo references, and why the Help & Support form is a mock.

The resolved-ticket corpus is also the highest-value knowledge source available and it is **not in the index** — those tickets carry root causes and validation steps, which is exactly what `wms_procedure` chunks are missing (§10.6).

### What exists

| Resource | Name | Config that matters |
|---|---|---|
| **AI Foundry** | `ch011agl0c8-agew-aift003` | `AIServices` S0, SystemAssigned identity, `publicNetworkAccess: Enabled`, project **`WMS-Speed-AI-Chatbot`** |
| **Model deployment** | `gpt-5` | version `2025-08-07`, GlobalStandard, capacity 50, RAI `Microsoft.DefaultV2` — **the only model deployed** |
| **AI Search** | `ch011agl0c8-agew-asst001` | `standard`, 1 replica / 1 partition, `semanticSearch: free`, **`authOptions: apiKeyOnly`** |
| **App Service** | `ch011agl0c8-agew-awat001` | B1 Linux, **`publicNetworkAccess: Disabled`**, **has UMIT001**, subnet `SNTT025-VINT` |
| **App Service** | `ch011agl0c8-agew-awat002` | B1 Linux, **`publicNetworkAccess: Enabled`**, **no identity**, subnet `SNTT026-VINT` |
| **Function Apps** | `…-afut001` / `…-afut002` | FlexConsumption FC1, Python 3.13, `publicNetworkAccess: Disabled` |
| **Azure SQL** | `0C8_wmsspeedai_puksai` | on `ch011agl0c8-agew-sqlt01`, GP_S_Gen5_2 serverless, 32 GB |
| **Cosmos DB** | `ch0110c8agl-agew-cdbt001` | **zero databases, zero containers** — empty placeholder |
| **Key Vault** | `CH011AGL0C8-AGEW-AKVT001` | access policies (not RBAC), **`publicNetworkAccess: Disabled`** |
| **Storage** | `…xsact001` / `…xsact002` | both `publicNetworkAccess: Enabled`, `allowSharedKeyAccess: true` |
| **Managed identity** | `CH011AGL0C8-AGEW-UMIT001` | attached to **awat001 only** |
| **Form Recognizer** | `DECLARE` | F0, **francecentral** — unrelated to this project, see §9 |

### The two web apps are configured backwards

This is the single most important structural fact about the environment:

| | awat001 | awat002 |
|---|---|---|
| Reachable by users | ❌ private | ✅ public |
| Has a managed identity | ✅ UMIT001 | ❌ none |

**Reachability and authorization live in different sites.** Whichever you pick, you fix one of these. Attaching an identity to awat002 is a one-line `az webapp identity assign`; making awat001 reachable needs VPN/ExpressRoute plus `privatelink.azurewebsites.net` DNS for every client machine — owned by a team outside this resource group.

### Site config is wrong for anything but Python

Both web apps, identically:

| Property | Value | Verdict |
|---|---|---|
| `linuxFxVersion` | **`PYTHON\|3.14`** | Set in **two** places per site — the inline `siteConfig` *and* the `config/web` child. Change both. |
| `appCommandLine` | *absent* | No startup command at all. |
| `alwaysOn` | **`false`** | Worker unloads after ~20 min idle. Free to enable on B1. |
| `healthCheckPath` | *absent* | No health probe. |
| `httpLoggingEnabled` / `detailedErrorLoggingEnabled` | **`false`** | **You will debug a failed boot blind.** Turn these on first. |
| `webSocketsEnabled` | `false` | **Inert on Linux** — WebSockets are always enabled for Linux apps and the ARM property does not apply. Do not spend time on it. If a Streamlit WebSocket drops, look at XSRF/CORS behind the front-end proxy, not this flag. |
| `use32BitWorkerProcess` | `true` | **Inert on Linux.** A Windows-template leftover, not a real constraint. |
| `vnetRouteAllEnabled` | `true` | All outbound goes through the integration subnet, whose NSGs/UDRs live in `ALEW1IT-RG-T01` — a different resource group. |
| `defaultDocuments` | includes `hostingstart.html` | Neither site has ever been deployed to. |
| `ipSecurityRestrictions` | `Allow all` | On public awat002 this means **fully open** at the app layer. |

`outboundVnetRouting` on both: `applicationTraffic: true`, `imagePullTraffic: false`, everything else false.

---

## 7. Deploying

### The `ci-cd.yml` in this repo does not work

- The Docker build has **`push: false`** — the image is built and discarded, never pushed anywhere.
- It deploys to `puks-ai-staging` and `puks-ai-production`. **Neither exists.**
- It authenticates with `secrets.AZURE_CREDENTIALS` (a service principal blob), not OIDC.

`docs/DEPLOYMENT.md` is the same: it targets a greenfield `rg-puks-ai` in `southafricanorth`. Ignore both.

### Basic auth being disabled does *not* block deployment

All four sites have `basicPublishingCredentialsPolicies` `ftp: allow=false` **and** `scm: allow=false`. This looks like a wall. It is not.

Disabling basic auth closes **one of two** accepted auth schemes on the Kudu endpoint. Entra tokens still work. Per [Microsoft Learn](https://learn.microsoft.com/azure/app-service/configure-basic-auth-disable#deploy-without-basic-authentication), `az webapp deploy` and `az webapp up` **"fall back to Microsoft Entra authentication"** on Azure CLI ≥ 2.48.1.

| Method | Works with basic auth off? |
|---|---|
| `az webapp deploy` / `az webapp up` | ✅ Entra fallback |
| `azure/webapps-deploy@v3` + `azure/login` OIDC | ✅ uses an ARM token |
| Azure Pipelines `AzureWebApp` task | ✅ |
| FTP | ❌ |
| Local Git | ❌ |
| Publish profile | ❌ |
| **ACR webhook / container "Continuous deployment" toggle** | ❌ **requires SCM basic auth** |

> **`ftp: allow=false` is redundant** — SCM basic auth is a prerequisite for FTP basic auth.

### Deploying to awat002 (the recommended target)

> **This is the runbook for the planned Next.js build ([§13](#13-where-this-is-going)), not for the Streamlit app in this repo.** There is no Node application here yet — `find . -name package.json` returns nothing. Steps 0–4 are safe today; **step 5 needs an artefact that does not exist**, and running 0–4 alone leaves the site switched away from Python with nothing deployed. For the Streamlit app, use `PYTHON|3.11` and a `streamlit run` startup command instead.

```bash
az account set -s f700ffcf-f34a-462a-9876-234f445307d0   # four subscriptions are in scope; pin it
RG=CH011AGL0C8-AGEW-RGRT001
APP=ch011agl0c8-agew-awat002

# 0. Turn on logging BEFORE anything else, or you debug blind
az webapp log config -g $RG -n $APP --web-server-logging filesystem --detailed-error-messages true

# 1. Attach the existing managed identity (awat002 has none today)
UMI=$(az identity show -g $RG -n CH011AGL0C8-AGEW-UMIT001 --query id -o tsv)
az webapp identity assign -g $RG -n $APP --identities "$UMI"

# 1b. REQUIRED. Neither site has a system-assigned identity, so without this
#     DefaultAzureCredential probes one that does not exist and every Foundry
#     call returns 401 — hours after a deploy that reported success.
CID=$(az identity show -g $RG -n CH011AGL0C8-AGEW-UMIT001 --query clientId -o tsv)
az webapp config appsettings set -g $RG -n $APP --settings AZURE_CLIENT_ID=$CID

# 1c. Data-plane access to gpt-5. This is what the User Access Administrator
#     request in section 6 is FOR. Needs Owner or UAA on the resource group.
PID=$(az identity show -g $RG -n CH011AGL0C8-AGEW-UMIT001 --query principalId -o tsv)
az role assignment create --assignee-object-id $PID --assignee-principal-type ServicePrincipal \
  --role "Cognitive Services OpenAI User" \
  --scope $(az cognitiveservices account show -g $RG -n ch011agl0c8-agew-aift003 --query id -o tsv)

# 2. Runtime — confirm the stack first, it is stamp-specific
az webapp list-runtimes --os linux | grep -i NODE
az webapp config set -g $RG -n $APP --linux-fx-version "NODE|22-lts"

# 3. Always On — free on B1, the highest-value single change here
az webapp config set -g $RG -n $APP --always-on true

# 4. Startup command + skip the platform build (deploy a prebuilt artifact)
az webapp config set -g $RG -n $APP --startup-file "node server.js"
az webapp config appsettings set -g $RG -n $APP --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false

# 5. Deploy, and PROVE it used Entra rather than basic auth
az webapp deploy -g $RG -n $APP --src-path app.zip --type zip --debug 2>&1 \
  | grep -iE "bearer|token|publishingcredential|401|403"
```

Step 5 should show a **bearer token** being acquired, not publishing credentials.

> **App settings: use `az`, not bicep.** A bicep `Microsoft.Web/sites/config` child named `appsettings` is a **full replace** and silently wipes every existing setting. `az webapp config appsettings set` is a genuine PATCH. Back up first: `az webapp config appsettings list -g $RG -n $APP > appsettings-backup.json`.

### Deploying to awat001 (private)

`publicNetworkAccess: Disabled` gates **both** the main site and the SCM site, so a GitHub-hosted runner cannot reach Kudu regardless of auth. Two Kudu-free routes exist:

1. **ARM `onedeploy` extension** — routes through `management.azure.com` rather than Kudu
2. **`WEBSITE_RUN_FROM_PACKAGE`** pointed at a blob — unsupported for Python and Java, **Node is not excluded**, but `wwwroot` becomes read-only, which Next.js ISR and the image optimiser may not tolerate. Test under load, not just at startup.

A **self-hosted runner inside the VNet** would make every option work on both sites. Worth asking whether AGL already runs one.

### Do not containerise

Evaluated and rejected. No ACR exists in the RG; Basic and Standard ACR **cannot be network-restricted at all** (no IP rule surface), so posture consistency forces Premium at **$50.69/mo**; and the Kudu-free deploy path it would buy already works via Entra. The `Dockerfile` and `docker-compose.yml` here target the Streamlit/torch stack and should be deleted — Compose multi-container on App Service supports neither managed identity nor VNet integration and retires **2027-03-31**.

If you ever revisit: container image pull is **configuration traffic**, not application traffic. `vnetRouteAllEnabled` does not route it; the separate property is `outboundVnetRouting.imagePullTraffic`.

---

## 8. What the bicep does not contain

> **Important caveat.** ARM exports **never** include app settings, connection strings, or role assignments. Their absence from `main.bicep` is *not* evidence they are unset in Azure. Verify with `az` once you have access before concluding anything is missing.

| Missing | Consequence |
|---|---|
| **Any embedding model deployment** | Only `gpt-5` is deployed. Any vector search needs a `text-embedding-3-*` deployment added. |
| **Application Insights / Log Analytics** | No telemetry anywhere. Filesystem logging (§7 step 0) is the only diagnostic until you add it. |
| **Role assignments** | None visible. Whether UMIT001 can actually reach Foundry, Search or Storage is **unknown** until checked live. |
| **A staging slot** | B1 Basic does not support deployment slots. No blue/green. |
| **Container registry** | None. See §7. |
| **NAT gateway, firewall, route table** | None in the export — the subnets' NSGs and UDRs live in `ALEW1IT-RG-T01`. Egress behaviour is unverified. |

### Provisioned but unused

| Resource | Status |
|---|---|
| **Cosmos DB** | Zero databases, zero containers. Costs **$0** — but it is wired into AI Foundry as an AAD connection, so something expected it to be real. |
| **Azure SQL `0C8_wmsspeedai_puksai`** | Serverless, no schema referenced anywhere in this repo. |
| **AI Search `asst001`** | ~**$245/month**, unused by the current app, which uses local FAISS. |
| **Function Apps ×2** | Two separate FC1 plans for two apps sharing one storage account and one SNOW case. One plan would have done. |
| **Form Recognizer `DECLARE`** | F0, in **francecentral** — the only resource outside West Europe, no tags, no identity, no relationship to anything else. Almost certainly a stray from another project sharing the RG. |
| **`ch011agl0c8-agew-aift001-PL`** | A private endpoint, status `Disconnected`, pointing at a search service **that does not exist**. Still billed ~**$7.30/mo**. |

---

## 9. Traps

**`keyVaultReferenceIdentity: 'SystemAssigned'` is set on all four sites, and not one has a system-assigned identity.** Every `@Microsoft.KeyVault(...)` app setting will resolve to the literal reference string rather than the secret. To use Key Vault on awat001 you must set `keyVaultReferenceIdentity` to the UMIT001 *resource ID* and add UMIT001 to the vault's access policies.

**The Key Vault private endpoint has no `privateDnsZoneGroup`** — the only one of eight without one. It relies on a `customDnsConfig` of `172.29.35.81`, which is descriptive output, not configuration. With the vault at `publicNetworkAccess: Disabled`, anything that cannot resolve that FQDN by other means simply fails. Avoid Key Vault for this project unless you have a reason.

**The AI Search service contradicts its own Foundry connection.** The Foundry connection declares `authType: 'AAD'`, but the service has `authOptions: { apiKeyOnly: {} }` — Entra data-plane auth is *disabled*. Managed-identity queries will fail until someone runs `az search service update --auth-options aadOrApiKey`.

**Never redeclare the search service in bicep.** A full resource declaration is a PUT and will silently reset `semanticSearch: 'free'`, disabling the semantic reranker. It presents as "results got worse", not as an error. Use `az search service update` instead.

**`semanticSearch: 'free'` is capped at 1,000 requests/month service-wide**, after which semantic queries return a *billing error*, not degraded results.

**Python 3.14 is not the problem — check wheels before you blame a version.** *Corrected 2026-08-19; an earlier version of this README claimed the opposite.* All three packages install on 3.14: `torch` 2.13.0 ships `cp314-cp314-manylinux_2_28_x86_64`, `faiss-cpu` 1.15.0 ships `cp310-abi3` (stable ABI, installs on 3.10–3.14), and `sentence-transformers` 6.0.0 is `py3-none-any`.

To check against the deploy target rather than your laptop, pass the target tags — omitting `--abi abi3 --abi none` hides faiss-cpu's stable-ABI wheel and every pure-Python wheel, which is how this myth starts:

```bash
pip install --dry-run --only-binary=:all: \
  --python-version 3.14 --implementation cp \
  --abi cp314 --abi abi3 --abi none \
  --platform manylinux_2_28_x86_64 --platform any \
  -r requirements.txt
```

The app has still never run on that App Service — because of the hardcoded Windows paths (§4), the absent `appCommandLine`, and the fact that neither site has ever been deployed to. Not because of Python 3.14.

**Storage private endpoint is `file` only**, while every real dependency on `sact001` (Function deployment packages, `azure-webjobs-hosts`, `azure-webjobs-secrets`) is **blob**. Blob traffic uses the public endpoint. It works, but the private-link posture is cosmetic.

**Four subscriptions are referenced by this bicep**, three of which most AGL accounts cannot see. Notably `0f13f064-…` (**HQ**) holds two of the four private DNS zones this estate depends on — and that one *is* commonly accessible.

**`main.bicep` cannot be redeployed as-is.** It has one `@secure()` param, `vulnerabilityAssessments_Default_storageContainerPath`, with **no default value**. Any `az deployment group create` will prompt interactively or fail. Treat the file as documentation of current state, not as a deployable template. Make changes with a small additive module using `existing` references.

**If you build a Next.js front end:** `.next/standalone` does **not** copy `public/` or `.next/static` — the app boots and every asset 404s. And Docker injects `HOSTNAME=<container-id>`, which Next's standalone server binds to; never create an app setting named `HOSTNAME`.

---

## 10. Known defects

### 10.1 BM25 contributes no recall — the big one

`APP.py:233` searches FAISS for `VECTOR_CANDIDATES = 40`. Line 243 then iterates **only those 40** and looks up `bm25_norm[raw_idx]`.

BM25 can never surface a document that dense retrieval missed. It only re-weights dense's picks. **Recall ceiling: 40/627 = 6.4%.**

The practical effect: a document findable only by an exact code (`REE_DAT`, `LPN`, `ZPA`, `DLUO`) is invisible if the semantic search missed it. Fixing this means running both retrievers independently across the full corpus and fusing the results — the standard fix is Reciprocal Rank Fusion.

### 10.2 The refusal threshold is not calibrated

`CONFIDENCE_THRESHOLD = 0.01` gates whether the app answers or says "I don't know". It compares a blend of a bounded hybrid score and an **unbounded** CrossEncoder logit. Its effective strictness varies roughly **7×** depending on which metadata boosts happened to fire — loosest exactly when retrieval is most driven by hand-tuned priors.

This matters more than it sounds: the answers include SQL that people run against a live WMS.

### 10.3 Intent classification inverts on common queries

`APP.py:211-212`:

```python
if is_schema and is_operational:
    is_schema = False
```

Both keyword sets contain ordinary WMS nouns. *"List all columns in the receipt header table REE_DAT"* contains "receipt" → classified operational → gets the operational boost and **not** the schema boost. Exactly backwards. 11 of 50 schema chunks contain an operational keyword in their own header text, so this is systematic.

### 10.4 SCHEMA MODE never fires for the chunks that list columns

`has_schema` is set only for `schema_overview`. The 32 `schema_core_columns` and `schema_extra_columns` chunks — the ones that actually enumerate columns — never trigger it.

### 10.5 MVT_DAT has 32 unretrievable columns

*Corrected 2026-08-19. An earlier version of this section claimed all 1,574 column names were unreachable. That was wrong — measure before you act on it.*

Of the 1,574 column entries across 18 tables, **1,542 appear verbatim in some chunk's raw text**, which is both embedded and BM25-indexed. They are retrievable.

The exception is **MVT_DAT**: it is the only table with no `schema_core_columns` chunk, so 32 of its columns — including `MVT_QTE` (quantity), `MVT_SENS` (direction), `MVT_NoMV` (movement number) — appear in no chunk text anywhere. They reach the model only if the MVT_DAT `schema_overview` chunk is retrieved by some other signal, at which point `build_context_text` (`APP.py:352-383`) dumps `structured_data["columns"]` into the prompt.

Verify with:

```python
names = [col["name"] for c in chunks
         if isinstance(c.get("structured_data"), dict)
         for col in c["structured_data"].get("columns", [])]
alltext = "\n".join(c["text"] for c in chunks)
missing = [n for n in names if n not in alltext]   # → 32, all MVT_DAT
```

### 10.6 Nineteen procedures have SQL the app never shows the model

*Corrected 2026-08-19. Earlier versions of this section said these procedures were empty and needed a subject-matter expert. That was wrong on both counts — most of them are complete, and the fix is code.*

`build_context_text` rebuilds context from `structured_data` for `TABLE_SCHEMA` chunks. The `OPERATIONAL_REFERENCE` branch does not:

```python
elif doc_type == "OPERATIONAL_REFERENCE":
    has_operational = True          # APP.py:385-386 — and nothing else
```

It sets a flag and falls through to the raw `text`. So for procedure chunks, everything in `structured_data` — the `validate_before_update` queries, the `update` statements, the numbered steps — is **silently dropped before the prompt is built**.

Measured over the 22 `wms_procedure` chunks under 400 characters:

| | Count |
|---|---:|
| SQL present in `structured_data`, never rendered | **19** |
| Genuinely empty — nothing anywhere | **3** |

The three with nothing are **Cancel the Order**, **Clean Up Temporary Table** and **Cancel the Mission**. Those need someone who knows the procedures.

The other nineteen — including **Reverse Closed GRN**, which carries both a `validate_before_update` SELECT and an UPDATE against `REE_DAT` — need an afternoon of engineering. Render the `OPERATIONAL_REFERENCE` branch the way the schema branch already renders, and nineteen procedures come back.

**Do this before commissioning any content work.** The corpus is substantially richer than the app can currently use.

> Counting by string match misleads here in both directions. Grepping `SQL: N/A` finds nothing; grepping `N/A` finds 11; screening on text length and SQL keywords finds 6. None of those is the number that matters, which is how many have usable content the pipeline discards.

### 10.7 Everything else

- **Hardcoded Windows paths** in `APP.py`, `Help Page.py` and 8 notebooks (§4)
- **Stale vector store** at `APPLICATION(STREAMLIT)/data/vector_store` (§4)
- **`Help Page.py` is a mock** — the support form submits nowhere
- **`ci-cd.yml` and `docs/DEPLOYMENT.md` are fiction** (§7)
- **`07_llm_answer_generation - Copy.ipynb`** is an unreconciled duplicate

---

## 11. Security and compliance

### Rotate the Groq keys

**Three distinct live keys** were committed across five locations and published to `github.com/E-siyanda-matolengwe_MSC/puks-ai`. In this repo they read `gsk_REDACTED_KEY_WAS_ROTATED`, and the original git history was **not** carried over — but redaction here does not revoke them.

**Rotate at `console.groq.com`.** They were public; assume they are compromised.

### This repository must stay private

`DATA/` contains third-party client material and production system internals:

- **19 L'Oréal** operational documents
- **12 Clarins** files
- **18 production WMS table schemas**
- Support ticket resolutions with real customer references

This is MSC/AGL customer data, not project IP. It is not publishable.

### Data residency

Any **new** model deployment needs a deliberate SKU choice. `GlobalStandard` (what the existing `gpt-5` uses) explicitly may route requests outside the EU; `DataZoneStandard` confines inference to EU member states. **The SKU cannot be changed in place** — switching later means recreating the deployment. Decide with whoever owns data residency for this estate before deploying.

### Other

- `ipSecurityRestrictions` is `Allow all` on the public awat002 — no IP allow-listing
- Both storage accounts have `allowSharedKeyAccess: true`
- SQL threat protection is enabled at server scope but **disabled** on both databases

---

## 12. Cost

Standing cost, Azure list prices for West Europe, excluding any AGL enterprise discount:

| Item | Monthly |
|---|---:|
| AI Search S1 | $245.28 |
| 8 private endpoints | $58.40 |
| 2 × App Service B1 Linux | $26.28 |
| Defender for SQL | $15.00 |
| SQL storage | $4.38 |
| Cosmos DB | $0.00 *(no containers provisioned)* |
| Function Apps FC1, AI Foundry S0 | $0.00 |
| **Total** | **~$349** |

> **Verify this before quoting it.** Both B1 plans carry a `freeOfferExpirationTime` that has **already passed** — `ASPT001` on 2026-08-06 and `ASPT002` on 2026-08-08. They were created under a free offer that has now lapsed, so current billing may differ from the $26.28 above, and the plans may have been downgraded. Check with `az appservice plan show` once you have access.

**Waste worth acting on:**

- **AI Search — $245/mo** for a service the current app does not use. At 627 documents an in-process index is viable. Do not switch it off until a replacement is proven.
- **Orphaned private endpoint `ch011agl0c8-agew-aift001-PL` — $7.30/mo** pointing at a search service that does not exist. Safe to delete.
- If the serverless SQL database ever fails to auto-pause, its minimum compute bill is roughly **$282/mo**, which would nearly double the standing cost. Worth an alert.

---

## 13. Where this is going

A rebuild is planned: a Next.js front end replacing Streamlit, retrieval reworked so both search methods cover the full corpus, and generation moved from Groq to the already-provisioned `gpt-5` deployment using managed identity instead of API keys.

Work that needs **no Azure access** and can start immediately:

- Port the retrieval logic and add parity tests against the current behaviour
- Build the evaluation set — there is currently **no ground truth at all**, so no way to prove a change helped
- Fix the hardcoded paths and delete the stale vector store
- Front-end shell against mocked retrieval

Everything touching Azure is gated on the access grant in [§6](#6-the-azure-environment). Request it first; it has the longest lead time.

### Open questions for the environment owner

1. Does AGL run **VNet-resident CI runners**? If so, the private site becomes viable and most deployment complexity disappears.
2. Who owns **data residency** sign-off for this estate?
3. Is there a **real support ticket queue** to draw evaluation questions from? This repo has only two tickets.

---

*Environment facts in this document were read from `main.bicep` (exported 2026-08-18) and verified against the repository. Azure behaviour was verified against Microsoft Learn on 2026-08-19. Anything marked unverified has not been confirmed against a live subscription, because none was reachable at the time of writing.*
