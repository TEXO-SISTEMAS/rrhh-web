"""
routers/reclutamiento.py — POST /api/reclutamiento
Recibe uno o más Excel de reclutamiento, normaliza columnas con alias mapping
del original, calcula días hábiles, normaliza situaciones, cuenta candidatos
y devuelve el JSON completo para renderizar todos los gráficos del módulo.
"""

import gc
import io
from datetime import date
from typing import List

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from services.utils import (
    contar_candidatos,
    detectar_ano_columna,
    dias_habiles,
    normalizar_situacion,
    validar_excel,
)

router = APIRouter()

# ─── Alias mapping del original (1_Reclutamiento.py) ─────────────────────────
COL_MAP_RECLUTAMIENTO = {
    "DIAS_HAB_": "DIAS_HAB", "DIAS_HAB": "DIAS_HAB",
    "POSICION0": "POSICION", "POSICION": "POSICION",
    "ANO": "ANO", "AO": "ANO",
}

COLS_TEXTO = [
    "AGENCIA", "RESPONSABLE", "SOLICITANTE", "TIPO_VACANTE", "POSICION",
    "NIVEL", "STATUS", "SITUACION", "TIPO_INGRESO", "SELECCIONADO",
]


# ══════════════════════════════════════════════════════════════════════════════
# NORMALIZACIÓN
# (lógica copiada de /streamlit/pages/1_Reclutamiento.py — sin modificar)
# ══════════════════════════════════════════════════════════════════════════════

