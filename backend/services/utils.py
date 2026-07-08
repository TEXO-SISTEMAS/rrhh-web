"""
utils.py — Funciones de transformación de datos y constantes compartidas.
Migradas desde los módulos Streamlit originales sin modificar la lógica.
"""

import re
from datetime import date

import numpy as np
import pandas as pd
from fastapi import HTTPException, UploadFile

# ══════════════════════════════════════════════════════════════════════════════
# VALIDACIÓN DE ARCHIVOS SUBIDOS
# ══════════════════════════════════════════════════════════════════════════════

ALLOWED_EXTENSIONS = {".xlsx", ".xls"}
MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


async def validar_excel(file: UploadFile) -> bytes:
    """
    Valida que el archivo sea .xlsx o .xls y no supere 10 MB.
    Devuelve los bytes del archivo si es válido.
    Lanza HTTPException 400/413 si no lo es.
    """
    nombre = (file.filename or "").lower()
    if not any(nombre.endswith(ext) for ext in ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no permitido: '{file.filename}'. Solo se aceptan .xlsx o .xls.",
        )
    contents = await file.read()
    if len(contents) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo '{file.filename}' supera el límite de 10 MB.",
        )
    return contents


# ══════════════════════════════════════════════════════════════════════════════
# CONSTANTES Y DICCIONARIOS
# ══════════════════════════════════════════════════════════════════════════════

# ─── Rotación ─────────────────────────────────────────────────────────────────
MESES_MAP = {
    "ENE": 1, "ENERO": 1, "JAN": 1, "JANUARY": 1, "01": 1,
    "FEB": 2, "FEBRERO": 2, "FEBRUARY": 2, "02": 2,
    "MAR": 3, "MARZO": 3, "MARCH": 3, "03": 3,
    "ABR": 4, "ABRIL": 4, "APRIL": 4, "04": 4,
    "MAY": 5, "MAYO": 5, "05": 5,
    "JUN": 6, "JUNIO": 6, "JUNE": 6, "06": 6,
    "JUL": 7, "JULIO": 7, "JULY": 7, "07": 7,
    "AGO": 8, "AGOSTO": 8, "AUGUST": 8, "AUG": 8, "08": 8,
    "SEP": 9, "SEPTIEMBRE": 9, "SEPTEMBER": 9, "09": 9,
    "OCT": 10, "OCTUBRE": 10, "OCTOBER": 10, "10": 10,
    "NOV": 11, "NOVIEMBRE": 11, "NOVEMBER": 11, "11": 11,
    "DIC": 12, "DICIEMBRE": 12, "DECEMBER": 12, "DEC": 12, "12": 12,
}

MESES_NOMBRE = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

CATEGORIAS_MOTIVOS = [
    "Mejor propuesta salarial", "Desarrollo profesional", "Ambiente laboral",
    "Relación con supervisor", "Horario / modalidad de trabajo", "Motivos personales",
    "Carga laboral", "Ubicación / distancia", "Proyectos personales", "Otro",
]

# COL_MAP de Rotación — usado por normalizar_df()
COL_MAP = {
    "SITUACION": "SITUACION", "SITUACIÓN": "SITUACION",
    "CODIGO": "CODIGO", "CÓDIGO": "CODIGO",
    "RAZON_SOCIAL": "NOMBRE", "RAZÓN_SOCIAL": "NOMBRE", "NOMBRE": "NOMBRE",
    "DOC_DE_IDENTIDAD": "CEDULA", "DOCUMENTO": "CEDULA",
    "CARGO": "CARGO",
    "SECCION": "SECCION", "SECCIÓN": "SECCION",
    "DEPARTAMENTO": "DEPARTAMENTO",
    "AREA": "AREA", "ÁREA": "AREA",
    "CENTRO_DE_COSTO": "CENTRO_COSTO",
    "SALARIO": "SALARIO",
    "IPS": "IPS",
    "MES_INGRESO": "MES_INGRESO",
    "ANO_INGRESO": "ANO_INGRESO", "AÑO_INGRESO": "ANO_INGRESO",
    "FECHA_INGRESO": "FECHA_INGRESO",
    "FECHA_ANTIGUEDAD": "FECHA_ANTIGUEDAD", "FECHA_ANTIGÜEDAD": "FECHA_ANTIGUEDAD",
    "FECHA ANTIGUEDAD": "FECHA_ANTIGUEDAD", "FECHA ANTIGÜEDAD": "FECHA_ANTIGUEDAD",
    "TIPO_DE_PAGO_IRP": "TIPO_PAGO",
    "MES_SALIDA": "MES_SALIDA",
    "ANO_SALIDA": "ANO_SALIDA", "AÑO_SALIDA": "ANO_SALIDA",
    "FECHA_SALIDA": "FECHA_SALIDA",
    "MOTIVO_SALIDA": "MOTIVO_SALIDA",
    "TIPO_SALIDA": "TIPO_SALIDA",
}

