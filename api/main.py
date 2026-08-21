"""Puks AI HTTP surface.

Stateless by design: the client sends conversation history, the server formats
it with puks_rag.format_memory. That is what allows more than one replica
without a shared session store.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel, Field

import puks_rag
from api.engine import Engine

TOP_K_MIN = 3
TOP_K_MAX = 10


class Message(BaseModel):
    role:    str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[Message] = Field(default_factory=list)
    top_k:   int           = puks_rag.TOP_K_DEFAULT

    def clamped_top_k(self) -> int:
        """The Streamlit slider allowed 3-10; a raw client must not exceed it."""
        return max(TOP_K_MIN, min(TOP_K_MAX, self.top_k))

    def memory_text(self) -> str:
        return puks_rag.format_memory([m.model_dump() for m in self.history])


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = Engine()
        yield

    app = FastAPI(title="Puks AI", lifespan=lifespan)

    @app.get("/health")
    def health() -> dict:
        engine = app.state.engine
        return {
            "ready":             engine.ready,
            "mock":              engine.mock,
            "error":             engine.error,
            "index":             engine.info(),
            "rerank_configured": bool(puks_rag.RERANK_ENDPOINT),
        }

    @app.get("/api/config")
    def config() -> dict:
        return {
            "chat_deployment":     puks_rag.CHAT_DEPLOYMENT,
            "embed_deployment":    puks_rag.EMBED_DEPLOYMENT,
            "rerank_model":        puks_rag.RERANK_MODEL,
            "top_k_default":       puks_rag.TOP_K_DEFAULT,
            "top_k_min":           TOP_K_MIN,
            "top_k_max":           TOP_K_MAX,
            "confidence_threshold": puks_rag.CONFIDENCE_THRESHOLD,
            "rerank_configured":   bool(puks_rag.RERANK_ENDPOINT),
            "mock":                app.state.engine.mock,
        }

    return app


app = create_app()
