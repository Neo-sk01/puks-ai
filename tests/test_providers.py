"""Per-role provider resolution. puks_rag reads its config at import, so each
case reloads the module under a controlled environment."""
import importlib
import sys

import pytest

_VARS = ["PUKS_PROVIDER", "PUKS_CHAT_PROVIDER", "PUKS_EMBED_PROVIDER", "PUKS_RERANK_PROVIDER",
         "AZURE_AI_KEY", "AZURE_AI_ENDPOINT", "AZURE_RERANK_ENDPOINT",
         "OPENAI_API_KEY", "COHERE_API_KEY"]


@pytest.fixture
def load(monkeypatch):
    """load(**env) -> freshly imported puks_rag with exactly that environment."""
    original = sys.modules.get("puks_rag")

    def _load(**env):
        for v in _VARS:
            monkeypatch.delenv(v, raising=False)
        for k, val in env.items():
            monkeypatch.setenv(k, val)
        monkeypatch.setattr("dotenv.load_dotenv", lambda *a, **k: False)   # ignore .env files
        sys.modules.pop("puks_rag", None)
        return importlib.import_module("puks_rag")
    yield _load
    # Put the ORIGINAL module object back. Other test modules and api.main
    # bound it at import time; a fresh import would be a different object
    # and their monkeypatches would land on the wrong one.
    if original is not None:
        sys.modules["puks_rag"] = original
    else:
        sys.modules.pop("puks_rag", None)


def test_azure_everywhere_when_only_azure_is_configured(load):
    p = load(AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://x.openai.azure.com/",
             AZURE_RERANK_ENDPOINT="https://x/rerank")
    assert p.PROVIDERS == {"chat": "azure", "embed": "azure", "rerank": "azure"}


def test_openai_everywhere_when_only_openai_is_configured(load):
    p = load(OPENAI_API_KEY="sk", COHERE_API_KEY="co")
    assert p.PROVIDERS == {"chat": "openai", "embed": "openai", "rerank": "openai"}
    assert p.RERANK_ENDPOINT.startswith("https://api.cohere.com")


def test_stray_openai_key_does_not_redirect_an_azure_box(load):
    p = load(AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://x/", AZURE_RERANK_ENDPOINT="https://x/r",
             OPENAI_API_KEY="sk")
    assert p.PROVIDERS == {"chat": "azure", "embed": "azure", "rerank": "azure"}


def test_roles_can_be_split_across_providers(load):
    """AGL's Foundry deploys gpt-5 only: chat stays in the tenant, embeddings
    and rerank go public."""
    p = load(PUKS_PROVIDER="azure", PUKS_EMBED_PROVIDER="openai",
             AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://x/",
             OPENAI_API_KEY="sk", COHERE_API_KEY="co")
    assert p.PROVIDERS == {"chat": "azure", "embed": "openai", "rerank": "openai"}
    assert p.CHAT_DEPLOYMENT == "gpt-5"
    assert p.EMBED_DEPLOYMENT == "text-embedding-3-large" and p.EMBED_DIMENSIONS == 3072


def test_rerank_falls_back_to_public_cohere_when_azure_has_no_rerank_route(load):
    p = load(PUKS_PROVIDER="azure", AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://x/", COHERE_API_KEY="co")
    assert p.RERANK_PROVIDER == "openai"
    assert p.RERANK_KEY == "co"


def test_rerank_stays_on_azure_when_pinned(load):
    p = load(PUKS_PROVIDER="azure", PUKS_RERANK_PROVIDER="azure",
             AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://x/", COHERE_API_KEY="co")
    assert p.RERANK_PROVIDER == "azure"
    assert p.RERANK_ENDPOINT == ""      # unset → reranking skipped, UI warns


def test_invalid_provider_name_is_rejected(load):
    with pytest.raises(RuntimeError):
        load(PUKS_PROVIDER="bedrock")


def test_get_client_builds_one_client_per_provider(load):
    p = load(PUKS_PROVIDER="azure", PUKS_EMBED_PROVIDER="openai",
             AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://x.openai.azure.com/", OPENAI_API_KEY="sk")
    chat, embed = p.get_client("chat"), p.get_client("embed")
    assert type(chat).__name__ == "AzureOpenAI"
    assert type(embed).__name__ == "OpenAI"
    assert p.get_client("chat") is chat