# COL_MAP de Costos/Liquidaciones
COL_MAP_COSTOS = {
    "#": "NRO",
    "CI_NRO": "CI", "CI": "CI",
    "RAZON_SOCIAL": "NOMBRE", "RAZON_SOCIAL:": "NOMBRE",
    "AGENCIA": "AGENCIA", "EMPRESA": "AGENCIA",
    "NIVEL_AIC": "NIVEL_AIC", "NIVEL": "NIVEL_AIC",
    "INGRESO_IPS": "MES_INGRESO",
    "MES_SALIDA": "MES_SALIDA",
    "FECHA_SALIDA": "FECHA_SALIDA",
    "TIPO_SALIDA": "TIPO_SALIDA",
    "MOTIVO_SALIDA": "MOTIVO_SALIDA",
    "SALARIO_BASE": "SALARIO_BASE",
    "SALARIO_MES": "SALARIO_MES",
    "COMISIONES": "COMISIONES",
    "HORAS_EXTRAS": "HORAS_EXTRAS",
    "BONIF_FAMILIAR": "BONIF_FAMILIAR",
    "VACACIONES_CAUSADAS": "VAC_CAUSADAS",
    "VACACIONES_PROPORCIONALES": "VAC_PROPORCIONALES",
    "INDEMNIZACION": "INDEMNIZACION",
    "PREAVISO": "PREAVISO",
    "GRATIFICACION_EXTRAORDINARIA": "GRATIFICACION",
    "AGUINALDO": "AGUINALDO",
    "TOTAL_BRUTO": "TOTAL_BRUTO",
    "ANTICIPO_DE_SALARIO": "ANTICIPO",
    "OMISION_DE_PREAVISO": "OMISION_PREAVISO",
    "SEGURO_MEDICO": "SEGURO_MEDICO",
    "SMARTFIT": "SMARTFIT",
    "OTROS_DESCUENTOS": "OTROS_DESCUENTOS",
    "PTMO_CUOTAS": "PTMO_CUOTAS",
    "IPS_1": "IPS_1",
    "IPS_SOBRECOSTO": "IPS_SOBRECOSTO",
    "IPS_TOTAL": "IPS_TOTAL",
    "TOTAL_DESCUENTOS": "TOTAL_DESCUENTOS",
    "NETO": "NETO",
    "AP_1": "AP_1",
    "AP_SOBRECOSTO": "AP_SOBRECOSTO",
    "APORTE_PATRONAL": "APORTE_PATRONAL",
    "TOTAL_COSTO": "TOTAL_COSTO",
    "SOBRECOSTO": "SOBRECOSTO",
}

# COL_MAP de Nómina
COL_MAP_NOMINA = {
    "SITUACION": "SITUACION", "SITUACIÓN": "SITUACION",
    "CODIGO": "CODIGO", "CÓDIGO": "CODIGO",
    "RAZON_SOCIAL": "NOMBRE", "RAZÓN_SOCIAL": "NOMBRE",
    "RAZON SOCIAL": "NOMBRE", "RAZÓN SOCIAL": "NOMBRE",
    "DOC_DE_IDENTIDAD": "CEDULA", "DOC DE IDENTIDAD": "CEDULA", "DOCUMENTO": "CEDULA",
    "CARGO": "CARGO",
    "SECCION": "SECCION", "SECCIÓN": "SECCION",
    "DEPARTAMENTO": "DEPARTAMENTO",
    "AREA": "AREA", "ÁREA": "AREA",
    "CENTRO_DE_COSTO": "CENTRO_COSTO", "CENTRO DE COSTO": "CENTRO_COSTO",
    "SALARIO": "SALARIO",
    "IPS": "IPS",
    "FECHA_INGRESO": "FECHA_INGRESO", "FECHA INGRESO": "FECHA_INGRESO",
    "FECHA_ANTIGUEDAD": "FECHA_ANTIGUEDAD", "FECHA ANTIGÜEDAD": "FECHA_ANTIGUEDAD",
    "ANTIGUEDAD": "ANTIGUEDAD", "ANTIGÜEDAD": "ANTIGUEDAD",
    "TIPO_DE_PAGO_IRP": "TIPO_PAGO", "TIPO DE PAGO IRP": "TIPO_PAGO",
    "FECHA_SALIDA": "FECHA_SALIDA", "FECHA SALIDA": "FECHA_SALIDA",
    "MOTIVO_SALIDA": "MOTIVO_SALIDA", "MOTIVO SALIDA": "MOTIVO_SALIDA",
    "NIVEL_AIC": "NIVEL_AIC", "NIVEL AIC": "NIVEL_AIC",
    "FECHA_DE_NACIMIENTO": "FECHA_NACIMIENTO",
    "FECHA DE NACIMIENTO": "FECHA_NACIMIENTO",
    "NACIONALIDAD": "NACIONALIDAD",
    "TIPO_EMPRESA": "TIPO_EMPRESA", "TIPO DE EMPRESA": "TIPO_EMPRESA",
    "DISCAPACIDAD": "DISCAPACIDAD", "TIPO_DISCAPACIDAD": "DISCAPACIDAD",
    "TIPO DE DISCAPACIDAD": "DISCAPACIDAD", "TIPO DISCAPACIDAD": "DISCAPACIDAD",
    # Año de evaluación — variantes normalizadas (sin tilde, uppercase)
    "ANO DE EVALUACION": "ANO_EVALUACION",
    "ANO EVALUACION":    "ANO_EVALUACION",
    "ANO_EVALUACION":    "ANO_EVALUACION",
    "YEAR":              "ANO_EVALUACION",
    "AÑO DE EVALUACION": "ANO_EVALUACION",
    "AÑO EVALUACION":    "ANO_EVALUACION",
}

