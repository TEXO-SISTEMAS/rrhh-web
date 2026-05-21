"""
routers/rotacion.py — POST /api/rotacion
Recibe uno o más Excel de rotación (un archivo por año, una hoja por mes),
detecta mes con diccionario + Claude fallback, normaliza, calcula tasa anual,
categoriza motivos con IA e incluye análisis de entrevistas si hay cols P1-P8.
"""

import io
import json
import os
import re
from datetime import date
from typing import List

import anthropic
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from services.utils import (
    CATEGORIAS_MOTIVOS,
    MESES_NOMBRE,
    calcular_tasa_anual,
    detectar_mes,
    normalizar_df,
    validar_excel,
)

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

router = APIRouter()

# ─── Hojas a ignorar (igual que en el original) ───────────────────────────────
FICHAS_IGNORAR = [
    "ROTACION", "RESUMEN", "DASHBOARD", "TOTAL",
    "DB", "TB", "DATOS", "PIVOT", "GRAFICO",
]

# ─── Preguntas de entrevistas de salida ───────────────────────────────────────
PREGUNTAS = {
    "P1_ORIENTACION":       "1. Orientación en el cargo",
    "P2_CAPACITACION":      "2. Capacitación / Entrenamiento",
    "P3_CRECIMIENTO":       "3. Oportunidad de crecimiento",
    "P4_INFRAESTRUCTURA":   "4. Infraestructura adecuada",
    "P5_AMBIENTE":          "5. Ambiente laboral",
    "P6_SUPERVISOR":        "6. Actitud del supervisor",
    "P7_APOYO_SUPERIOR":    "7. Apoyo del superior inmediato",
    "P8_APERTURA_SUPERIOR": "8. Apertura a sugerencias",
}


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIONES CLAUDE
# (copiadas de /streamlit/pages/2_Rotacion.py — lógica sin modificar)
# ══════════════════════════════════════════════════════════════════════════════

def interpretar_mes_ia(nombre_ficha: str) -> int:
    prompt = f"""El nombre de una hoja de Excel es: "{nombre_ficha}"
¿A qué número de mes corresponde? (1=Enero ... 12=Diciembre)
Respondé ÚNICAMENTE con el número entero del mes, sin texto adicional."""
    try:
        r = client.messages.create(
            model="claude-sonnet-4-20250514", max_tokens=10,
            messages=[{"role": "user", "content": prompt}]
        )
        return int(r.content[0].text.strip())
    except Exception:
        return 0


def categorizar_motivos_ia(motivos_unicos: tuple) -> dict:
    lista = "\n".join(f"- {m}" for m in motivos_unicos)
    cats  = "\n".join(f"- {c}" for c in CATEGORIAS_MOTIVOS)
    prompt = f"""Tenés esta lista de motivos de renuncia laboral de empleados.
Cada motivo puede contener múltiples razones separadas por coma.
Tu tarea es asignar a cada motivo UNA categoría principal de la lista provista.

CATEGORÍAS DISPONIBLES:
{cats}

MOTIVOS A CATEGORIZAR:
{lista}

Respondé ÚNICAMENTE con un objeto JSON válido donde la clave es el motivo exacto y el valor es la categoría asignada.
No incluyas explicaciones, markdown ni texto adicional. Solo el JSON."""
    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514", max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        texto = re.sub(r"```json|```", "", response.content[0].text.strip()).strip()
        return json.loads(texto)
    except Exception:
        return {m: "Otro" for m in motivos_unicos}


def interpretar_satisfaccion_ia(promedios_json: str) -> str:
    prompt = f"""Sos un consultor de RRHH analizando resultados de entrevistas de salida de empleados del holding Texo (empresas publicitarias en Paraguay).

Estos son los promedios de satisfacción por dimensión (escala 1 a 5) de empleados que renunciaron:

{promedios_json}

Analizá estos resultados y generá:
1. Los 2-3 puntos más críticos (puntaje más bajo) con una interpretación breve
2. Los puntos más fuertes
3. Una recomendación concreta y accionable para la dirección

Sé directo y ejecutivo. Máximo 200 palabras. Sin markdown excesivo."""
    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514", max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text.strip()
    except Exception:
        return "No se pudo generar el análisis de satisfacción."


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS DE SERIALIZACIÓN
# ══════════════════════════════════════════════════════════════════════════════

