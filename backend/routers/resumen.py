"""
routers/resumen.py — POST /api/resumen
Recibe JSON con los resultados ya procesados de nómina, rotación y liquidaciones
(no un Excel). Normaliza nombres de empresa con IA, genera narrativa ejecutiva
por empresa con Claude y devuelve kpis consolidados + narrativas.
"""

import json
import os
import re
from typing import Any

import anthropic
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

router = APIRouter()

# ─── Empresas canónicas del holding (del original 5_Resumen_Ejecutivo.py) ─────
EMPRESAS_TEXO = [
    "BRICK", "NASTA", "LUPE", "OMD", "ROGER",
    "TAC MEDIA", "BPR", "AMPLIFY", "TEXO", "ROW",
]


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIONES CLAUDE
# (copiadas de /streamlit/pages/5_Resumen_Ejecutivo.py — lógica sin modificar)
# ══════════════════════════════════════════════════════════════════════════════

def normalizar_empresas_ia(nombres: tuple) -> dict:
    lista  = "\n".join(f"- {n}" for n in nombres)
    canon  = "\n".join(f"- {e}" for e in EMPRESAS_TEXO)
    prompt = f"""Tenés una lista de nombres de empresas del holding Texo que pueden tener variaciones de escritura.
Mapeá cada nombre a su nombre canónico de la lista provista. Si no matchea claramente, usá "OTROS".

NOMBRES CANÓNICOS:
{canon}

NOMBRES A MAPEAR:
{lista}

Respondé ÚNICAMENTE con un JSON válido. Clave = nombre original, valor = nombre canónico."""
    try:
        r = client.messages.create(
            model="claude-sonnet-4-20250514", max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )
        texto = re.sub(r"```json|```", "", r.content[0].text.strip()).strip()
        return json.loads(texto)
    except Exception:
        return {n: n for n in nombres}


