"""
routers/nomina.py — POST /api/nomina
Recibe un Excel de nómina, normaliza, infiere género con Claude API,
calcula generaciones/liderazgo/brecha salarial y devuelve JSON.
"""

import gc
import io
import json
import os
import re
from datetime import date

import anthropic
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from services.utils import (
    COL_MAP_NOMINA,
    NIVELES_LIDER,
    calcular_edad,
    calcular_generacion,
    validar_excel,
)

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
# INFERENCIA DE SEXO CON CLAUDE API
# (copiado de /streamlit/pages/4_Nomina.py — lógica sin modificar)
# ══════════════════════════════════════════════════════════════════════════════

def limpiar_nombre(n):
    return str(n).replace('"', '').replace("'", "").replace("\n", " ").strip()


def inferir_sexo_lote(nombres_limpios: list) -> dict:
    lista = "\n".join(f"- {n}" for n in nombres_limpios)
    prompt = f"""Tenés una lista de nombres completos de personas de Paraguay/Latinoamérica.
Para cada nombre, determiná si es MASCULINO (M) o FEMENINO (F) basándote en el primer nombre.
En caso de duda usá M.

NOMBRES:
{lista}

Respondé ÚNICAMENTE con un JSON válido. Clave = nombre exacto, valor = "M" o "F".
Sin explicaciones, sin markdown, solo el JSON."""
    r = client.messages.create(
        model="claude-sonnet-4-20250514", max_tokens=2000,
        messages=[{"role": "user", "content": prompt}]
    )
    texto = re.sub(r"```json|```", "", r.content[0].text.strip()).strip()
    return json.loads(texto)


def inferir_sexo_ia(nombres: tuple) -> dict:
    resultado = {}
    lote_size = 50
    nombres_list = list(nombres)
    limpios_list = [limpiar_nombre(n) for n in nombres_list]

    for i in range(0, len(nombres_list), lote_size):
        orig_lote   = nombres_list[i:i + lote_size]
        limpio_lote = limpios_list[i:i + lote_size]
        try:
            mapa = inferir_sexo_lote(limpio_lote)
            for orig, limpio in zip(orig_lote, limpio_lote):
                resultado[orig] = mapa.get(limpio, "M")
        except Exception:
            for orig in orig_lote:
                resultado[orig] = "M"
    return resultado


# ══════════════════════════════════════════════════════════════════════════════
# NORMALIZACIÓN DE NÓMINA
# (copiado de /streamlit/pages/4_Nomina.py — lógica sin modificar)
# ══════════════════════════════════════════════════════════════════════════════