def _safe_records(df: pd.DataFrame) -> list:
    for col in df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
        df[col] = df[col].dt.strftime("%Y-%m-%d").where(df[col].notna(), other=None)
    records = []
    for row in df.to_dict(orient="records"):
        clean = {}
        for k, v in row.items():
            if isinstance(v, float) and np.isnan(v):
                clean[k] = None
            elif isinstance(v, (np.integer,)):
                clean[k] = int(v)
            elif isinstance(v, (np.floating,)):
                clean[k] = None if np.isnan(v) else float(v)
            else:
                clean[k] = v
        records.append(clean)
    return records


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return None if np.isnan(f) else f
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

@router.post("")
async def procesar_rotacion(files: List[UploadFile] = File(...)):

    # ── Leer y normalizar todas las hojas de todos los archivos ───────────────
    all_dfs: list[pd.DataFrame] = []
    advertencias: list[str] = []

    for f in files:
        try:
            contents = await validar_excel(f)
            xl = pd.ExcelFile(io.BytesIO(contents))
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"No se pudo leer '{f.filename}'. Verificá que sea un Excel válido.")

        # Año desde nombre de archivo (igual que el original)
        ano_match = re.search(r'20\d{2}', f.filename or "")
        ano = int(ano_match.group()) if ano_match else date.today().year

        hojas_validas = [
            h for h in xl.sheet_names
            if not any(x in h.upper() for x in FICHAS_IGNORAR)
        ]

        for hoja in hojas_validas:
            mes = detectar_mes(hoja, ia_func=interpretar_mes_ia)
            if mes == 0:
                advertencias.append(f"No se pudo interpretar el mes de '{hoja}' en {f.filename} — omitida.")
                continue
            try:
                df_raw = pd.read_excel(xl, sheet_name=hoja)
                if df_raw.empty or len(df_raw.columns) < 3:
                    continue
                df_norm = normalizar_df(df_raw, df_raw.columns[0], mes, int(ano))
                all_dfs.append(df_norm)
            except Exception:
                advertencias.append(f"No se pudo procesar la hoja '{hoja}' en '{f.filename}'.")

    if not all_dfs:
        raise HTTPException(
            status_code=422,
            detail="No se pudo extraer datos de los archivos. Verificá que las hojas no estén en la lista de ignorados y que el mes sea identificable."
        )

    df = pd.concat(all_dfs, ignore_index=True)

    # ── Separar activos y salidas ─────────────────────────────────────────────
    if "SITUACION" in df.columns:
        df_sal = df[df["SITUACION"].str.strip().str.upper() == "I"].copy()
        df_act = df[df["SITUACION"].str.strip().str.upper() != "I"].copy()
    else:
        df_sal = pd.DataFrame()
        df_act = df.copy()

    # ══════════════════════════════════════════════════════════════════════════
    # KPIs
    # ══════════════════════════════════════════════════════════════════════════
    salidas_totales = len(df_sal)
    empresas_u      = int(df["EMPRESA"].nunique()) if "EMPRESA" in df.columns else 0
    hc_enero        = int(len(df[df["MES_REPORTE"] == 1])) if "MES_REPORTE" in df.columns else 0
    tasa_anual      = calcular_tasa_anual(df)

    vol = invol = 0
    if "TIPO_SALIDA" in df_sal.columns:
        vol   = int(df_sal["TIPO_SALIDA"].str.contains("VOL", case=False, na=False).sum())
        invol = int(df_sal["TIPO_SALIDA"].str.contains("INV", case=False, na=False).sum())

    perm_prom = _safe_float(df_sal["MESES_PERMANENCIA"].mean()) if "MESES_PERMANENCIA" in df_sal.columns and not df_sal.empty else None

    kpis = {
        "tasa_anual":      tasa_anual,
        "salidas_totales": salidas_totales,
        "hc_enero":        hc_enero,
        "empresas":        empresas_u,
        "voluntarias":     vol,
        "involuntarias":   invol,
        "permanencia_prom_meses": round(perm_prom, 1) if perm_prom else None,
    }

    # ══════════════════════════════════════════════════════════════════════════
    # POR EMPRESA
    # ══════════════════════════════════════════════════════════════════════════
    por_empresa: dict = {}

    if "EMPRESA" in df.columns:
        # Salidas por empresa
        sal_emp = df_sal.groupby("EMPRESA").size().reset_index(name="salidas") if not df_sal.empty else pd.DataFrame(columns=["EMPRESA", "salidas"])
        por_empresa["salidas"] = _safe_records(sal_emp.sort_values("salidas", ascending=False))

        # Tasa anual por empresa (mismo algoritmo que calcular_tasa_anual)
        tasa_rows = []
        for emp in df["EMPRESA"].dropna().unique():
            df_emp = df[df["EMPRESA"] == emp]
            for ano_val in df_emp["ANO_REPORTE"].unique() if "ANO_REPORTE" in df_emp.columns else []:
                df_ea = df_emp[df_emp["ANO_REPORTE"] == ano_val]
                salidas_ano = len(df_ea[df_ea["SITUACION"].str.strip().str.upper() == "I"]) if "SITUACION" in df_ea.columns else 0
                hc_en = len(df_ea[df_ea["MES_REPORTE"] == 1]) if "MES_REPORTE" in df_ea.columns else 0
                if hc_en > 0:
                    tasa_rows.append({"empresa": emp, "ano": int(ano_val), "tasa_anual": round(salidas_ano / hc_en * 100, 1)})
        if tasa_rows:
            tasa_df = pd.DataFrame(tasa_rows).sort_values("ano", ascending=False).drop_duplicates("empresa")
            por_empresa["tasa_anual"] = _safe_records(tasa_df.sort_values("tasa_anual"))

        # Permanencia promedio por empresa
        if "MESES_PERMANENCIA" in df_sal.columns and not df_sal.empty:
            perm_emp = (df_sal.groupby("EMPRESA")["MESES_PERMANENCIA"].mean()
                              .reset_index().rename(columns={"MESES_PERMANENCIA": "meses_promedio"}))
            perm_emp["meses_promedio"] = perm_emp["meses_promedio"].round(1)
            por_empresa["permanencia"] = _safe_records(perm_emp.dropna().sort_values("meses_promedio"))

        # Tipo de salida por empresa
        if "TIPO_SALIDA" in df_sal.columns and not df_sal.empty:
            ts_emp = df_sal.groupby(["EMPRESA", "TIPO_SALIDA"]).size().reset_index(name="n")
            por_empresa["tipo_salida"] = _safe_records(ts_emp)

    # ══════════════════════════════════════════════════════════════════════════
    # POR MOTIVO (con categorización IA)
    # ══════════════════════════════════════════════════════════════════════════
    por_motivo: dict = {}

    if "MOTIVO_SALIDA" in df_sal.columns and not df_sal.empty:
        motivos_u = tuple(df_sal["MOTIVO_SALIDA"].dropna().unique())
        if motivos_u:
            mapa_cat = categorizar_motivos_ia(motivos_u)
            df_sal["MOTIVO_CATEGORIA"] = df_sal["MOTIVO_SALIDA"].map(mapa_cat).fillna("Otro")
            # Propagar al df principal para que aparezca en raw_rows
            df.loc[df_sal.index, "MOTIVO_CATEGORIA"] = df_sal["MOTIVO_CATEGORIA"]

        cat_counts = df_sal["MOTIVO_CATEGORIA"].value_counts().reset_index()
        cat_counts.columns = ["categoria", "cantidad"]
        por_motivo["labels"]  = cat_counts["categoria"].tolist()
        por_motivo["values"]  = [int(v) for v in cat_counts["cantidad"].tolist()]
        por_motivo["detalle"] = _safe_records(cat_counts)

        # Motivos originales sin agrupar (top 10)
        mot_orig = df_sal["MOTIVO_SALIDA"].value_counts().head(10).reset_index()
        mot_orig.columns = ["motivo", "cantidad"]
        por_motivo["top10_originales"] = _safe_records(mot_orig)

    # ══════════════════════════════════════════════════════════════════════════
    # TENDENCIA
    # ══════════════════════════════════════════════════════════════════════════
    tendencia: dict = {}

    if "MES_REPORTE" in df.columns and "ANO_REPORTE" in df.columns and not df_sal.empty:
        sal_trend = (df_sal.groupby(["ANO_REPORTE", "MES_REPORTE"]).size()
                           .reset_index(name="salidas"))
        sal_trend["mes_nombre"] = sal_trend["MES_REPORTE"].map(MESES_NOMBRE)
        sal_trend["ANO_REPORTE"] = sal_trend["ANO_REPORTE"].astype(str)
        sal_trend = sal_trend.rename(columns={"ANO_REPORTE": "ano", "MES_REPORTE": "mes"})
        tendencia["mensual"] = _safe_records(sal_trend)

        # Meses y valores para el gráfico de línea (todos los años juntos)
        tendencia["meses"]  = sal_trend["mes_nombre"].tolist()
        tendencia["valores"] = [int(v) for v in sal_trend["salidas"].tolist()]
        tendencia["anos"]   = sal_trend["ano"].tolist()

        # Salidas totales por año
        sal_ano = df_sal.groupby("ANO_REPORTE").size().reset_index(name="salidas")
        tendencia["por_ano"] = _safe_records(sal_ano.rename(columns={"ANO_REPORTE": "ano"}))

        # Mapa de calor: empresa × mes
        if "EMPRESA" in df_sal.columns:
            heat = (df_sal.groupby(["EMPRESA", "MES_REPORTE"]).size()
                          .reset_index(name="salidas"))
            heat["mes_nombre"] = heat["MES_REPORTE"].map(MESES_NOMBRE)
            tendencia["heatmap"] = _safe_records(heat.rename(columns={"MES_REPORTE": "mes"}))

    # ══════════════════════════════════════════════════════════════════════════
    # ENTREVISTAS DE SALIDA (si el Excel tiene columnas P1–P8)
    # ══════════════════════════════════════════════════════════════════════════
    entrevistas: dict = {}
    pregs_disp = [p for p in PREGUNTAS.keys() if p in df.columns]

    if pregs_disp:
        df_ent = df.copy()
        for p in pregs_disp:
            df_ent[p] = pd.to_numeric(df_ent[p], errors="coerce")
        df_ent["SCORE_PROMEDIO"] = df_ent[pregs_disp].mean(axis=1).round(2)

        prom_dims = {
            PREGUNTAS[p]: round(float(df_ent[p].mean()), 2)
            for p in pregs_disp
            if not np.isnan(df_ent[p].mean())
        }
        satisfaccion_promedio = round(sum(prom_dims.values()) / len(prom_dims), 2) if prom_dims else None

        insight = interpretar_satisfaccion_ia(
            json.dumps(prom_dims, ensure_ascii=False, indent=2)
        )

        entrevistas = {
            "satisfaccion_promedio": satisfaccion_promedio,
            "insight_ia":            insight,
            "por_dimension":         prom_dims,
        }

        # Por empresa (si hay columna EMPRESA en el mismo df)
        if "EMPRESA" in df_ent.columns:
            emp_pregs = df_ent.groupby("EMPRESA")[pregs_disp].mean().reset_index()
            emp_melt  = emp_pregs.melt(id_vars="EMPRESA", var_name="pregunta", value_name="promedio")
            emp_melt["pregunta"] = emp_melt["pregunta"].map(PREGUNTAS)
            entrevistas["por_empresa"] = _safe_records(emp_melt.dropna())

    # ── raw_rows: columnas para filtrado en frontend ─────────────────────────
    raw_cols = [c for c in [
        "EMPRESA", "TIPO_SALIDA", "MOTIVO_SALIDA", "MOTIVO_CATEGORIA",
        "ANO_REPORTE", "MES_REPORTE", "SITUACION", "MESES_PERMANENCIA",
        "CARGO", "AREA", "DEPARTAMENTO", "CEDULA", "NOMBRE",
        "FECHA_INGRESO", "ANO_INGRESO",
    ] if c in df.columns]
    raw_rows = _safe_records(df[raw_cols].copy())

    # Tabla = raw_rows de salidas con info de motivos
    tabla_rot_cols = [c for c in [
        "EMPRESA", "CARGO", "AREA", "DEPARTAMENTO",
        "TIPO_SALIDA", "MOTIVO_SALIDA", "MOTIVO_CATEGORIA",
        "ANO_REPORTE", "MES_REPORTE", "SITUACION", "MESES_PERMANENCIA",
    ] if c in df_sal.columns]
    tabla = _safe_records(df_sal[tabla_rot_cols].copy()) if not df_sal.empty else []

    # ── Respuesta ─────────────────────────────────────────────────────────────
    result = {
        "kpis":         kpis,
        "por_empresa":  por_empresa,
        "por_motivo":   por_motivo,
        "tendencia":    tendencia,
        "entrevistas":  entrevistas,
        "advertencias": advertencias,
        "raw_rows":     raw_rows,
        "tabla":        tabla,
    }
    return JSONResponse(content=jsonable_encoder(result))