def insight_empresa_ia(data_json: str, empresa: str) -> str:
    prompt = f"""Sos un consultor de RRHH analizando datos del holding Texo (empresas publicitarias en Paraguay).
Estos son los indicadores clave de la empresa {empresa}:

{data_json}

En máximo 3 oraciones directas y ejecutivas, describí:
- Riesgo de rotación y su costo
- Una recomendación concreta

Sin markdown, sin bullets, solo texto ejecutivo."""
    try:
        r = client.messages.create(
            model="claude-sonnet-4-20250514", max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        return r.content[0].text.strip()
    except Exception as e:
        print(f"[resumen] insight_empresa_ia ERROR para {empresa}: {e}")
        return f"[Error IA: {type(e).__name__}]"


# ══════════════════════════════════════════════════════════════════════════════
# MODELO DE REQUEST
# ══════════════════════════════════════════════════════════════════════════════

class ResumenRequest(BaseModel):
    nomina:         dict[str, Any] | None = None   # output de POST /api/nomina
    rotacion:       dict[str, Any] | None = None   # output de POST /api/rotacion
    liquidaciones:  dict[str, Any] | None = None   # output de POST /api/costos
    reclutamiento:  dict[str, Any] | None = None   # output de POST /api/reclutamiento


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _recolectar_nombres(payload: ResumenRequest) -> set[str]:
    """Extrae todos los nombres de empresa encontrados en los tres datasets."""
    nombres: set[str] = set()

    if payload.nomina:
        por_emp = payload.nomina.get("kpis", {}).get("por_empresa", {})
        nombres.update(str(k) for k in por_emp.keys())

    if payload.rotacion:
        for row in payload.rotacion.get("por_empresa", {}).get("salidas", []):
            if v := row.get("EMPRESA"):
                nombres.add(str(v))
        for row in payload.rotacion.get("por_empresa", {}).get("tasa_anual", []):
            if v := row.get("empresa"):
                nombres.add(str(v))

    if payload.liquidaciones:
        for row in payload.liquidaciones.get("por_agencia", {}).get("sobrecosto_total", []):
            if v := row.get("AGENCIA"):
                nombres.add(str(v))
        for row in payload.liquidaciones.get("por_agencia", {}).get("cantidad", []):
            if v := row.get("AGENCIA"):
                nombres.add(str(v))

    return {n for n in nombres if n.upper() not in {"NAN", "NONE", ""}}


def _metricas_empresa(empresa_canon: str, mapa_inv: dict, payload: ResumenRequest) -> dict:
    """
    Construye el dict de métricas para una empresa canónica.
    mapa_inv: {nombre_canon -> lista de nombres originales en los datos}
    """
    # Buscar variantes del nombre canónico en los datos originales
    variantes = mapa_inv.get(empresa_canon, [empresa_canon])

    m: dict[str, Any] = {"empresa": empresa_canon}

    # ── Nómina ────────────────────────────────────────────────────────────────
    if payload.nomina:
        por_emp = payload.nomina.get("kpis", {}).get("por_empresa", {})
        hc = sum(v for k, v in por_emp.items() if k in variantes)
        if hc:
            m["colaboradores_activos"] = hc

        nom_kpis = payload.nomina.get("kpis", {})
        if "lider_pct" in nom_kpis:
            m["lider_pct_holding"] = nom_kpis["lider_pct"]

    # ── Rotación ──────────────────────────────────────────────────────────────
    if payload.rotacion:
        # Salidas
        for row in payload.rotacion.get("por_empresa", {}).get("salidas", []):
            if row.get("EMPRESA") in variantes:
                m["salidas_total"] = row.get("salidas")
                break

        # Tasa anual por empresa
        for row in payload.rotacion.get("por_empresa", {}).get("tasa_anual", []):
            if row.get("empresa") in variantes:
                m["tasa_rotacion"] = row.get("tasa_anual")
                break

        # Permanencia promedio
        for row in payload.rotacion.get("por_empresa", {}).get("permanencia", []):
            if row.get("EMPRESA") in variantes:
                m["permanencia_prom_meses"] = row.get("meses_promedio")
                break

        # KPIs globales de referencia
        rot_kpis = payload.rotacion.get("kpis", {})
        if "tasa_anual" in rot_kpis:
            m["tasa_rotacion_holding"] = rot_kpis["tasa_anual"]

    # ── Liquidaciones ─────────────────────────────────────────────────────────
    if payload.liquidaciones:
        for row in payload.liquidaciones.get("por_agencia", {}).get("sobrecosto_total", []):
            if row.get("AGENCIA") in variantes:
                m["sobrecosto"]  = row.get("SOBRECOSTO")
                m["total_costo"] = row.get("TOTAL_COSTO")
                break

        for row in payload.liquidaciones.get("por_agencia", {}).get("cantidad", []):
            if row.get("AGENCIA") in variantes:
                m["liquidaciones"] = row.get("cantidad")
                break

    return m


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

@router.post("")
async def procesar_resumen(payload: ResumenRequest):

    # ── Validar que llegó al menos un dataset ─────────────────────────────────
    if not any([payload.nomina, payload.rotacion, payload.liquidaciones]):
        raise HTTPException(
            status_code=422,
            detail="Se requiere al menos un dataset: nomina, rotacion o liquidaciones."
        )

    modulos_faltantes = [
        m for m, d in [
            ("nómina",         payload.nomina),
            ("rotación",       payload.rotacion),
            ("liquidaciones",  payload.liquidaciones),
            ("reclutamiento",  payload.reclutamiento),
        ] if d is None
    ]

    # ── Recolectar nombres de empresa y normalizar con IA ─────────────────────
    nombres_raw = _recolectar_nombres(payload)
    if not nombres_raw:
        raise HTTPException(status_code=422, detail="No se encontraron nombres de empresa en los datos.")

    mapa_empresas = normalizar_empresas_ia(tuple(sorted(nombres_raw)))
    # mapa_empresas: {nombre_original → nombre_canónico}

    # Invertir el mapa: {nombre_canónico → [nombres_originales]}
    mapa_inv: dict[str, list[str]] = {}
    for orig, canon in mapa_empresas.items():
        mapa_inv.setdefault(canon, []).append(orig)

    empresas_disp = sorted([
        e for e in mapa_inv.keys()
        if e not in ("OTROS", "NAN", "")
    ])

    if not empresas_disp:
        raise HTTPException(status_code=422, detail="No se pudieron identificar empresas canónicas.")

    # ── Generar métricas y narrativa por empresa ───────────────────────────────
    narrativas:   dict[str, str]  = {}
    metricas_emp: dict[str, dict] = {}

    for empresa in empresas_disp:
        m = _metricas_empresa(empresa, mapa_inv, payload)
        metricas_emp[empresa] = m

        # Serializar solo los campos numéricos/de texto relevantes para Claude
        datos_ia = {k: v for k, v in m.items() if k != "empresa" and v is not None}
        narrativas[empresa] = insight_empresa_ia(
            json.dumps(datos_ia, ensure_ascii=False, indent=2),
            empresa,
        )

    # ── KPIs consolidados ─────────────────────────────────────────────────────
    kpis_consolidados: dict[str, Any] = {}

    if payload.nomina:
        kpis_consolidados["total_colaboradores"] = payload.nomina.get("kpis", {}).get("total")
        kpis_consolidados["empresas_activas"]    = payload.nomina.get("kpis", {}).get("empresas")
        kpis_consolidados["pct_mujeres"]         = payload.nomina.get("kpis", {}).get("pct_mujeres")
        kpis_consolidados["lider_pct"]           = payload.nomina.get("kpis", {}).get("lider_pct")

    if payload.rotacion:
        kpis_consolidados["tasa_rotacion_anual"] = payload.rotacion.get("kpis", {}).get("tasa_anual")
        kpis_consolidados["salidas_totales"]     = payload.rotacion.get("kpis", {}).get("salidas_totales")
        kpis_consolidados["permanencia_prom"]    = payload.rotacion.get("kpis", {}).get("permanencia_prom_meses")

    if payload.liquidaciones:
        kpis_consolidados["sobrecosto_total"] = payload.liquidaciones.get("kpis", {}).get("sobrecosto")
        kpis_consolidados["costo_total"]      = payload.liquidaciones.get("kpis", {}).get("total_costo")
        kpis_consolidados["liquidaciones"]    = payload.liquidaciones.get("kpis", {}).get("total_liquidaciones")

    # ── Respuesta ─────────────────────────────────────────────────────────────
    result = {
        "narrativas":        narrativas,
        "kpis_consolidados": kpis_consolidados,
        "metricas_empresa":  metricas_emp,
        "empresas":          empresas_disp,
        "modulos_faltantes": modulos_faltantes,
        "mapa_empresas":     mapa_empresas,
    }
    return JSONResponse(content=jsonable_encoder(result))