# ─── Nómina ───────────────────────────────────────────────────────────────────
NIVELES_LIDER = ["SENIOR", "INTERMEDIO"]

GENERACIONES = [
    ("Baby Boomers",  1945, 1964),
    ("Generación X",  1965, 1981),
    ("Millennials",   1982, 1996),
    ("Generación Z",  1997, 2012),
]

# ─── Costos/Liquidaciones ─────────────────────────────────────────────────────
# Orden lógico de niveles AIC — usado por sort_aic()
ORDEN_AIC = ["PASANTE", "PRINCIPIANTE", "JUNIOR", "INTERMEDIO", "SENIOR", "LIDER", "GERENTE"]


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIONES — RECLUTAMIENTO
# ══════════════════════════════════════════════════════════════════════════════

def dias_habiles(inicio, fin):
    try:
        if pd.isnull(inicio) or pd.isnull(fin):
            return None
        return int(np.busday_count(pd.Timestamp(inicio).date(), pd.Timestamp(fin).date()))
    except Exception:
        return None


def normalizar_situacion(val):
    if pd.isnull(val) or str(val).strip().upper() == "NAN":
        return np.nan
    v = str(val).strip().upper()
    if v in ["CERRADO", "CERRADA", "CERRADO/A", "CIERRE"]:    return "CERRADA"
    if v in ["ABIERTO", "ABIERTA", "EN PROCESO", "ACTIVA"]:   return "ABIERTA"
    if v in ["PAUSADO", "PAUSADA", "EN PAUSA", "PAUSA"]:      return "PAUSADA"
    if v in ["CANCELADO", "CANCELADA", "CANCEL"]:             return "CANCELADA"
    return v


def contar_candidatos(val):
    if pd.isnull(val) or str(val).strip() == "" or str(val).strip().upper() == "NAN":
        return 0
    partes = re.split(r'[+,;]', str(val))
    return len([p for p in partes if p.strip()])


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIONES — ROTACIÓN
# ══════════════════════════════════════════════════════════════════════════════

def calcular_tasa_anual(df_filtrado, ano=None):
    """
    Tasa anual = Total salidas del año / Headcount de enero del año * 100
    Enero es el punto de partida: incluye A + I de ese mes (todos los que
    estaban ese mes, ya que los que salen en enero también aparecen ahí).
    Si se filtra por múltiples años, se calcula el promedio ponderado.
    """
    if "ANO_REPORTE" not in df_filtrado.columns or "MES_REPORTE" not in df_filtrado.columns:
        return None
    if "SITUACION" not in df_filtrado.columns:
        return None

    anos = [ano] if ano else df_filtrado["ANO_REPORTE"].unique()
    tasas = []
    for a in anos:
        df_ano = df_filtrado[df_filtrado["ANO_REPORTE"] == a]
        # Salidas del año
        salidas_ano = len(df_ano[df_ano["SITUACION"].str.strip().str.upper() == "I"])
        # Headcount enero = todas las filas del mes 1 (activos + los que salieron en enero)
        hc_enero = len(df_ano[df_ano["MES_REPORTE"] == 1])
        if hc_enero > 0 and salidas_ano > 0:
            tasas.append((salidas_ano / hc_enero * 100, salidas_ano))
    if not tasas:
        return None
    # Promedio ponderado por salidas
    total_sal = sum(t[1] for t in tasas)
    tasa_pond = sum(t[0] * t[1] for t in tasas) / total_sal if total_sal > 0 else None
    return round(tasa_pond, 1) if tasa_pond else None


