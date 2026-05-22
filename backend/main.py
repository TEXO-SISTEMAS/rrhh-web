import gc
import logging
import traceback

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
from dotenv import load_dotenv

logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(
    title="RRHH Texo API",
    version="1.0.0",
    description="Backend API para el Portal de RRHH de Texo",
)

# ─── CORS ──────────────────────────────────────────────────────────────────────
_allowed_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://rrhh-web.vercel.app",
    os.getenv("FRONTEND_URL", ""),
]
_allowed_origins = [o for o in _allowed_origins if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https://rrhh-web.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────────────────────────────
from routers import nomina, rotacion, reclutamiento, costos, resumen, respuestas as respuestas_router, auth as auth_router, cache as cache_router
from services.auth import verify_token
from fastapi import Depends

app.include_router(auth_router.router,         prefix="/auth",                tags=["auth"])
app.include_router(nomina.router,              prefix="/api/nomina",          tags=["nomina"],        dependencies=[Depends(verify_token)])
app.include_router(rotacion.router,            prefix="/api/rotacion",        tags=["rotacion"],      dependencies=[Depends(verify_token)])
app.include_router(reclutamiento.router,       prefix="/api/reclutamiento",   tags=["reclutamiento"], dependencies=[Depends(verify_token)])
app.include_router(costos.router,              prefix="/api/costos",          tags=["costos"],        dependencies=[Depends(verify_token)])
app.include_router(resumen.router,             prefix="/api/resumen",         tags=["resumen"],       dependencies=[Depends(verify_token)])
app.include_router(respuestas_router.router,   prefix="/api/respuestas",      tags=["respuestas"],    dependencies=[Depends(verify_token)])
app.include_router(cache_router.router,        prefix="/api/cache",           tags=["cache"])


def _cors_headers(request: Request) -> dict:
    origin = request.headers.get("origin", "*")
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """HTTPException con CORS headers para que el browser no los bloquee."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=_cors_headers(request),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Excepción genérica con CORS headers."""
    logger.error("Unhandled exception on %s %s\n%s", request.method, request.url, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Error interno del servidor. Intentá de nuevo o contactá soporte."},
        headers=_cors_headers(request),
    )


@app.on_event("startup")
async def startup_check():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "")
    if url and key:
        print(f"[startup] SUPABASE_URL={url[:40]}... KEY={'set' if key else 'MISSING'}", flush=True)
        try:
            from services.data_cache import _get_client
            c = _get_client()
            c.table("dashboard_cache").select("username").limit(1).execute()
            print("[startup] Supabase OK — conexion exitosa", flush=True)
        except Exception as exc:
            print(f"[startup] Supabase ERROR: {exc}", flush=True)
    else:
        print("[startup] SUPABASE_URL/KEY no configuradas — usando memoria", flush=True)


@app.get("/")
def health_check():
    gc.collect()
    url = os.getenv("SUPABASE_URL", "")
    return {"status": "ok", "app": "RRHH Texo API", "supabase": bool(url)}


