"""Azure Functions entry point for the FastAPI backend.

Wraps the existing ASGI app (api/main.py) rather than reimplementing it as
Functions bindings — the routes, request/response models and lifespan all
stay exactly as they are for local `uvicorn api.main:app` development.
Anonymous auth: this Function App sits behind VNet integration / a private
endpoint, not a function-key gate (see web/lib/server.ts, which calls it
with a plain fetch, no x-functions-key header).
"""

import azure.functions as func

from api.main import app as fastapi_app

app = func.AsgiFunctionApp(app=fastapi_app, http_auth_level=func.AuthLevel.ANONYMOUS)
