"""
routers/respuestas.py — POST /api/respuestas
Procesa el archivo de Respuestas de Entrevista de Salida (formulario Google/Excel).
Estructura fija: 26 columnas — metadata (8), preguntas numéricas (8), abierto+sí/no (4), score, email, cédula, búsqueda, motivo_sec, otros.
"""

import io
import json
import os
import re

import anthropic
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from services.utils import validar_excel

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

router = APIRouter()

PREGUNTA_LABELS = [
    "1. Orientación en el cargo",
    "2. Capacitación / Entrenamiento",
    "3. Oportunidad de crecimiento",
    "4. Infraestructura adecuada",
    "5. Ambiente laboral",
    "6. Actitud del supervisor",
    "7. Apoyo del superior inmediato",
    "8. Apertura a sugerencias",
]


def analizar_texto_abierto(textos: list, tipo: str) -> dict:
    """Claude lee cada respuesta individualmente, identifica temas y cuenta personas exactas."""
    limpios = [
        str(t).strip() for t in textos
        if t and str(t).strip() and str(t).strip().lower() not in ("nan", "ninguno", "nada", "-", "n/a", "none", "")
    ]
    total = len(limpios)
    if not limpios:
        return {"temas": [], "total": 0, "narrativa": None}

    tipo_label = (
        "aspectos que mejorarían o razones por las que decidieron irse"
        if tipo == "mejorar"
        else "aspectos que más valoraron o les gustaron de trabajar en la empresa"
    )
    numeradas = "\n".join(f'{i + 1}. "{t}"' for i, t in enumerate(limpios[:80]))

    prompt = f"""Tenés {total} respuestas abiertas de empleados del holding Texo (Paraguay) sobre {tipo_label}.
Cada respuesta está numerada.

RESPUESTAS:
{numeradas}

INSTRUCCIONES:
1. Identificá entre 5 y 8 temas principales que aparecen. Sé concreto, usa lenguaje de RRHH.
2. Para cada tema, revisá UNA POR UNA las {total} respuestas y contá exactamente cuántas personas lo mencionan (una persona puede contar en más de un tema).
3. Calculá el porcentaje: personas_que_mencionan / {total} × 100, redondeado a 1 decimal.
4. Ordená de mayor a menor porcentaje.
5. Escribí una narrativa ejecutiva breve (máx 80 palabras).

Respondé ÚNICAMENTE con JSON válido (sin markdown, sin texto extra):
{{"total": {total}, "temas": [{{"tema": "nombre", "personas": N, "pct": porcentaje}}, ...], "narrativa": "..."}}"""

    try:
        response = client.messages.create(
            model="claude-sonnet-5", max_tokens=1200,
            messages=[{"role": "user", "content": prompt}]
        )
        texto = re.sub(r"```json|```", "", response.content[0].text.strip()).strip()
        data = json.loads(texto)
        data["total"] = total
        return data
    except Exception:
        return {"temas": [], "total": total, "narrativa": None}


def _safe_records(df: pd.DataFrame) -> list:
    for col in df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
        df[col] = df[col].dt.strftime("%Y-%m-%d").where(df[col].notna(), other=None)
    records = []
    for row in df.to_dict(orient="records"):
        clean = {}
        for k, v in row.items():
            if isinstance(v, float) and np.isnan(v):
                clean[k] = None
            elif isinstance(v, np.integer):
                clean[k] = int(v)
            elif isinstance(v, np.floating):
                clean[k] = None if np.isnan(v) else float(v)
            else:
                clean[k] = v
        records.append(clean)
    return records


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if np.isnan(f) else round(f, 2)
    except Exception:
        return None


