# Deploying Puks AI to Azure

The runbook for the deployment that is actually live, first stood up 2026-09-01.
It supersedes `docs/DEPLOYMENT.md` (a greenfield `rg-puks-ai` that was never
built) and `.github/workflows/ci-cd.yml` (targets sites that do not exist).
Section 7 of `ENVIRONMENT.local.md` describes an earlier Streamlit-on-App-Service
plan that was overtaken; the environment facts in its section 6 remain accurate.

## What is running

```
  staff browser
       |  https
  CH011AGL0C8-AGEW-AWAT002     Next.js 16, NODE|22-lts, B1 (ASPT002), public
       |  server-side proxy (web/lib/proxy.ts -> FASTAPI_URL)
  CH011AGL0C8-AGEW-AFUT001     FastAPI on Functions, Python 3.13 Flex, private
       |  key auth
  CH011AGL0C8-AGEW-AIFT003     gpt-5 . text-embedding-3-large . Cohere-rerank-v4.0-pro
```

**https://ch011agl0c8-agew-awat002.azurewebsites.net** — the only URL staff need.

Retrieval runs against the FAISS index committed at `DATA/vector_store/`
(627 vectors, 3072-dim). There is no Azure AI Search index, no Cosmos and no Blob
dependency. `asst001` is idle and its hostname does not resolve from either app.

The browser never talks to the Function App. `AFUT001` is `publicNetworkAccess:
Disabled`; only `AWAT002`'s server-side proxy reaches it, over the private
endpoint. That is why the Function App runs `AuthLevel.ANONYMOUS` — the network
is the boundary. **If `AFUT001` is ever made public, switch to
`func.AuthLevel.FUNCTION` and have `web/lib/proxy.ts` send the key.**

## Prerequisites

```bash
# Browser flow. Device code is refused by Conditional Access in this tenant.
az login --tenant 088e9b00-ffd0-458e-bfa1-acf4c596d3cb
az account set -s f700ffcf-f34a-462a-9876-234f445307d0   # default lands elsewhere
```

`az` on the AGL VM defaults to the machine's managed identity. Check with
`az account show --query user.name` — if that says `systemAssignedIdentity`, the
login above has not happened and everything below will fail.

## Deploying the backend to AFUT001

```bash
RG=CH011AGL0C8-AGEW-RGRT001
FA=CH011AGL0C8-AGEW-AFUT001

# Artifact (~6.8 MB): function_app.py, host.json, requirements.txt, puks_rag.py,
#   api/, DATA/vector_store/, DATA/unified_semantic_chunks/, docs/acceptance-*.json
az functionapp deployment source config-zip -g $RG -n $FA --src backend.zip

curl -s https://ch011agl0c8-agew-afut001-enfzgufmg3c5b8bb.westeurope-01.azurewebsites.net/health
# {"ready":true,"mock":false,"index":{"dimension":3072,"ntotal":627}, ...}
```

`function_app.py` wraps `api.main:app` with `func.AsgiFunctionApp`. `host.json`
sets `routePrefix: ""` so URLs map 1:1 onto the existing FastAPI routes instead
of being nested under a second `/api` segment.

`config-zip` works despite the private endpoint: the SCM site answers 401 and
`az` authenticates with an Entra token. Basic auth being disabled does not block
this, contrary to how it looks.

## Deploying the front end to AWAT002

**Build locally. Do not let Oryx build.** `next build` on the B1 plan ran for
over twelve minutes and failed. The same build takes about 80 seconds locally.

```bash
cd web
npm install                 # see "pnpm cannot run here" below
npm run build               # next.config.ts sets output: "standalone"

# All three parts are required:
mkdir -p ../dist-web
cp -r .next/standalone/.  ../dist-web/
cp -r .next/static        ../dist-web/.next/static
cp -r public              ../dist-web/public

cd .. && zip -qr web.zip dist-web/     # ~9 MB, ~1450 files
az webapp deploy -g $RG -n ch011agl0c8-agew-awat002 --src-path web.zip --type zip
```

Omitting `.next/static` gives a page that loads with no styling. Omitting
`public/` loses the icons. Neither failure reports an error.

## Configuration

Secrets are read straight from `listKeys` and never printed:

```bash
AI_KEY=$(az cognitiveservices account keys list -g $RG \
           -n CH011AGL0C8-AGEW-AIFT003 --query key1 -o tsv)
```