def detectar_mes(nombre_ficha: str, ia_func=None) -> int:
    """
    Detecta el número de mes desde el nombre de una hoja Excel.
    ia_func: callable opcional que recibe el nombre de la ficha y devuelve
             un int (1-12). Se invoca solo si el mapeo por diccionario falla.
             Si no se provee, devuelve 0 cuando no hay coincidencia.
    """
    nombre_upper = nombre_ficha.upper().strip()
    nombre_limpio = re.sub(r'^M_|^MES_|^SHEET', '', nombre_upper).strip()
    for k, v in MESES_MAP.items():
        if k in nombre_limpio:
            return v
    if ia_func:
        return ia_func(nombre_ficha)
    return 0


def normalizar_df(df_raw: pd.DataFrame, empresa_col: str, mes: int, ano: int) -> pd.DataFrame:
    df = df_raw.copy()
    df.rename(columns={df.columns[0]: "EMPRESA"}, inplace=True)
    df.columns = (df.columns.str.strip().str.upper()
                  .str.replace(" ", "_").str.replace(".", "", regex=False)
                  .str.replace("Á", "A").str.replace("É", "E")
                  .str.replace("Í", "I").str.replace("Ó", "O")
                  .str.replace("Ú", "U").str.replace("Ñ", "N"))
    df.rename(columns={k: v for k, v in COL_MAP.items() if k in df.columns}, inplace=True)
    for col in ["EMPRESA", "SITUACION", "CARGO", "DEPARTAMENTO", "AREA",
                "MOTIVO_SALIDA", "TIPO_SALIDA", "SECCION"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip().str.upper().replace("NAN", np.nan)
    for col in ["FECHA_INGRESO", "FECHA_SALIDA", "FECHA_ANTIGUEDAD"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")
    if "SALARIO" in df.columns:
        df["SALARIO"] = pd.to_numeric(df["SALARIO"], errors="coerce")
    df["MES_REPORTE"] = mes
    df["ANO_REPORTE"] = ano
    df["MES_NOMBRE"] = MESES_NOMBRE.get(mes, str(mes))
    # Permanencia: usa FECHA_ANTIGUEDAD si existe, sino FECHA_INGRESO
    fecha_inicio = None
    if "FECHA_ANTIGUEDAD" in df.columns:
        fecha_inicio = df["FECHA_ANTIGUEDAD"]
    elif "FECHA_INGRESO" in df.columns:
        fecha_inicio = df["FECHA_INGRESO"]
    if fecha_inicio is not None and "FECHA_SALIDA" in df.columns:
        df["MESES_PERMANENCIA"] = ((df["FECHA_SALIDA"] - fecha_inicio)
                                   .dt.days / 30.44).round(1)
    return df


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIONES — COSTOS / LIQUIDACIONES
# ══════════════════════════════════════════════════════════════════════════════

def fmt_gs(val):
    """Formatea en millones o miles para que entre en la card."""
    try:
        v = int(val)
        if abs(v) >= 1_000_000_000:
            return f"₲ {v/1_000_000_000:.1f}B"
        elif abs(v) >= 1_000_000:
            return f"₲ {v/1_000_000:.1f}M"
        elif abs(v) >= 1_000:
            return f"₲ {v/1_000:.1f}K"
        return f"₲ {v:,}".replace(",", ".")
    except Exception:
        return "—"


def sort_aic(df_in, col="NIVEL_AIC"):
    df_in = df_in.copy()
    df_in["_ord"] = df_in[col].apply(
        lambda x: ORDEN_AIC.index(x) if x in ORDEN_AIC else 99)
    return df_in.sort_values("_ord").drop(columns="_ord")


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIONES — NÓMINA
# ══════════════════════════════════════════════════════════════════════════════

def calcular_generacion(fecha_nac):
    try:
        anio = pd.to_datetime(fecha_nac).year
        for nombre, ini, fin in GENERACIONES:
            if ini <= anio <= fin:
                return nombre
        return "Otra"
    except Exception:
        return None


def calcular_edad(fecha_nac):
    try:
        fn = pd.to_datetime(fecha_nac)
        hoy = pd.Timestamp(date.today())
        return int((hoy - fn).days / 365.25)
    except Exception:
        return None
