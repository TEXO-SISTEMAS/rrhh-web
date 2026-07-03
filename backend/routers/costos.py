"""
routers/costos.py — POST /api/costos
Recibe Excel de liquidaciones, mapea ~30 columnas financieras,
calcula sobrecosto como métrica principal, ordena niveles AIC
y devuelve JSON completo para todos los gráficos del módulo.
"""

import gc
import io
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from services.utils import COL_MAP_COSTOS, fmt_gs, sort_aic, validar_excel

router = APIRouter()

# ─── Columnas numéricas (del original 3_Costos_Liquidaciones.py) ──────────────
COLS_NUMERICAS = [
    "SALARIO_BASE", "COMISIONES", "HORAS_EXTRAS", "BONIF_FAMILIAR",
    "VAC_CAUSADAS", "VAC_PROPORCIONALES", "INDEMNIZACION", "PREAVISO",
    "GRATIFICACION", "AGUINALDO", "TOTAL_BRUTO", "ANTICIPO", "OMISION_PREAVISO",
    "SEGURO_MEDICO", "SMARTFIT", "OTROS_DESCUENTOS", "PTMO_CUOTAS",
    "IPS_1", "IPS_SOBRECOSTO", "IPS_TOTAL", "TOTAL_DESCUENTOS",
    "NETO", "AP_1", "AP_SOBRECOSTO", "APORTE_PATRONAL", "TOTAL_COSTO", "SOBRECOSTO",
]

# Conceptos para composición de costos (del original)
CONCEPTOS = {
    "Salario Base":        "SALARIO_BASE",
    "Vacaciones Causadas": "VAC_CAUSADAS",
    "Vac. Proporcionales": "VAC_PROPORCIONALES",
    "Indemnización":       "INDEMNIZACION",
    "Preaviso":            "PREAVISO",
    "Aguinaldo":           "AGUINALDO",
    "Gratificación":       "GRATIFICACION",
    "Comisiones":          "COMISIONES",
    "Horas Extras":        "HORAS_EXTRAS",
    "Bonif. Familiar":     "BONIF_FAMILIAR",
    "IPS Total":           "IPS_TOTAL",
    "Aporte Patronal":     "APORTE_PATRONAL",
    "Sobrecosto":          "SOBRECOSTO",
}


# ══════════════════════════════════════════════════════════════════════════════
# NORMALIZACIÓN
# (lógica copiada de /streamlit/pages/3_Costos_Liquidaciones.py — sin modificar)
# ══════════════════════════════════════════════════════════════════════════════

