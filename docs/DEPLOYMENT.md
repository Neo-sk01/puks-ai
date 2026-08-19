# Deployment Guide

This guide covers deploying Puks AI to various environments.

## Table of Contents

- [Local Development](#local-development)
- [Docker Deployment](#docker-deployment)
- [Azure App Service](#azure-app-service)
- [Azure Container Apps](#azure-container-apps)
- [Environment Variables](#environment-variables)

---

## Local Development

### Prerequisites

- Python 3.9+ (3.11 recommended)
- Groq API Key

### Setup

```bash
# Clone repository
git clone https://github.com/yourusername/puks-ai.git
cd puks-ai

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure secrets
mkdir -p .streamlit
echo 'GROQ_API_KEY = "your-api-key"' > .streamlit/secrets.toml

# Run application
cd "APPLICATION(STREAMLIT)"
streamlit run APP.py
```

---

## Docker Deployment

### Build and Run

```bash
# Build image
docker build -t puks-ai:latest .

# Run container
docker run -d \
  --name puks-ai \
  -p 8501:8501 \
  -e GROQ_API_KEY="your-api-key" \
  puks-ai:latest
```

### Using Docker Compose

```bash
# Set environment variable
export GROQ_API_KEY="your-api-key"

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

---

## Azure App Service

### Step 1: Create Resources

```bash
# Login to Azure
az login

# Create resource group
az group create --name rg-puks-ai --location southafricanorth

# Create App Service Plan
az appservice plan create \
  --name asp-puks-ai \
  --resource-group rg-puks-ai \
  --sku B2 \
  --is-linux

# Create Web App
az webapp create \
  --resource-group rg-puks-ai \
  --plan asp-puks-ai \
  --name puks-ai-app \
  --runtime "PYTHON:3.11"
```

### Step 2: Configure Settings

```bash
# Set startup command
az webapp config set \
  --resource-group rg-puks-ai \
  --name puks-ai-app \
  --startup-file "streamlit run APPLICATION(STREAMLIT)/APP.py --server.port 8000 --server.address 0.0.0.0"

# Set environment variables
az webapp config appsettings set \
  --resource-group rg-puks-ai \
  --name puks-ai-app \
  --settings GROQ_API_KEY="your-api-key"
```

### Step 3: Deploy Code

```bash
# Deploy using ZIP
az webapp deployment source config-zip \
  --resource-group rg-puks-ai \
  --name puks-ai-app \
  --src app.zip
```

---

## Azure Container Apps

### Step 1: Create Container App Environment

```bash
# Create Log Analytics workspace
az monitor log-analytics workspace create \
  --resource-group rg-puks-ai \
  --workspace-name law-puks-ai

# Get workspace credentials
LOG_ANALYTICS_WORKSPACE_CLIENT_ID=$(az monitor log-analytics workspace show \
  --resource-group rg-puks-ai \
  --workspace-name law-puks-ai \
  --query customerId -o tsv)

LOG_ANALYTICS_WORKSPACE_CLIENT_SECRET=$(az monitor log-analytics workspace get-shared-keys \
  --resource-group rg-puks-ai \
  --workspace-name law-puks-ai \
  --query primarySharedKey -o tsv)

# Create Container App Environment
az containerapp env create \
  --name cae-puks-ai \
  --resource-group rg-puks-ai \
  --location southafricanorth \
  --logs-workspace-id $LOG_ANALYTICS_WORKSPACE_CLIENT_ID \
  --logs-workspace-key $LOG_ANALYTICS_WORKSPACE_CLIENT_SECRET
```

### Step 2: Create Container Registry

```bash
# Create ACR
az acr create \
  --resource-group rg-puks-ai \
  --name acrpuksai \
  --sku Basic \
  --admin-enabled true

# Login to ACR
az acr login --name acrpuksai

# Build and push image
az acr build \
  --registry acrpuksai \
  --image puks-ai:latest .
```

### Step 3: Deploy Container App

```bash
# Create Container App
az containerapp create \
  --name ca-puks-ai \
  --resource-group rg-puks-ai \
  --environment cae-puks-ai \
  --image acrpuksai.azurecr.io/puks-ai:latest \
  --target-port 8501 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 3 \
  --secrets groq-api-key="your-api-key" \
  --env-vars GROQ_API_KEY=secretref:groq-api-key
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Groq API authentication key |
| `VECTOR_STORE_PATH` | No | Custom path to vector store |
| `CHUNKS_PATH` | No | Custom path to chunks JSON |
| `LOG_LEVEL` | No | Logging level (default: INFO) |

### Production Security

For production deployments, use Azure Key Vault:

```bash
# Create Key Vault
az keyvault create \
  --name kv-puks-ai \
  --resource-group rg-puks-ai \
  --location southafricanorth

# Store secret
az keyvault secret set \
  --vault-name kv-puks-ai \
  --name GROQ-API-KEY \
  --value "your-api-key"

# Reference in App Settings
az webapp config appsettings set \
  --resource-group rg-puks-ai \
  --name puks-ai-app \
  --settings GROQ_API_KEY="@Microsoft.KeyVault(SecretUri=https://kv-puks-ai.vault.azure.net/secrets/GROQ-API-KEY/)"
```

---

## Monitoring

### Application Insights

```bash
# Create Application Insights
az monitor app-insights component create \
  --app ai-puks-ai \
  --location southafricanorth \
  --resource-group rg-puks-ai \
  --application-type web

# Link to Web App
az webapp config appsettings set \
  --resource-group rg-puks-ai \
  --name puks-ai-app \
  --settings APPINSIGHTS_INSTRUMENTATIONKEY="<instrumentation-key>"
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Container fails to start | Check GROQ_API_KEY is set |
| High memory usage | Reduce VECTOR_CANDIDATES |
| Slow responses | Switch to Llama 3.1 8B model |

### Health Check

```bash
# Check container health
curl http://localhost:8501/_stcore/health
```

---

## Rollback

```bash
# List deployments
az webapp deployment list \
  --resource-group rg-puks-ai \
  --name puks-ai-app

# Rollback to previous deployment
az webapp deployment slot swap \
  --resource-group rg-puks-ai \
  --name puks-ai-app \
  --slot staging \
  --target-slot production
```