@router.post("")
async def procesar_respuestas(file: UploadFile = File(...)):
    contents = await validar_excel(file)

    try:
        xl = pd.ExcelFile(io.BytesIO(contents))
        df = pd.read_excel(xl, sheet_name=xl.sheet_names[0])
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo Excel.")

    if df.empty or len(df.columns) < 10:
        raise HTTPException(status_code=422, detail="El archivo no tiene el formato esperado de Respuestas de Entrevista.")

    cols = list(df.columns)

    # Mapeo posicional — el formulario siempre tiene la misma estructura
    rename: dict[str, str] = {}
    if len(cols) > 0:  rename[cols[0]]  = "TIMESTAMP"
    if len(cols) > 1:  rename[cols[1]]  = "NOMBRE"
    if len(cols) > 2:  rename[cols[2]]  = "EMPRESA"
    if len(cols) > 3:  rename[cols[3]]  = "CARGO"
    if len(cols) > 4:  rename[cols[4]]  = "DEPARTAMENTO"
    if len(cols) > 5:  rename[cols[5]]  = "FECHA_INGRESO"
    if len(cols) > 6:  rename[cols[6]]  = "FECHA_SALIDA"
    if len(cols) > 7:  rename[cols[7]]  = "MOTIVO_PRINCIPAL"
    for i in range(8):
        if len(cols) > 8 + i:
            rename[cols[8 + i]] = f"P{i + 1}"
    if len(cols) > 16: rename[cols[16]] = "GUSTO"
    if len(cols) > 17: rename[cols[17]] = "MEJORAR"
    if len(cols) > 18: rename[cols[18]] = "VOLVERIA"
    if len(cols) > 19: rename[cols[19]] = "RECOMIENDA"
    if len(cols) > 20: rename[cols[20]] = "PUNTUACION"
    if len(cols) > 24: rename[cols[24]] = "MOTIVO_SEC"
    if len(cols) > 25: rename[cols[25]] = "OTROS_MOTIVOS"

    df = df.rename(columns=rename)

    # Limpiar filas sin empresa
    if "EMPRESA" in df.columns:
        df = df[df["EMPRESA"].notna() & (df["EMPRESA"].astype(str).str.strip() != "")].copy()

    total = len(df)
    if total == 0:
        raise HTTPException(status_code=422, detail="No se encontraron respuestas válidas en el archivo.")

    # Convertir preguntas a numérico
    p_cols = [f"P{i + 1}" for i in range(8) if f"P{i + 1}" in df.columns]
    for p in p_cols:
        df[p] = pd.to_numeric(df[p], errors="coerce")

    # ── KPIs ──────────────────────────────────────────────────────────────────
    avg_scores: dict[str, float] = {}
    for i, p in enumerate(p_cols):
        val = _safe_float(df[p].mean())
        if val is not None and i < len(PREGUNTA_LABELS):
            avg_scores[PREGUNTA_LABELS[i]] = val

    satisfaccion_promedio = round(sum(avg_scores.values()) / len(avg_scores), 2) if avg_scores else None

    pct_volveria = pct_recomienda = None
    if "VOLVERIA" in df.columns:
        si = df["VOLVERIA"].dropna().astype(str).str.strip().str.upper().str.startswith("S").sum()
        pct_volveria = round(int(si) / total * 100, 1)
    if "RECOMIENDA" in df.columns:
        si = df["RECOMIENDA"].dropna().astype(str).str.strip().str.upper().str.startswith("S").sum()
        pct_recomienda = round(int(si) / total * 100, 1)

    kpis = {
        "total_respuestas":      total,
        "satisfaccion_promedio": satisfaccion_promedio,
        "pct_volveria":          pct_volveria,
        "pct_recomienda":        pct_recomienda,
    }

    # ── Promedio por dimensión ─────────────────────────────────────────────────
    dimensiones = [{"dimension": label, "promedio": avg} for label, avg in avg_scores.items()]

    # ── Por empresa: promedio general ─────────────────────────────────────────
    por_empresa: list = []
    if "EMPRESA" in df.columns and p_cols:
        emp_g = df.groupby("EMPRESA")[p_cols].mean()
        emp_g["promedio_general"] = emp_g.mean(axis=1).round(2)
        por_empresa = _safe_records(emp_g[["promedio_general"]].reset_index())

    # ── Por empresa × dimensión ────────────────────────────────────────────────
    por_empresa_dimension: list = []
    if "EMPRESA" in df.columns and p_cols:
        emp_df = df.groupby("EMPRESA")[p_cols].mean().reset_index()
        for _, row in emp_df.iterrows():
            for i, p in enumerate(p_cols):
                if i < len(PREGUNTA_LABELS):
                    por_empresa_dimension.append({
                        "empresa":   row["EMPRESA"],
                        "dimension": PREGUNTA_LABELS[i],
                        "promedio":  _safe_float(row[p]),
                    })

    # ── Motivos de salida — explotar multi-selección separada por coma ────────
    motivos: list = []
    motivo_cols = [c for c in ["MOTIVO_PRINCIPAL", "MOTIVO_SEC", "OTROS_MOTIVOS"] if c in df.columns]
    if motivo_cols:
        todas = (
            pd.concat([df[c].dropna() for c in motivo_cols])
            .astype(str)
            .str.strip()
        )
        # Cada celda puede tener varias opciones separadas por ", "
        todas_exp = todas.str.split(r",\s*").explode().str.strip()
        todas_exp = todas_exp[todas_exp.str.len() > 0]
        mc = todas_exp.value_counts().reset_index()
        mc.columns = ["motivo", "cantidad"]
        motivos = _safe_records(mc)

    # ── % Volvería por empresa ─────────────────────────────────────────────────
    volveria_emp: list = []
    if "EMPRESA" in df.columns and "VOLVERIA" in df.columns:
        df["_SI"] = df["VOLVERIA"].dropna().astype(str).str.strip().str.upper().str.startswith("S").astype(int)
        v = df.groupby("EMPRESA").agg(si=("_SI", "sum"), total=("_SI", "count")).reset_index()
        v["pct"] = (v["si"] / v["total"] * 100).round(1)
        volveria_emp = _safe_records(v)

    # ── Tabla individual (sin email ni cédula) ────────────────────────────────
    tabla_cols = [c for c in [
        "NOMBRE", "EMPRESA", "CARGO", "DEPARTAMENTO",
        "MOTIVO_PRINCIPAL", "MOTIVO_SEC",
        "VOLVERIA", "RECOMIENDA",
        *p_cols,
        "GUSTO", "MEJORAR",
    ] if c in df.columns]
    tabla = _safe_records(df[tabla_cols].copy())

    # ── Análisis IA de respuestas abiertas ────────────────────────────────────
    gusto_textos   = df["GUSTO"].dropna().astype(str).tolist()   if "GUSTO"   in df.columns else []
    mejorar_textos = df["MEJORAR"].dropna().astype(str).tolist() if "MEJORAR" in df.columns else []

    analisis_gusto   = analizar_texto_abierto(gusto_textos,   "gusto")
    analisis_mejorar = analizar_texto_abierto(mejorar_textos, "mejorar")

    result = {
        "kpis":                   kpis,
        "dimensiones":            dimensiones,
        "por_empresa":            por_empresa,
        "por_empresa_dimension":  por_empresa_dimension,
        "motivos":                motivos,
        "volveria_emp":           volveria_emp,
        "tabla":                  tabla,
        "analisis_gusto":         analisis_gusto,
        "analisis_mejorar":       analisis_mejorar,
    }
    return JSONResponse(content=jsonable_encoder(result))