def normalizar_costos(df_raw: pd.DataFrame) -> pd.DataFrame:
    df = df_raw.copy()

    # Normalizar columnas (igual al original, incluido .replace(".",","))
    df.columns = (
        df.columns.str.strip().str.upper()
        .str.replace(" ", "_").str.replace(".", ",", regex=False)
        .str.replace("Á", "A").str.replace("É", "E")
        .str.replace("Í", "I").str.replace("Ó", "O")
        .str.replace("Ú", "U").str.replace("Ñ", "N")
        .str.replace(":", "")
    )
    df.rename(columns={k: v for k, v in COL_MAP_COSTOS.items() if k in df.columns}, inplace=True)

    # Texto
    for col in ["AGENCIA", "NIVEL_AIC", "TIPO_SALIDA", "MOTIVO_SALIDA", "NOMBRE"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.upper().replace("NAN", np.nan)

    # Numéricos — fillna(0) igual que el original
    for col in COLS_NUMERICAS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    # Fechas + columnas derivadas de año/mes
    if "FECHA_SALIDA" in df.columns:
        df["FECHA_SALIDA"] = pd.to_datetime(df["FECHA_SALIDA"], errors="coerce")
        df["ANO_SALIDA"]   = df["FECHA_SALIDA"].dt.year.astype("Int64")
        df["MES_SALIDA_N"] = df["FECHA_SALIDA"].dt.month.astype("Int64")

    # Calcular SOBRECOSTO si no viene en el Excel o está todo en cero
    componentes_sob = ["INDEMNIZACION", "PREAVISO", "VAC_PROPORCIONALES",
                       "AGUINALDO", "GRATIFICACION", "IPS_SOBRECOSTO", "AP_SOBRECOSTO"]
    if "SOBRECOSTO" not in df.columns or df.get("SOBRECOSTO", pd.Series([0])).sum() == 0:
        cols_disp = [c for c in componentes_sob if c in df.columns]
        if cols_disp:
            df["SOBRECOSTO"] = df[cols_disp].sum(axis=1)

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
            else:
                clean[k] = v
        records.append(clean)
    return records


def _sum(df: pd.DataFrame, col: str) -> float:
    return float(df[col].sum()) if col in df.columns else 0.0


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

@router.post("")
async def procesar_costos(
    files: List[UploadFile] = File(...),
    hoja: Optional[str] = Form(None),
    ano: int = Form(...),
):
    # ── Leer y concatenar archivos ────────────────────────────────────────────
    dfs: list[pd.DataFrame] = []
    todas_hojas: list[str] = []
    hoja_activa: str = ""

    for f in files:
        try:
            contents = await validar_excel(f)
            xl = pd.ExcelFile(io.BytesIO(contents))

            # Acumular hojas únicas (preservando orden de aparición)
            for h in xl.sheet_names:
                if h not in todas_hojas:
                    todas_hojas.append(h)

            # Elegir hoja: la pedida si existe en este archivo, sino la primera
            if hoja and hoja in xl.sheet_names:
                hoja_sel = hoja
            else:
                hoja_sel = xl.sheet_names[0]

            if not hoja_activa:
                hoja_activa = hoja_sel

            df_tmp = pd.read_excel(xl, sheet_name=hoja_sel)
            df_tmp["_archivo"] = f.filename
            dfs.append(df_tmp)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail=f"No se pudo leer '{f.filename}'. Verificá que sea un Excel válido.")

    if not dfs:
        raise HTTPException(status_code=422, detail="No se recibieron archivos válidos.")

    try:
        df = normalizar_costos(pd.concat(dfs, ignore_index=True))
        del dfs
        gc.collect()
    except Exception:
        raise HTTPException(status_code=422, detail="Error al procesar el archivo de liquidaciones. Verificá que el formato sea correcto.")

    if df.empty:
        raise HTTPException(status_code=422, detail="El archivo no contiene datos.")

    # Aplicar año del formulario como fallback cuando FECHA_SALIDA no pudo parsearse
    if "ANO_SALIDA" not in df.columns:
        df["ANO_SALIDA"] = ano
    else:
        df["ANO_SALIDA"] = df["ANO_SALIDA"].fillna(ano)

    # Eliminar filas de totales y filas vacías (AGENCIA null o vacío)
    if "AGENCIA" in df.columns:
        df = df[df["AGENCIA"].notna() & (df["AGENCIA"].str.strip() != "")]

    # ══════════════════════════════════════════════════════════════════════════
    # KPIs
    # ══════════════════════════════════════════════════════════════════════════
    total_casos      = len(df)
    total_bruto      = _sum(df, "TOTAL_BRUTO")
    total_neto       = _sum(df, "NETO")
    total_costo      = _sum(df, "TOTAL_COSTO")
    total_sobrecosto = _sum(df, "SOBRECOSTO")
    aporte_pat       = _sum(df, "APORTE_PATRONAL")

    kpis = {
        "total_liquidaciones": total_casos,
        "total_bruto":         round(total_bruto, 0),
        "total_neto":          round(total_neto, 0),
        "total_costo":         round(total_costo, 0),
        "aporte_patronal":     round(aporte_pat, 0),
        "sobrecosto":          round(total_sobrecosto, 0),
        # Versiones formateadas para display directo
        "total_bruto_fmt":     fmt_gs(total_bruto),
        "total_neto_fmt":      fmt_gs(total_neto),
        "total_costo_fmt":     fmt_gs(total_costo),
        "aporte_patronal_fmt": fmt_gs(aporte_pat),
        "sobrecosto_fmt":      fmt_gs(total_sobrecosto),
    }

    # ══════════════════════════════════════════════════════════════════════════
    # POR AGENCIA
    # ══════════════════════════════════════════════════════════════════════════
    por_agencia: dict = {}

    if "AGENCIA" in df.columns:
        # Sobrecosto y costo total por agencia
        ag_costo = (df.groupby("AGENCIA")[["SOBRECOSTO", "TOTAL_COSTO"]].sum()
                      .reset_index().sort_values("SOBRECOSTO", ascending=True))
        por_agencia["sobrecosto_total"] = _safe_records(ag_costo)

        # Cantidad de liquidaciones por agencia
        ag_n = df.groupby("AGENCIA").size().reset_index(name="cantidad").sort_values("cantidad")
        por_agencia["cantidad"] = _safe_records(ag_n)

        # Sobrecosto promedio por liquidación por agencia
        ag_prom = (df.groupby("AGENCIA")[["SOBRECOSTO", "TOTAL_COSTO"]].mean()
                     .reset_index().rename(columns={"SOBRECOSTO": "sobrecosto_prom", "TOTAL_COSTO": "costo_prom"})
                     .sort_values("sobrecosto_prom", ascending=False))
        por_agencia["sobrecosto_promedio"] = _safe_records(ag_prom)

        # Composición de costos apilada por agencia
        cols_stack = [v for v in CONCEPTOS.values() if v in df.columns]
        if cols_stack:
            ag_stack = df.groupby("AGENCIA")[cols_stack].sum().reset_index()
            ag_melt = ag_stack.melt(id_vars="AGENCIA", var_name="concepto", value_name="monto")
            concepto_inv = {v: k for k, v in CONCEPTOS.items()}
            ag_melt["concepto"] = ag_melt["concepto"].map(concepto_inv)
            ag_melt = ag_melt[ag_melt["monto"] > 0]
            por_agencia["composicion"] = _safe_records(ag_melt)

    # ══════════════════════════════════════════════════════════════════════════
    # POR TIPO / MOTIVO DE SALIDA
    # ══════════════════════════════════════════════════════════════════════════
    por_tipo_salida: dict = {}

    if "TIPO_SALIDA" in df.columns:
        # Sobrecosto por tipo (pie)
        ts_sob = (df.groupby("TIPO_SALIDA")["SOBRECOSTO"].sum()
                    .reset_index().rename(columns={"TIPO_SALIDA": "tipo", "SOBRECOSTO": "sobrecosto"}))
        por_tipo_salida["por_tipo"] = {
            "labels": ts_sob["tipo"].tolist(),
            "values": [round(float(v), 0) for v in ts_sob["sobrecosto"].tolist()],
        }

        # Sobrecosto promedio por tipo
        ts_prom = (df.groupby("TIPO_SALIDA")[["SOBRECOSTO", "TOTAL_COSTO"]].mean()
                     .reset_index().rename(columns={"TIPO_SALIDA": "tipo",
                                                     "SOBRECOSTO": "sobrecosto_prom",
                                                     "TOTAL_COSTO": "costo_prom"}))
        por_tipo_salida["promedio_por_tipo"] = _safe_records(ts_prom)

    if "MOTIVO_SALIDA" in df.columns and "SOBRECOSTO" in df.columns:
        mot_sob = (df.groupby("MOTIVO_SALIDA")["SOBRECOSTO"].sum()
                     .reset_index().rename(columns={"MOTIVO_SALIDA": "motivo", "SOBRECOSTO": "sobrecosto"})
                     .sort_values("sobrecosto", ascending=False).head(10))
        por_tipo_salida["top10_por_motivo"] = _safe_records(mot_sob)

    # ══════════════════════════════════════════════════════════════════════════
    # POR NIVEL AIC  (con sort_aic para orden lógico)
    # ══════════════════════════════════════════════════════════════════════════
    por_nivel: dict = {}

    if "NIVEL_AIC" in df.columns:
        # Costo total por nivel
        aic_costo = (df.groupby("NIVEL_AIC")["TOTAL_COSTO"].sum()
                       .reset_index().rename(columns={"NIVEL_AIC": "nivel", "TOTAL_COSTO": "total_costo"}))
        aic_costo = sort_aic(aic_costo, col="nivel")
        por_nivel["costo_total"] = _safe_records(aic_costo)

        # Cantidad por nivel
        aic_n = df.groupby("NIVEL_AIC").size().reset_index(name="cantidad").rename(columns={"NIVEL_AIC": "nivel"})
        aic_n = sort_aic(aic_n, col="nivel")
        por_nivel["cantidad"] = _safe_records(aic_n)

        # Sobrecosto por nivel
        if "SOBRECOSTO" in df.columns:
            aic_sob = (df.groupby("NIVEL_AIC")["SOBRECOSTO"].sum()
                         .reset_index().rename(columns={"NIVEL_AIC": "nivel", "SOBRECOSTO": "sobrecosto"}))
            aic_sob = aic_sob[aic_sob["sobrecosto"] > 0]
            aic_sob = sort_aic(aic_sob, col="nivel")
            por_nivel["sobrecosto"] = _safe_records(aic_sob)

        # Costo promedio por nivel
        aic_prom = (df.groupby("NIVEL_AIC")["TOTAL_COSTO"].mean()
                      .reset_index().rename(columns={"NIVEL_AIC": "nivel", "TOTAL_COSTO": "costo_promedio"}))
        aic_prom["costo_promedio"] = aic_prom["costo_promedio"].round(0)
        aic_prom = sort_aic(aic_prom, col="nivel")
        por_nivel["costo_promedio"] = _safe_records(aic_prom)

        # Sobrecosto vs Costo Total (grouped bar)
        if "SOBRECOSTO" in df.columns:
            aic_comp = (df.groupby("NIVEL_AIC")[["TOTAL_COSTO", "SOBRECOSTO"]].sum()
                          .reset_index().rename(columns={"NIVEL_AIC": "nivel",
                                                          "TOTAL_COSTO": "total_costo",
                                                          "SOBRECOSTO": "sobrecosto"}))
            aic_comp = sort_aic(aic_comp, col="nivel")
            por_nivel["comparativo"] = _safe_records(aic_comp)

    # ══════════════════════════════════════════════════════════════════════════
    # COMPOSICIÓN GLOBAL DE COSTOS
    # ══════════════════════════════════════════════════════════════════════════
    comp_global: dict = {}
    comp = {k: float(df[v].sum()) for k, v in CONCEPTOS.items() if v in df.columns and df[v].sum() > 0}
    comp_global["labels"] = list(comp.keys())
    comp_global["values"] = [round(v, 0) for v in comp.values()]

    # ══════════════════════════════════════════════════════════════════════════
    # TENDENCIA (si hay fecha de salida)
    # ══════════════════════════════════════════════════════════════════════════
    tendencia: dict = {}

    if "ANO_SALIDA" in df.columns:
        MESES = {1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May", 6: "Jun",
                 7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic"}

        # Usar solo filas con año válido para que el groupby no descarte
        # silenciosamente filas con SOBRECOSTO pero sin FECHA_SALIDA.
        df_dated = df[df["ANO_SALIDA"].notna()]

        ano_sob = (df_dated.groupby("ANO_SALIDA")["SOBRECOSTO"].sum()
                     .reset_index().rename(columns={"ANO_SALIDA": "ano", "SOBRECOSTO": "sobrecosto"}))
        ano_sob["ano"] = ano_sob["ano"].astype(str)
        tendencia["sobrecosto_por_ano"] = _safe_records(ano_sob)

        ano_n = df_dated.groupby("ANO_SALIDA").size().reset_index(name="liquidaciones")
        ano_n["ANO_SALIDA"] = ano_n["ANO_SALIDA"].astype(str)
        tendencia["liquidaciones_por_ano"] = _safe_records(ano_n.rename(columns={"ANO_SALIDA": "ano"}))

        if "MES_SALIDA_N" in df.columns:
            mes_sob = (df_dated.groupby(["ANO_SALIDA", "MES_SALIDA_N"])["SOBRECOSTO"].sum()
                         .reset_index().rename(columns={"ANO_SALIDA": "ano",
                                                         "MES_SALIDA_N": "mes_n",
                                                         "SOBRECOSTO": "sobrecosto"}))
            mes_sob["mes"] = mes_sob["mes_n"].map(MESES)
            mes_sob["ano"] = mes_sob["ano"].astype(str)
            tendencia["sobrecosto_mensual"] = _safe_records(mes_sob)

    # ══════════════════════════════════════════════════════════════════════════
    # TABLA DETALLE
    # ══════════════════════════════════════════════════════════════════════════
    tabla_cols = [c for c in [
        "AGENCIA", "NOMBRE", "TIPO_SALIDA", "MOTIVO_SALIDA",
        "FECHA_SALIDA", "SALARIO_BASE", "TOTAL_BRUTO",
        "TOTAL_DESCUENTOS", "NETO", "APORTE_PATRONAL",
        "SOBRECOSTO", "TOTAL_COSTO",
    ] if c in df.columns]

    tabla = _safe_records(df[tabla_cols].copy())

    # ── raw_rows: columnas necesarias para filtrado en frontend ───────────────
    raw_cols = [c for c in [
        "AGENCIA", "NIVEL_AIC", "TIPO_SALIDA", "MOTIVO_SALIDA", "ANO_SALIDA", "MES_SALIDA_N",
        "TOTAL_BRUTO", "NETO", "TOTAL_COSTO", "SOBRECOSTO", "APORTE_PATRONAL",
        "SALARIO_BASE", "VAC_CAUSADAS", "VAC_PROPORCIONALES", "INDEMNIZACION",
        "PREAVISO", "AGUINALDO", "GRATIFICACION", "COMISIONES", "HORAS_EXTRAS",
        "BONIF_FAMILIAR", "IPS_TOTAL",
    ] if c in df.columns]
    raw_rows = _safe_records(df[raw_cols].copy())

    # ── Respuesta ─────────────────────────────────────────────────────────────
    result = {
        "hojas":           todas_hojas,
        "hoja_activa":     hoja_activa,
        "kpis":            kpis,
        "por_agencia":     por_agencia,
        "por_tipo_salida": por_tipo_salida,
        "por_nivel":       por_nivel,
        "composicion":     comp_global,
        "tendencia":       tendencia,
        "tabla":           tabla,
        "raw_rows":        raw_rows,
    }
    del df
    gc.collect()
    return JSONResponse(content=jsonable_encoder(result))
