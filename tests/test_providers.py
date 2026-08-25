"""Per-role provider resolution. puks_rag reads its config at import, so each
case reloads the module under a controlled environment."""
import importlib
import sys

import pytest

_VARS = ["PUKS_PROVIDER", "PUKS_CHAT_PROVIDER", "PUKS_EMBED_PROVIDER", "PUKS_RERANK_PROVIDER",
         "AZURE_AI_KEY", "AZURE_AI_ENDPOINT", "AZURE_RERANK_ENDPOINT", "AZURE_RERANK_KEY",
         "FOUNDRY_API_ENDPOINT", "FOUNDRY_API_KEY", "COHERE_API_KEY_FOUNDRY",
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
    p = load(PUKS_PROVIDER="azure", PUKS_EMBED_PROVIDER="openai", PUKS_RERANK_PROVIDER="openai",
             AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://x/",
             OPENAI_API_KEY="sk", COHERE_API_KEY="co")
    assert p.PROVIDERS == {"chat": "azure", "embed": "openai", "rerank": "openai"}
    assert p.CHAT_DEPLOYMENT == "gpt-5"
    assert p.EMBED_DEPLOYMENT == "text-embedding-3-large" and p.EMBED_DIMENSIONS == 3072


def test_rerank_falls_back_to_public_cohere_when_pinned_off_azure_route(load):
    """With a Foundry endpoint the Azure rerank route is derived, so the
    public fallback only applies when there is no Azure endpoint at all."""
    p = load(PUKS_PROVIDER="azure", AZURE_AI_KEY="k", COHERE_API_KEY="co")
    assert p.RERANK_PROVIDER == "openai"
    assert p.RERANK_KEY == "co"


def test_foundry_portal_names_are_accepted_as_aliases(load):
    p = load(FOUNDRY_API_ENDPOINT="https://res.services.ai.azure.com/", FOUNDRY_API_KEY="fk",
             COHERE_API_KEY_FOUNDRY="ck", OPENAI_API_KEY="sk", PUKS_EMBED_PROVIDER="openai")
    assert p.AI_ENDPOINT == "https://res.services.ai.azure.com/" and p.AI_KEY == "fk"
    assert p.PROVIDERS == {"chat": "azure", "embed": "openai", "rerank": "azure"}
    assert p.RERANK_ENDPOINT == "https://res.services.ai.azure.com/models/v1/rerank?api-version=2024-05-01-preview"
    assert p.RERANK_KEY == "ck"


def test_rerank_route_is_derived_from_the_openai_host_too(load):
    p = load(AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://res.openai.azure.com/")
    assert p.RERANK_ENDPOINT.startswith("https://res.services.ai.azure.com/models/v1/rerank")
    assert p.RERANK_KEY == "k"


def test_rerank_stays_on_azure_when_pinned(load):
    p = load(PUKS_PROVIDER="azure", PUKS_RERANK_PROVIDER="azure",
             AZURE_AI_KEY="k", COHERE_API_KEY="co")
    assert p.RERANK_PROVIDER == "azure"
    assert p.RERANK_ENDPOINT == ""      # no endpoint → reranking skipped, UI warns


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


def test_confidence_gate_follows_the_reranker(load):
    """v4.0-pro on Foundry scores ~0.5 higher than public v3.5; the gate that
    refuses off-topic questions must move with it."""
    azure = load(AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://res.services.ai.azure.com/")
    assert azure.RERANK_PROVIDER == "azure" and azure.CONFIDENCE_THRESHOLD == 0.75
    public = load(OPENAI_API_KEY="sk", COHERE_API_KEY="co")
    assert public.RERANK_PROVIDER == "openai" and public.CONFIDENCE_THRESHOLD == 0.30
    pinned = load(AZURE_AI_KEY="k", AZURE_AI_ENDPOINT="https://res.services.ai.azure.com/",
                  PUKS_CONFIDENCE_THRESHOLD="0.6")
    assert pinned.CONFIDENCE_THRESHOLD == 0.6