def normalizar_nomina(df_raw: pd.DataFrame) -> pd.DataFrame:
    df = df_raw.copy()
    df.rename(columns={df.columns[0]: "EMPRESA"}, inplace=True)
    df.columns = (
        df.columns.str.strip().str.upper()
        .str.replace("Á", "A").str.replace("É", "E")
        .str.replace("Í", "I").str.replace("Ó", "O")
        .str.replace("Ú", "U").str.replace("Ñ", "N")
    )
    rename_map = {}
    for col in df.columns:
        col_norm = col.strip()
        if col_norm in COL_MAP_NOMINA:
            rename_map[col] = COL_MAP_NOMINA[col_norm]
    df.rename(columns=rename_map, inplace=True)

    for col in ["EMPRESA", "SITUACION", "NOMBRE", "CARGO", "AREA",
                "DEPARTAMENTO", "SECCION", "NIVEL_AIC", "NACIONALIDAD",
                "MOTIVO_SALIDA", "TIPO_PAGO", "TIPO_EMPRESA", "DISCAPACIDAD"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.upper().replace("NAN", np.nan)

    for col in ["FECHA_INGRESO", "FECHA_SALIDA", "FECHA_NACIMIENTO", "FECHA_ANTIGUEDAD"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")

    if "SALARIO" in df.columns:
        df["SALARIO"] = pd.to_numeric(df["SALARIO"], errors="coerce")

    # Filtrar solo activos
    if "SITUACION" in df.columns:
        df = df[df["SITUACION"].str.strip().str.upper() == "A"].copy()

    # Columna LIDER
    if "NIVEL_AIC" in df.columns:
        df["LIDER"] = df["NIVEL_AIC"].apply(
            lambda x: "SI" if str(x).strip().upper() in NIVELES_LIDER else "NO"
        )

    # Columnas GENERACION y EDAD
    if "FECHA_NACIMIENTO" in df.columns:
        df["GENERACION"] = df["FECHA_NACIMIENTO"].apply(calcular_generacion)
        df["EDAD"]       = df["FECHA_NACIMIENTO"].apply(calcular_edad)

    # Antigüedad en años desde fecha ingreso
    if "FECHA_INGRESO" in df.columns:
        hoy = pd.Timestamp(date.today())
        df["ANTIGUEDAD_ANOS"] = ((hoy - df["FECHA_INGRESO"]).dt.days / 365.25).round(1)

    return df


# ══════════════════════════════════════════════════════════════════════════════
# HELPERS DE SERIALIZACIÓN
# ══════════════════════════════════════════════════════════════════════════════

def _safe_records(df: pd.DataFrame) -> list:
    """Convierte un DataFrame a lista de dicts con tipos nativos JSON-safe."""
    # Fechas a string ISO
    for col in df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
        df[col] = df[col].dt.strftime("%Y-%m-%d").where(df[col].notna(), other=None)
    # NaN → None; numpy scalars → Python nativos
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
        return None if np.isnan(f) else round(f, 1)
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT
# ══════════════════════════════════════════════════════════════════════════════

@router.post("")
async def procesar_nomina(file: UploadFile = File(...), ano: int = Form(date.today().year)):
    # ── Leer Excel ────────────────────────────────────────────────────────────
    try:
        contents = await validar_excel(file)
        df_raw = pd.read_excel(io.BytesIO(contents))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="No se pudo leer el archivo. Verificá que sea un Excel válido.")

    # ── Normalizar y filtrar activos ──────────────────────────────────────────
    try:
        df = normalizar_nomina(df_raw)
        del df_raw
        gc.collect()
    except Exception:
        raise HTTPException(status_code=422, detail="Error al procesar el archivo de nómina. Verificá que el formato sea correcto.")

    if df.empty:
        raise HTTPException(status_code=422, detail="No se encontraron colaboradores activos.")

    # ── Año de evaluación ─────────────────────────────────────────────────────
    df["ANO_EVALUACION"] = ano

    # ── Inferir sexo con IA ───────────────────────────────────────────────────
    if "NOMBRE" in df.columns:
        nombres_u = tuple(df["NOMBRE"].dropna().unique())
        if nombres_u:
            mapa_sexo = inferir_sexo_ia(nombres_u)
            df["SEXO"] = df["NOMBRE"].map(mapa_sexo).fillna("M")

    df = df.reset_index(drop=True)
    total = len(df)

    # ══════════════════════════════════════════════════════════════════════════
    # KPIs
    # ══════════════════════════════════════════════════════════════════════════
    empresas_u  = int(df["EMPRESA"].nunique())           if "EMPRESA"   in df.columns else 0
    lideres_n   = int((df["LIDER"] == "SI").sum())       if "LIDER"     in df.columns else 0
    lider_pct   = round(lideres_n / total * 100, 1)      if total > 0   else 0.0
    pct_mujeres = round((df["SEXO"] == "F").sum() / total * 100, 1) if "SEXO" in df.columns and total > 0 else 0.0

    pct_ext = 0.0
    if "NACIONALIDAD" in df.columns and total > 0:
        es_py   = df["NACIONALIDAD"].str.upper().str.contains("PARAGUAY", na=False)
        pct_ext = round((~es_py).sum() / total * 100, 1)

    sal_prom = _safe_float(df["SALARIO"].mean()) if "SALARIO" in df.columns else None

    por_empresa = {}
    if "EMPRESA" in df.columns:
        por_empresa = {str(k): int(v) for k, v in df.groupby("EMPRESA").size().items()}

    agencias_n = 0
    tac_media_n = 0
    csc_n = 0
    if "TIPO_EMPRESA" in df.columns:
        tipo = df["TIPO_EMPRESA"].str.upper().str.strip()
        agencias_n  = int((tipo == "AGENCIA").sum())
        tac_media_n = int((tipo == "TAC MEDIA").sum())
        csc_n       = int((tipo == "CSC").sum())

    kpis = {
        "total":             total,
        "empresas":          empresas_u,
        "lideres":           lideres_n,
        "lider_pct":         lider_pct,
        "pct_mujeres":       pct_mujeres,
        "pct_extranjeros":   pct_ext,
        "salario_promedio":  round(sal_prom, 0) if sal_prom else None,
        "por_empresa":       por_empresa,
        "agencias":          agencias_n,
        "tac_media":         tac_media_n,
        "csc":               csc_n,
    }

    # ══════════════════════════════════════════════════════════════════════════
    # GÉNERO
    # ══════════════════════════════════════════════════════════════════════════
    genero: dict = {}
    if "SEXO" in df.columns:
        genero["labels"] = ["Mujeres", "Hombres"]
        genero["values"] = [int((df["SEXO"] == "F").sum()), int((df["SEXO"] == "M").sum())]

        if "EMPRESA" in df.columns:
            g = (df.groupby(["EMPRESA", "SEXO"]).size()
                   .unstack(fill_value=0).reset_index()
                   .rename(columns={"F": "Mujeres", "M": "Hombres"}))
            g.columns = [str(c) for c in g.columns]
            genero["por_empresa"] = _safe_records(g)

        if "NIVEL_AIC" in df.columns:
            g = (df.groupby(["NIVEL_AIC", "SEXO"]).size()
                   .unstack(fill_value=0).reset_index()
                   .rename(columns={"F": "Mujeres", "M": "Hombres"}))
            g.columns = [str(c) for c in g.columns]
            genero["por_nivel"] = _safe_records(g)

    # ══════════════════════════════════════════════════════════════════════════
    # LIDERAZGO
    # ══════════════════════════════════════════════════════════════════════════
    liderazgo: dict = {}
    if "LIDER" in df.columns:
        lid_df = df[df["LIDER"] == "SI"]

        if "SEXO" in lid_df.columns and not lid_df.empty:
            liderazgo["por_sexo"] = {
                "labels": ["Mujeres", "Hombres"],
                "values": [int((lid_df["SEXO"] == "F").sum()), int((lid_df["SEXO"] == "M").sum())],
            }

            if "NIVEL_AIC" in lid_df.columns:
                g = (lid_df.groupby(["NIVEL_AIC", "SEXO"]).size()
                       .unstack(fill_value=0).reset_index()
                       .rename(columns={"F": "Mujeres", "M": "Hombres"}))
                g.columns = [str(c) for c in g.columns]
                liderazgo["por_nivel_sexo"] = _safe_records(g)

        if "EMPRESA" in df.columns:
            lid_emp = lid_df.groupby("EMPRESA").size().reset_index(name="lideres")
            tot_emp = df.groupby("EMPRESA").size().reset_index(name="total")
            merged  = lid_emp.merge(tot_emp, on="EMPRESA")
            merged["pct_lideres"] = (merged["lideres"] / merged["total"] * 100).round(1)
            liderazgo["pct_por_empresa"] = _safe_records(merged)

    # ══════════════════════════════════════════════════════════════════════════
    # NACIONALIDAD
    # ══════════════════════════════════════════════════════════════════════════
    nacionalidad: dict = {}
    if "NACIONALIDAD" in df.columns:
        es_py      = df["NACIONALIDAD"].str.upper().str.contains("PARAGUAY", na=False)
        total_ext  = int((~es_py).sum())
        total_par  = int(es_py.sum())
        nacionalidad["resumen"] = {
            "labels": ["Paraguayos", "Extranjeros"],
            "values": [total_par, total_ext],
        }
        ext_nac = (df[~es_py]["NACIONALIDAD"].value_counts()
                     .reset_index().rename(columns={"NACIONALIDAD": "Nacionalidad", "count": "Cantidad"}))
        # pandas 2.x value_counts() devuelve columna "count"
        if "count" in ext_nac.columns:
            ext_nac = ext_nac.rename(columns={"count": "Cantidad"})
        nacionalidad["extranjeros_por_nac"] = _safe_records(ext_nac)

        if "EMPRESA" in df.columns:
            ext_emp = (df[~es_py].groupby("EMPRESA").size()
                         .reset_index(name="Extranjeros"))
            nacionalidad["por_empresa"] = _safe_records(ext_emp)

    # ══════════════════════════════════════════════════════════════════════════
    # GENERACIONES
    # ══════════════════════════════════════════════════════════════════════════
    generaciones: dict = {}
    if "GENERACION" in df.columns:
        orden_gen = ["Baby Boomers", "Generación X", "Millennials", "Generación Z", "Otra"]
        gen_count = (df["GENERACION"].value_counts()
                       .reindex(orden_gen).dropna().reset_index()
                       .rename(columns={"GENERACION": "Generacion", "count": "Cantidad"}))
        if "count" in gen_count.columns:
            gen_count = gen_count.rename(columns={"count": "Cantidad"})
        generaciones["distribucion"] = _safe_records(gen_count)

        if "EMPRESA" in df.columns:
            gen_emp = df.groupby(["EMPRESA", "GENERACION"]).size().reset_index(name="n")
            generaciones["por_empresa"] = _safe_records(gen_emp)

        if "SEXO" in df.columns:
            g = (df.groupby(["GENERACION", "SEXO"]).size()
                   .unstack(fill_value=0).reset_index()
                   .rename(columns={"F": "Mujeres", "M": "Hombres"}))
            g.columns = [str(c) for c in g.columns]
            generaciones["por_sexo"] = _safe_records(g)

    if "EDAD" in df.columns:
        generaciones["edades"] = [int(e) for e in df["EDAD"].dropna().tolist()]

    # ══════════════════════════════════════════════════════════════════════════
    # SALARIOS Y BRECHA SALARIAL
    # ══════════════════════════════════════════════════════════════════════════
    brecha_salarial: dict = {}
    if "SALARIO" in df.columns:
        sal = df.dropna(subset=["SALARIO"])

        if "NIVEL_AIC" in sal.columns and not sal.empty:
            sal_nivel = (sal.groupby("NIVEL_AIC")["SALARIO"]
                           .agg(maximo="max", promedio="mean", minimo="min", cantidad="count")
                           .reset_index().rename(columns={"NIVEL_AIC": "nivel"}))
            sal_nivel[["maximo", "promedio", "minimo"]] = sal_nivel[["maximo", "promedio", "minimo"]].round(0)
            brecha_salarial["por_nivel"] = _safe_records(sal_nivel)

            if "SEXO" in sal.columns:
                pivot = (sal.groupby(["NIVEL_AIC", "SEXO"])["SALARIO"]
                            .mean().unstack().reset_index())
                pivot.columns = [str(c) for c in pivot.columns]
                pivot = pivot.rename(columns={"NIVEL_AIC": "nivel", "F": "prom_mujeres", "M": "prom_hombres"})
                if "prom_hombres" in pivot.columns and "prom_mujeres" in pivot.columns:
                    pivot["brecha_pct"] = ((pivot["prom_mujeres"] - pivot["prom_hombres"])
                                           / pivot["prom_hombres"] * 100).round(1)
                brecha_salarial["por_nivel_sexo"] = _safe_records(pivot)

        if "EMPRESA" in sal.columns and not sal.empty:
            sal_emp = (sal.groupby("EMPRESA")["SALARIO"].mean()
                         .reset_index().rename(columns={"EMPRESA": "empresa", "SALARIO": "promedio"}))
            sal_emp["promedio"] = sal_emp["promedio"].round(0)
            brecha_salarial["por_empresa"] = _safe_records(sal_emp)

        if "SEXO" in sal.columns:
            h = sal[sal["SEXO"] == "M"]["SALARIO"]
            f = sal[sal["SEXO"] == "F"]["SALARIO"]
            brecha_salarial["prom_hombres_global"] = round(float(h.mean()), 0) if not h.empty else None
            brecha_salarial["prom_mujeres_global"] = round(float(f.mean()), 0) if not f.empty else None

    # ══════════════════════════════════════════════════════════════════════════
    # TABLA DETALLE
    # ══════════════════════════════════════════════════════════════════════════
    tabla_cols = [c for c in [
        "ANO_EVALUACION",
        "EMPRESA", "TIPO_EMPRESA", "NOMBRE", "CEDULA", "CARGO", "AREA", "DEPARTAMENTO", "SECCION",
        "NIVEL_AIC", "LIDER", "SEXO", "GENERACION", "EDAD", "NACIONALIDAD",
        "DISCAPACIDAD", "SALARIO", "FECHA_INGRESO", "ANTIGUEDAD_ANOS", "SITUACION",
    ] if c in df.columns]

    tabla = _safe_records(df[tabla_cols].copy())

    # ── Respuesta ─────────────────────────────────────────────────────────────
    result = {
        "kpis":           kpis,
        "genero":         genero,
        "liderazgo":      liderazgo,
        "nacionalidad":   nacionalidad,
        "generaciones":   generaciones,
        "brecha_salarial": brecha_salarial,
        "tabla":          tabla,
    }
    del df
    gc.collect()
    return JSONResponse(content=jsonable_encoder(result))
