"""Azure Functions entry point.

The backend is deployed to the Flex Consumption Function App
CH011AGL0C8-AGEW-AFUT001, per the handover architecture. Nothing about the
application changes: api.main:app is the same FastAPI object uvicorn serves
locally, wrapped here so the Functions host can drive it over ASGI.

Auth level is ANONYMOUS because the Function App is `publicNetworkAccess:
Disabled` — the private endpoint is the boundary, and only the front end's
subnet can reach it. If that site is ever made public, switch this to
func.AuthLevel.FUNCTION and have web/lib/proxy.ts send the key.

host.json sets `routePrefix: ""` so URLs map 1:1 onto the FastAPI routes
(/health, /api/config, /api/answer, /api/chat) rather than being nested under
a second /api segment by the Functions host.

Known limitation: SSE on /api/chat is buffered by the ASGI adapter, so the
answer arrives complete rather than token by token. True streaming needs the
azurefunctions-extensions-http-fastapi package, which requires every route in
the app to be a streaming route — a rewrite of api/main.py, not a flag.
"""
import azure.functions as func

from api.main import app as fastapi_app

app = func.AsgiFunctionApp(
    app=fastapi_app,
    http_auth_level=func.AuthLevel.ANONYMOUS,
)