**AFUT001** holds `PUKS_PROVIDER`, `AZURE_AI_KEY`, `AZURE_AI_ENDPOINT`,
`AZURE_AI_API_VERSION`, `AZURE_CHAT_DEPLOYMENT`, `AZURE_EMBED_DEPLOYMENT`,
`AZURE_EMBED_DIMENSIONS`, `AZURE_RERANK_ENDPOINT`, `AZURE_RERANK_MODEL`,
`AZURE_RERANK_KEY`, `PUKS_REASONING_EFFORT`, `PUKS_VERBOSITY`,
`PUKS_MAX_OUTPUT_TOKENS`, and `PUKS_ACCEPTANCE_DB=/tmp/acceptance.db` — the
Functions filesystem is read-only, so the acceptance store must live in `/tmp`.

**AWAT002** holds only `FASTAPI_URL`, `HOSTNAME=0.0.0.0`,
`ENABLE_ORYX_BUILD=false` and `SCM_DO_BUILD_DURING_DEPLOYMENT=false`. Startup
command `node server.js`, Always On enabled. **No Foundry credentials live on
this site** — they were removed when the backend moved off it.

## Traps

Every one of these cost time on the first deployment.

**The CLI misreports deployments.** `az webapp deploy` hangs past its own timeout
or returns 502 while the deployment is still running, and `az functionapp
deployment source config-zip` can report success before the app is warm. Poll ARM:

```bash
az rest --method get \
  --url ".../sites/$APP/deployments?api-version=2023-12-01" \
  --query "value[0].properties.status"      # 1=building 3=failed 4=success
```

**Restart the site after changing `linuxFxVersion`.** Switching Python to Node
left Kudu running `oryx build --platform python --platform-version 3.11` against
a Next.js app, failing with "Couldn't detect a version for the platform 'python'".

**`SCM_DO_BUILD_DURING_DEPLOYMENT=false` does not stop Oryx.** It still ran
`npm install`. `ENABLE_ORYX_BUILD=false` is the setting that works.

**`web/node_modules` from the distributed zip is unusable.** Every top-level
package link, `node_modules/next` included, is a 0-byte file: pnpm's symlinks do
not survive a macOS zip extracted on Windows. Delete the directory and reinstall.
The same zip damaged the accented `DATA/.../LOREAL/` filenames.

**pnpm cannot run on the AGL VM.** The repo pins `pnpm@9.15.9`, but the Node on
PATH lives under another user's profile and `corepack` fails with `EPERM`. The
live bundle was therefore built with `npm install` rather than
`pnpm install --frozen-lockfile`, so deployed dependency versions may drift from
the committed lockfile. Rebuild on a machine with working pnpm when one exists.

## Verifying

```bash
U=https://ch011agl0c8-agew-awat002.azurewebsites.net
curl -s $U/api/config                              # proves the UI reaches the backend
curl -s -X POST $U/api/chat -H 'Content-Type: application/json' \
     -d '{"message":"How do I reverse a GRN?"}'    # proves the whole chain
```

Measured 2026-09-01: the UI recovers from a restart in **6 s**; the Function App
cold-starts to healthy in **5 s**; warm `/health` is **0.06–0.13 s**.

## Known limitations

**SSE is buffered.** `/api/chat` delivers the whole answer at once rather than
token by token — first byte and last byte both arrived at 10.3 s. The Functions
ASGI adapter buffers. Real streaming needs
`azurefunctions-extensions-http-fastapi`, and Microsoft requires *every* HTTP
route in the app to be a streaming route, so `/health` and `/api/answer` would
have to be converted too. That is a rewrite of `api/main.py`, not a flag.

**Roughly one request in three is slow.** With `alwaysReady: null`, Flex
Consumption starts new instances that each reload the index: 5–8 s against
0.06–0.13 s warm. The fix costs one permanently allocated instance:

```bash
az functionapp scale config always-ready set -g $RG -n $FA --settings http=1
```

**The public site is open at the app layer.** `AWAT002` has
`ipSecurityRestrictions: Allow all`. Now that it is staff-facing, confirm with the
environment owner whether it should be restricted to the corporate range.

**Data residency is unresolved.** All three model deployments on `aift003` are
`GlobalStandard`, which may route inference outside the EU. `DataZoneStandard`
confines it to EU member states, but the SKU cannot be changed in place —
switching means recreating the deployments.
