"""Puks AI HTTP surface.

Stateless by design: the client sends conversation history, the server formats
it with puks_rag.format_memory. That is what allows more than one replica
without a shared session store.
"""
from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import puks_rag
from api.acceptance import router as acceptance_router
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


def sse(event: str, data: dict) -> str:
    """One server-sent event. Named events, JSON payloads, blank-line terminated."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = Engine()
        yield

    app = FastAPI(title="Puks AI", lifespan=lifespan)
    app.include_router(acceptance_router)

    @app.get("/health")
    def health() -> dict:
        engine = app.state.engine
        return {
            "ready":             engine.ready,
            "mock":              engine.mock,
            "error":             engine.error,
            "index":             engine.info(),
            "rerank_configured": bool(puks_rag.RERANK_ENDPOINT),
            "provider":          puks_rag.PROVIDER,
            "providers":         puks_rag.PROVIDERS,
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
            "provider":            puks_rag.PROVIDER,
            "providers":           puks_rag.PROVIDERS,
        }

    def _require_ready() -> None:
        engine = app.state.engine
        if not engine.ready:
            raise HTTPException(status_code=503, detail=engine.error or "Engine not ready")

    @app.post("/api/answer")
    def api_answer(request: ChatRequest) -> dict:
        _require_ready()
        result = app.state.engine.answer(
            request.message,
            memory_text=request.memory_text(),
            top_k=request.clamped_top_k(),
        )
        # puks_rag.answer() returns raw chunks including structured_data, which
        # is not uniformly shaped and never goes over the wire. answer_stream()
        # already projects; this route must match it so both endpoints agree.
        return {**result, "retrieved": [puks_rag.wire_chunk(c) for c in result["retrieved"]]}

    @app.post("/api/chat")
    def api_chat(request: ChatRequest) -> StreamingResponse:
        _require_ready()
        engine  = app.state.engine
        started = time.perf_counter()

        def events():
            try:
                for name, payload in engine.answer_stream(
                    request.message,
                    memory_text=request.memory_text(),
                    top_k=request.clamped_top_k(),
                ):
                    if name == "done":
                        payload = {**payload,
                                   "elapsed_ms": round((time.perf_counter() - started) * 1000)}
                    yield sse(name, payload)
            except Exception as exc:  # noqa: BLE001 — a dead socket tells the UI nothing
                yield sse("error", {"message": str(exc)})

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control":     "no-cache",
                "Connection":        "keep-alive",
                "X-Accel-Buffering": "no",   # nginx / App Service must not buffer the stream
            },
        )

    return app


app = create_app()