def normalizar_reclutamiento(df_raw: pd.DataFrame) -> pd.DataFrame:
    df = df_raw.copy()

    # ── Normalizar nombres de columnas ────────────────────────────────────────
    df.columns = (
        df.columns.str.strip().str.upper()
        .str.replace(".", "", regex=False)
        .str.replace(" ", "_")
        .str.replace("Á", "A").str.replace("É", "E")
        .str.replace("Í", "I").str.replace("Ó", "O")
        .str.replace("Ú", "U").str.replace("Ñ", "N")
    )
    df.rename(columns={k: v for k, v in COL_MAP_RECLUTAMIENTO.items() if k in df.columns}, inplace=True)

    # ── Limpiar columnas de texto ─────────────────────────────────────────────
    for col in COLS_TEXTO:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.upper().replace({"NAN": np.nan, "": np.nan})

    # Filtrar filas vacías — celdas vacías pueden ser NaN o string vacío
    if "POSICION" in df.columns:
        df = df[df["POSICION"].notna()].reset_index(drop=True)
    elif "RECEPCION" in df.columns:
        df = df.dropna(subset=["RECEPCION"]).reset_index(drop=True)

    # ── Fechas ────────────────────────────────────────────────────────────────
    for col in ["RECEPCION", "CIERRE"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    # ── Normalizar SITUACION ──────────────────────────────────────────────────
    if "SITUACION" in df.columns:
        df["SITUACION"] = df["SITUACION"].apply(normalizar_situacion)

    # ── Calcular días hábiles ─────────────────────────────────────────────────
    today = pd.Timestamp(date.today())
    if "RECEPCION" in df.columns:
        df["DIAS_HAB_CALC"] = df.apply(
            lambda r: dias_habiles(r["RECEPCION"], r["CIERRE"] if pd.notnull(r.get("CIERRE")) else today),
            axis=1,
        )
        df["DIAS_CIERRE"] = df.apply(
            lambda r: dias_habiles(r["RECEPCION"], r["CIERRE"]) if pd.notnull(r.get("CIERRE")) else None,
            axis=1,
        )

    # ── AÑO y MES — siempre desde RECEPCION (la columna AÑO/MES del Excel ────────
    # puede contener fórmulas de texto como =GEMINI(...) en lugar de valores reales)
    if "RECEPCION" in df.columns:
        df["ANO"] = df["RECEPCION"].dt.year.astype("Int64")
        df["MES"] = df["RECEPCION"].dt.month.astype("Int64")
    elif "ANO" in df.columns:
        df["ANO"] = pd.to_numeric(df["ANO"], errors="coerce").astype("Int64")

    # ── Contar candidatos ─────────────────────────────────────────────────────
    if "CANDIDATOS" in df.columns:
        df["N_CANDIDATOS"] = df["CANDIDATOS"].apply(contar_candidatos)

    return df


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
            elif pd.isna(v) if not isinstance(v, (list, dict)) else False:
                clean[k] = None
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


def _mean_col(df: pd.DataFrame, col: str) -> float | None:
    if col not in df.columns or df[col].isna().all():
        return None
    return _safe_float(df[col].mean())


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

@router.post("")
async def procesar_reclutamiento(
    files: List[UploadFile] = File(...),
    ano: int | None = Form(default=None),
):

    # ── Leer y concatenar todos los archivos ──────────────────────────────────
    dfs: list[pd.DataFrame] = []
    for f in files:
        try:
            contents = await validar_excel(f)
            xl = pd.ExcelFile(io.BytesIO(contents))
            # Si tiene más de una hoja, toma la primera (el frontend elegirá en un paso previo)
            df_tmp = pd.read_excel(xl, sheet_name=xl.sheet_names[0])
            df_tmp["_archivo"] = f.filename
            dfs.append(df_tmp)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"No se pudo leer '{f.filename}'. Verificá que sea un Excel válido.")

    if not dfs:
        raise HTTPException(status_code=422, detail="No se recibieron archivos válidos.")

    # Detectar año desde columna Excel antes de concatenar
    ano_detectado = next((detectar_ano_columna(d) for d in dfs if detectar_ano_columna(d)), None)
    ano_fallback = ano_detectado or ano or date.today().year

    df_raw = pd.concat(dfs, ignore_index=True)
    del dfs
    gc.collect()

    # ── Normalizar ────────────────────────────────────────────────────────────
    try:
        df = normalizar_reclutamiento(df_raw)
        del df_raw
        gc.collect()
    except Exception:
        raise HTTPException(status_code=422, detail="Error al procesar el archivo de reclutamiento. Verificá que el formato sea correcto.")

    if df.empty:
        raise HTTPException(status_code=422, detail="El archivo no contiene datos.")

    # Aplicar año como fallback cuando RECEPCION no pudo parsearse
    if "ANO" not in df.columns:
        df["ANO"] = ano_fallback
    else:
        df["ANO"] = df["ANO"].fillna(ano_fallback)

    total = len(df)

    # ══════════════════════════════════════════════════════════════════════════
    # KPIs
    # ══════════════════════════════════════════════════════════════════════════
    def _count_sit(val: str) -> int:
        if "SITUACION" not in df.columns:
            return 0
        return int((df["SITUACION"].str.upper() == val).sum())

    abiertas   = _count_sit("ABIERTA")
    cerradas   = _count_sit("CERRADA")
    canceladas = _count_sit("CANCELADA")
    pausadas   = _count_sit("PAUSADA")
    cerradas_pct = round(cerradas / total * 100, 1) if total > 0 else 0.0

    dias_prom    = _mean_col(df, "DIAS_CIERRE")
    total_cand   = int(df["N_CANDIDATOS"].sum()) if "N_CANDIDATOS" in df.columns else 0

    kpis = {
        "total_busquedas": total,
        "abiertas":        abiertas,
        "cerradas":        cerradas,
        "canceladas":      canceladas,
        "pausadas":        pausadas,
        "cerradas_pct":    cerradas_pct,
        "dias_promedio":   round(dias_prom, 1) if dias_prom else None,
        "total_candidatos": total_cand,
    }

    # ══════════════════════════════════════════════════════════════════════════
    # POR AGENCIA
    # ══════════════════════════════════════════════════════════════════════════
    por_agencia: dict = {}

    if "AGENCIA" in df.columns:
        # Búsquedas por agencia
        ag = df.groupby("AGENCIA").size().reset_index(name="busquedas").sort_values("busquedas")
        por_agencia["busquedas"] = _safe_records(ag)

        # Días promedio de cierre por agencia
        if "DIAS_CIERRE" in df.columns:
            ag_d = (df.groupby("AGENCIA")["DIAS_CIERRE"].mean()
                      .reset_index().rename(columns={"DIAS_CIERRE": "dias_promedio"}))
            ag_d["dias_promedio"] = ag_d["dias_promedio"].round(1)
            por_agencia["dias_promedio"] = _safe_records(ag_d.dropna().sort_values("dias_promedio"))

        # Situación por agencia (stacked bar)
        if "SITUACION" in df.columns:
            ag_s = df.groupby(["AGENCIA", "SITUACION"]).size().reset_index(name="n")
            por_agencia["por_situacion"] = _safe_records(ag_s)

        # Tipo de vacante por agencia (grouped bar)
        if "TIPO_VACANTE" in df.columns:
            ag_tv = df.groupby(["AGENCIA", "TIPO_VACANTE"]).size().reset_index(name="n")
            por_agencia["por_tipo_vacante"] = _safe_records(ag_tv)

    # ══════════════════════════════════════════════════════════════════════════
    # POR NIVEL (AIC)
    # ══════════════════════════════════════════════════════════════════════════
    por_nivel: dict = {}

    if "NIVEL" in df.columns:
        # Días promedio por nivel AIC
        if "DIAS_CIERRE" in df.columns:
            niv = (df.groupby("NIVEL")["DIAS_CIERRE"].mean()
                     .reset_index().rename(columns={"DIAS_CIERRE": "dias_promedio"}))
            niv["dias_promedio"] = niv["dias_promedio"].round(1)
            por_nivel["dias_promedio"] = _safe_records(niv.dropna())

    # Canal de ingreso (pie) — va bajo nivel porque el original lo pone en tab 2
    if "TIPO_INGRESO" in df.columns:
        ti = df["TIPO_INGRESO"].value_counts().reset_index()
        ti.columns = ["canal", "cantidad"]
        por_nivel["canal_ingreso"] = {
            "labels": ti["canal"].tolist(),
            "values": [int(v) for v in ti["cantidad"].tolist()],
        }

        if "DIAS_CIERRE" in df.columns:
            ti_d = (df.groupby("TIPO_INGRESO")["DIAS_CIERRE"].mean()
                      .reset_index().rename(columns={"TIPO_INGRESO": "canal", "DIAS_CIERRE": "dias_promedio"}))
            ti_d["dias_promedio"] = ti_d["dias_promedio"].round(1)
            por_nivel["dias_por_canal"] = _safe_records(ti_d.dropna())

    # ══════════════════════════════════════════════════════════════════════════
    # POR PUESTO
    # ══════════════════════════════════════════════════════════════════════════
    por_puesto: dict = {}

    if "POSICION" in df.columns:
        # Top 15 más solicitados
        pos = (df.groupby("POSICION").size().reset_index(name="busquedas")
                 .sort_values("busquedas", ascending=False).head(15))
        por_puesto["top15_busquedas"] = _safe_records(pos)

        # Top 15 que más tardan
        if "DIAS_CIERRE" in df.columns:
            pos_d = (df.groupby("POSICION")["DIAS_CIERRE"].mean()
                       .reset_index().rename(columns={"DIAS_CIERRE": "dias_promedio"}))
            pos_d["dias_promedio"] = pos_d["dias_promedio"].round(1)
            por_puesto["top15_tiempo"] = _safe_records(
                pos_d.dropna().sort_values("dias_promedio", ascending=False).head(15)
            )

    # ══════════════════════════════════════════════════════════════════════════
    # POR RESPONSABLE
    # ══════════════════════════════════════════════════════════════════════════
    por_responsable: dict = {}

    if "RESPONSABLE" in df.columns:
        # Búsquedas por responsable
        resp = (df.groupby("RESPONSABLE").size()
                  .reset_index(name="busquedas").sort_values("busquedas"))
        por_responsable["busquedas"] = _safe_records(resp)

        # Días promedio por responsable
        if "DIAS_CIERRE" in df.columns:
            resp_d = (df.groupby("RESPONSABLE")["DIAS_CIERRE"].mean()
                        .reset_index().rename(columns={"DIAS_CIERRE": "dias_promedio"}))
            resp_d["dias_promedio"] = resp_d["dias_promedio"].round(1)
            por_responsable["dias_promedio"] = _safe_records(resp_d.dropna().sort_values("dias_promedio"))

        # Situación por responsable (stacked bar)
        if "SITUACION" in df.columns:
            resp_s = df.groupby(["RESPONSABLE", "SITUACION"]).size().reset_index(name="n")
            por_responsable["por_situacion"] = _safe_records(resp_s)

            # Tasa de éxito: % cerradas
            resp_tot  = df.groupby("RESPONSABLE").size().rename("total")
            resp_cerr = (df[df["SITUACION"].str.upper() == "CERRADA"]
                           .groupby("RESPONSABLE").size().rename("cerradas"))
            tasa = pd.concat([resp_tot, resp_cerr], axis=1).fillna(0).reset_index()
            tasa["tasa_exito_pct"] = (tasa["cerradas"] / tasa["total"] * 100).round(1)
            por_responsable["tasa_exito"] = _safe_records(
                tasa.sort_values("tasa_exito_pct")[["RESPONSABLE", "tasa_exito_pct", "cerradas", "total"]]
            )

    # ══════════════════════════════════════════════════════════════════════════
    # TENDENCIA DE CIERRE
    # ══════════════════════════════════════════════════════════════════════════
    tendencia_cierre: dict = {}

    if "ANO" in df.columns:
        # Búsquedas por año
        por_ano = (df.groupby("ANO").size().reset_index(name="busquedas"))
        por_ano["ANO"] = por_ano["ANO"].astype(str)
        tendencia_cierre["por_ano"] = _safe_records(por_ano)

        # Tendencia mensual por año (línea)
        if "MES" in df.columns:
            mes_a = df.groupby(["ANO", "MES"]).size().reset_index(name="busquedas")
            mes_a["ANO"] = mes_a["ANO"].astype(str)
            tendencia_cierre["mensual"]  = _safe_records(mes_a.rename(columns={"ANO": "ano", "MES": "mes"}))
            # Arrays planos para gráfico de línea simple
            tendencia_cierre["meses"]    = mes_a["MES"].tolist()
            tendencia_cierre["valores"]  = [int(v) for v in mes_a["busquedas"].tolist()]
            tendencia_cierre["anos"]     = mes_a["ANO"].tolist()

        # Días promedio de cierre por año
        if "DIAS_CIERRE" in df.columns:
            d_a = (df.groupby("ANO")["DIAS_CIERRE"].mean()
                     .reset_index().rename(columns={"DIAS_CIERRE": "dias_promedio"}))
            d_a["ANO"] = d_a["ANO"].astype(str)
            d_a["dias_promedio"] = d_a["dias_promedio"].round(1)
            tendencia_cierre["dias_por_ano"] = _safe_records(d_a.dropna())

            # Días cierre agencia × año (multi-line)
            if "AGENCIA" in df.columns:
                d_ag = (df.groupby(["ANO", "AGENCIA"])["DIAS_CIERRE"].mean()
                          .reset_index().rename(columns={"DIAS_CIERRE": "dias_promedio"}))
                d_ag["ANO"] = d_ag["ANO"].astype(str)
                d_ag["dias_promedio"] = d_ag["dias_promedio"].round(1)
                tendencia_cierre["dias_agencia_ano"] = _safe_records(d_ag.dropna())

    # ══════════════════════════════════════════════════════════════════════════
    # TABLA DETALLE
    # ══════════════════════════════════════════════════════════════════════════
    tabla_cols = [c for c in [
        "AGENCIA", "RESPONSABLE", "POSICION", "NIVEL", "TIPO_VACANTE",
        "SITUACION", "STATUS", "TIPO_INGRESO", "RECEPCION", "CIERRE",
        "DIAS_CIERRE", "PRESUPUESTO", "CANDIDATOS", "SELECCIONADO",
        "N_CANDIDATOS", "ANO",
    ] if c in df.columns]

    tabla = _safe_records(df[tabla_cols].copy())

    # ── Respuesta ─────────────────────────────────────────────────────────────
    result = {
        "kpis":             kpis,
        "por_agencia":      por_agencia,
        "por_nivel":        por_nivel,
        "por_puesto":       por_puesto,
        "por_responsable":  por_responsable,
        "tendencia_cierre": tendencia_cierre,
        "tabla":            tabla,
    }
    del df
    gc.collect()
    return JSONResponse(content=jsonable_encoder(result))

