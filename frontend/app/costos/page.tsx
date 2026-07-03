"use client";

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from "react";
import KpiCard from "@/components/KpiCard";
import PlotChart, { LIGHT_COLOR_SEQ } from "@/components/PlotChart";
import TabBar from "@/components/TabBar";
import DataTable from "@/components/DataTable";
import { useDashboard } from "@/context/DashboardContext";
import { useFilter } from "@/context/FilterContext";
import { authHeaders } from "@/lib/auth";
import { Row, sumField, groupBy, fmtGs, applyFilters, FilterConfig } from "@/lib/filterUtils";

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const FILTER_CONFIGS: FilterConfig[] = [
  { label: "Año",           field: "ANO_SALIDA" },
  { label: "Agencia",       field: "AGENCIA" },
  { label: "Nivel AIC",     field: "NIVEL_AIC" },
  { label: "Tipo Salida",   field: "TIPO_SALIDA" },
  { label: "Motivo Salida", field: "MOTIVO_SALIDA" },
];

const CONCEPTOS: [string, string][] = [
  ["Salario Base",        "SALARIO_BASE"],
  ["Vac. Causadas",       "VAC_CAUSADAS"],
  ["Vac. Proporcionales", "VAC_PROPORCIONALES"],
  ["Indemnización",       "INDEMNIZACION"],
  ["Preaviso",            "PREAVISO"],
  ["Aguinaldo",           "AGUINALDO"],
  ["Gratificación",       "GRATIFICACION"],
  ["Comisiones",          "COMISIONES"],
  ["Horas Extras",        "HORAS_EXTRAS"],
  ["Bonif. Familiar",     "BONIF_FAMILIAR"],
  ["IPS Total",           "IPS_TOTAL"],
  ["Sobrecosto",          "SOBRECOSTO"],
];

function defaultLatestYear(rows: Row[]): Record<string, string[]> {
  const years = Array.from(new Set(rows.map((r) => String(r.ANO_SALIDA ?? "")).filter(Boolean))).sort();
  const latest = years[years.length - 1];
  return latest ? { ANO_SALIDA: [latest] } : {};
}

function agColors(n: number) {
  return Array.from({ length: n }, (_, i) => LIGHT_COLOR_SEQ[i % LIGHT_COLOR_SEQ.length]);
}

// Color fijo por concepto (mismo orden que CONCEPTOS)
const CONCEPT_COLORS = [
  "#7C3AED","#059669","#0891B2","#D97706","#DC2626",
  "#65A30D","#C2410C","#0F766E","#2563EB","#4338CA",
  "#7C3AED","#64748b",
];

const TABS = [
  { id: "agencia",      label: "Por Agencia",          icon: "🏢" },
  { id: "composicion",  label: "Composición de Costos", icon: "🌿" },
  { id: "comparacion",  label: "Comparación",           icon: "⚖️" },
  { id: "detalle",      label: "Detalle",               icon: "📄" },
];

function computeFromRows(rows: Row[]) {
  const kpis = {
    total_liquidaciones: rows.length,
    sobrecosto_fmt:      fmtGs(sumField(rows, "SOBRECOSTO")),
    total_costo_fmt:     fmtGs(sumField(rows, "TOTAL_COSTO")),
    total_bruto_fmt:     fmtGs(sumField(rows, "TOTAL_BRUTO")),
    total_neto_fmt:      fmtGs(sumField(rows, "NETO")),
    aporte_patronal_fmt: fmtGs(sumField(rows, "APORTE_PATRONAL")),
  };

  // ── Por Agencia ─────────────────────────────────────────────────────────
  const agMap   = groupBy(rows, "AGENCIA");
  const agSob   = Object.entries(agMap)
    .map(([ag, r]) => ({ AGENCIA: ag, SOBRECOSTO: sumField(r, "SOBRECOSTO") }))
    .sort((a, b) => a.SOBRECOSTO - b.SOBRECOSTO);
  const agCant  = Object.entries(agMap)
    .map(([ag, r]) => ({ AGENCIA: ag, cantidad: r.length }))
    .sort((a, b) => a.cantidad - b.cantidad);
  const agProm  = Object.entries(agMap)
    .map(([ag, r]) => ({ AGENCIA: ag, prom: r.length ? sumField(r, "SOBRECOSTO") / r.length : 0 }))
    .sort((a, b) => b.prom - a.prom);

  // ── Composición ─────────────────────────────────────────────────────────
  const comp = CONCEPTOS
    .map(([label, field], i) => ({ label, value: sumField(rows, field), color: CONCEPT_COLORS[i] }))
    .filter((c) => c.value > 0)
    .sort((a, b) => a.value - b.value); // ascending for horizontal bar
  const composicion = comp.length > 0
    ? { labels: comp.map((c) => c.label), values: comp.map((c) => c.value), colors: comp.map((c) => c.color) }
    : null;

  const agencias = Object.keys(agMap).sort();
  const compPorAgencia = CONCEPTOS
    .map(([label, field], i) => ({
      type: "bar" as const,
      name: label,
      x: agencias,
      y: agencias.map((ag) => sumField(agMap[ag] ?? [], field)),
      marker: { color: CONCEPT_COLORS[i] },
    }))
    .filter((trace) => trace.y.some((v) => v > 0));

  // ── Por Tipo / Motivo ───────────────────────────────────────────────────
  const tipoMap  = groupBy(rows, "TIPO_SALIDA");
  const tipoData = Object.keys(tipoMap).length > 0
    ? { labels: Object.keys(tipoMap), values: Object.values(tipoMap).map((r) => sumField(r, "SOBRECOSTO")) }
    : null;
  const tipoProm = Object.entries(tipoMap)
    .map(([tipo, r]) => ({ tipo, prom: r.length ? sumField(r, "SOBRECOSTO") / r.length : 0 }));

  const motivoMap  = groupBy(rows, "MOTIVO_SALIDA");
  const top10motivo = Object.entries(motivoMap)
    .map(([motivo, r]) => ({ motivo, sobrecosto: sumField(r, "SOBRECOSTO") }))
    .sort((a, b) => b.sobrecosto - a.sobrecosto)
    .slice(0, 10);

  const agSobDesc = Object.entries(agMap)
    .map(([ag, r]) => ({ AGENCIA: ag, SOBRECOSTO: sumField(r, "SOBRECOSTO") }))
    .sort((a, b) => b.SOBRECOSTO - a.SOBRECOSTO);

  const nivMap   = groupBy(rows, "NIVEL_AIC");
  const nivCosto = Object.entries(nivMap)
    .map(([n, r]) => ({ nivel: n, total_costo: sumField(r, "TOTAL_COSTO") }));
  const nivCant  = Object.entries(nivMap)
    .map(([n, r]) => ({ nivel: n, cantidad: r.length }));
  const nivSob   = Object.entries(nivMap)
    .map(([n, r]) => ({ nivel: n, sobrecosto: sumField(r, "SOBRECOSTO") }));
  const nivProm  = Object.entries(nivMap)
    .map(([n, r]) => ({ nivel: n, prom: r.length ? sumField(r, "TOTAL_COSTO") / r.length : 0 }));
  const nivComp  = Object.entries(nivMap)
    .map(([n, r]) => ({ nivel: n, total_costo: sumField(r, "TOTAL_COSTO"), sobrecosto: sumField(r, "SOBRECOSTO") }));

  // ── Costos Mensuales ────────────────────────────────────────────────────
  const MESES_FULL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Setiembre","Octubre","Noviembre","Diciembre"];
  const MES_COLORS = ["#4472c4","#ed7d31","#a5a5a5","#ffc000","#5b9bd5","#70ad47","#264478","#9e480e","#636363","#997300","#255e91","#375623"];
  const mesMap = groupBy(rows, "MES_SALIDA_N");
  const costoMensual = MESES_FULL
    .map((mes, i) => ({ mes, total: sumField(mesMap[String(i + 1)] ?? [], "TOTAL_COSTO"), color: MES_COLORS[i] }))
    .filter((m) => m.total !== 0);

  // ── Tendencia ───────────────────────────────────────────────────────────
  const MESES_NOMBRE: Record<number, string> = {
    1:"Ene",2:"Feb",3:"Mar",4:"Abr",5:"May",6:"Jun",
    7:"Jul",8:"Ago",9:"Sep",10:"Oct",11:"Nov",12:"Dic",
  };
  const anoMap = groupBy(rows, "ANO_SALIDA");
  const sobAno = Object.entries(anoMap)
    .map(([ano, r]) => ({ ano: String(ano), sobrecosto: sumField(r, "SOBRECOSTO") }))
    .sort((a, b) => a.ano.localeCompare(b.ano));
  const liqAno = Object.entries(anoMap)
    .map(([ano, r]) => ({ ano: String(ano), liquidaciones: r.length }))
    .sort((a, b) => a.ano.localeCompare(b.ano));

  // Evolución mensual del sobrecosto (una traza por año)
  const sobMensual = (() => {
    const byAnoMes: Record<string, Record<number, number>> = {};
    for (const r of rows) {
      const ano = String(r.ANO_SALIDA ?? "");
      const mes = Number(r.MES_SALIDA_N);
      if (!ano || isNaN(mes) || mes < 1 || mes > 12) continue;
      byAnoMes[ano] = byAnoMes[ano] ?? {};
      byAnoMes[ano][mes] = (byAnoMes[ano][mes] ?? 0) + (Number(r.SOBRECOSTO) || 0);
    }
    return Object.entries(byAnoMes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ano, meses]) => {
        const sorted = Object.keys(meses).map(Number).sort((a, b) => a - b);
        return {
          type: "scatter" as const,
          mode: "lines+markers" as const,
          name: ano,
          x: sorted.map((m) => MESES_NOMBRE[m]),
          y: sorted.map((m) => meses[m]),
        };
      });
  })();

  return { kpis, agSob, agSobDesc, agCant, agProm, composicion, compPorAgencia, tipoData, tipoProm, top10motivo, nivCosto, nivCant, nivSob, nivProm, nivComp, sobAno, liqAno, sobMensual, costoMensual };
}

function ChartCard({ title, children, fullWidth }: { title: string; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`chart-card${fullWidth ? " md:col-span-2" : ""}`}>
      <h3 className="chart-title mb-4">{title}</h3>
      {children}
    </div>
  );
}

function UploadIllustration() {
  return (
    <svg width="140" height="100" viewBox="0 0 140 100" fill="none">
      <ellipse cx="70" cy="72" rx="28" ry="8" fill="#1a1f2e" stroke="#2d3748" strokeWidth="1.5" />
      <rect x="42" y="52" width="56" height="20" rx="2" fill="#1a1f2e" stroke="#2d3748" strokeWidth="1.5" />
      <ellipse cx="70" cy="52" rx="28" ry="8" fill="#1a1f2e" stroke="#2d3748" strokeWidth="1.5" />
      <rect x="42" y="36" width="56" height="16" rx="2" fill="#1a1f2e" stroke="#2d3748" strokeWidth="1.5" />
      <ellipse cx="70" cy="36" rx="28" ry="8" fill="#4f8ef7" opacity="0.25" stroke="#4f8ef7" strokeWidth="1" strokeOpacity="0.4" />
      <text x="70" y="40" textAnchor="middle" fontSize="10" fill="#4f8ef7" opacity="0.7" fontWeight="bold">₲</text>
      <path d="M105 28V16M101 20l4-4 4 4" stroke="#4f8ef7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

export default function CostosPage() {
  const { costosData, setCostosData, hydrating } = useDashboard();
  const { selected, register } = useFilter();
  const [data, setData]               = useState<AnyObj | null>(null);
  const [storedFiles, setStoredFiles] = useState<File[]>([]);
  const [hojas, setHojas]             = useState<string[]>([]);
  const [hojaActiva, setHojaActiva]   = useState<string>("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [dragging, setDragging]       = useState(false);
  const [activeTab, setActiveTab]     = useState("agencia");
  const [showUpload, setShowUpload]   = useState(false);
  const [anoUpload, setAnoUpload]     = useState("2025");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (costosData && !data) {
      setData(costosData);
      setHojas((costosData.hojas as string[]) ?? []);
      setHojaActiva((costosData.hoja_activa as string) ?? "");
      const rows = (costosData.raw_rows as Row[]) ?? [];
      register(FILTER_CONFIGS, rows, defaultLatestYear(rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costosData]);

  async function postFiles(files: File[], hoja?: string, prevData?: AnyObj | null) {
    setLoading(true);
    setError(null);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (hoja) form.append("hoja", hoja);
    form.append("ano", anoUpload || String(new Date().getFullYear()));
    try {
      const res = await fetch(`${API_URL}/api/costos`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail?.detail ?? `Error ${res.status}`);
      }
      const json = await res.json();
      let merged = json;
      if (prevData) {
        const newRows = (json.raw_rows as Row[]) ?? [];
        const newYears = new Set(newRows.map((r) => String(r.ANO_SALIDA ?? "")));
        const existingRows = (prevData.raw_rows as Row[]) ?? [];
        merged = { ...json, raw_rows: [...existingRows.filter((r) => !newYears.has(String(r.ANO_SALIDA ?? ""))), ...newRows] };
      }
      setData(merged);
      setCostosData(merged);
      setHojas(merged.hojas ?? []);
      setHojaActiva(merged.hoja_activa ?? "");
      setActiveTab("agencia");
      setShowUpload(false);
      const allRows = (merged.raw_rows as Row[]) ?? [];
      register(FILTER_CONFIGS, allRows, defaultLatestYear(allRows));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  function handleFiles(files: FileList) {
    const arr = Array.from(files);
    const prevData = data;
    setStoredFiles(arr);
    setData(null);
    setHojas([]);
    setHojaActiva("");
    postFiles(arr, undefined, prevData);
  }

  function handleHojaChange(h: string) {
    if (!storedFiles.length || h === hojaActiva) return;
    postFiles(storedFiles, h);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) handleFiles(e.target.files);
  }

  // ── Sin datos ─────────────────────────────────────────────────────────────
  if (hydrating && !data) {
    return (
      <div className="flex items-center justify-center min-h-[72vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4f8ef7] border-t-transparent" />
      </div>
    );
  }

  if (!data && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[72vh] gap-6">
        <div className="text-center">
          <p className="label-xs mb-2" style={{ color: "var(--accent)" }}>Módulo de Costos</p>
          <h1 className="page-title">Análisis de Costos de Liquidaciones</h1>
          <p className="mt-2 text-sm max-w-sm mx-auto" style={{ color: "var(--text2)" }}>
            Subí uno o más archivos Excel de liquidaciones para analizar sobrecostos, composición de egresos y tendencias por agencia.
          </p>
        </div>
        <div className="w-full max-w-md">
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors select-none"
            style={{
              borderColor: dragging ? "var(--accent)" : "var(--border)",
              background: dragging ? "rgba(124,90,246,0.08)" : "var(--card)",
            }}
          >
            <svg className="w-10 h-10" style={{ color: dragging ? "var(--accent)" : "var(--text3)" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.032A4.5 4.5 0 0 1 17.25 19.5H6.75Z" />
            </svg>
            <p className="text-sm text-center" style={{ color: "var(--text)" }}>Arrastrá los archivos Excel aquí o hacé clic para seleccionar</p>
            <p className="text-xs" style={{ color: "var(--text3)" }}>Formatos: .xlsx .xls</p>
            <input ref={inputRef} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={handleChange} />
          </div>
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-sm" style={{ border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
              <svg className="mt-0.5 w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Cargando ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[72vh] gap-4">
        <svg className="animate-spin w-8 h-8" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm" style={{ color: "var(--text2)" }}>Procesando liquidaciones…</p>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const rawRows: Row[]   = (data!.raw_rows as Row[]) ?? [];
  const filteredRows     = applyFilters(rawRows, selected);
  const { kpis, agSob, agSobDesc, agCant, agProm, composicion, compPorAgencia, tipoData, tipoProm, top10motivo, nivCosto, nivCant, nivSob, nivProm, nivComp, sobAno, liqAno, sobMensual, costoMensual } =
    computeFromRows(filteredRows);

  // ── Comparación ───────────────────────────────────────────────────────────
  const anosDisponiblesCos = Array.from(new Set(rawRows.map((r) => String(r.ANO_SALIDA ?? "")).filter(Boolean))).sort();
  const compDataCos = Object.fromEntries(
    anosDisponiblesCos.map((ano) => [ano, computeFromRows(rawRows.filter((r) => String(r.ANO_SALIDA ?? "") === ano))])
  );
  const YEAR_COLORS_COS: Record<string, string> = {
    [anosDisponiblesCos[0]]: "#0d9488",
    [anosDisponiblesCos[1]]: "#6366f1",
    [anosDisponiblesCos[2]]: "#f59e0b",
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="label-xs mb-1" style={{ color: "var(--accent)" }}>Módulo de Costos</p>
          <h1 className="page-title">Costos de Liquidaciones</h1>
        </div>
        <button
          onClick={() => setShowUpload((v) => !v)}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text2)"; }}
        >
          Actualizar datos
        </button>
      </div>

      {showUpload && (
        <div className="mb-6 rounded-xl p-4" style={{ border: "1px solid var(--accent)", background: "var(--card)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Cargar nuevos datos de costos</p>
            <button onClick={() => { setShowUpload(false); setError(null); }} className="text-xs transition" style={{ color: "var(--text3)" }}>Cancelar</button>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--text2)" }}>
              Año del archivo <span style={{ color: "#f43f5e" }}>*</span>
            </label>
            <input
              type="number"
              value={anoUpload}
              onChange={(e) => setAnoUpload(e.target.value)}
              placeholder="2025"
              className="w-48 rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--card2)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors select-none"
            style={{
              borderColor: dragging ? "var(--accent)" : "var(--border)",
              background: dragging ? "rgba(124,90,246,0.08)" : "var(--card2)",
            }}
          >
            <svg className="w-10 h-10" style={{ color: dragging ? "var(--accent)" : "var(--text3)" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.032A4.5 4.5 0 0 1 17.25 19.5H6.75Z" />
            </svg>
            <p className="text-sm text-center" style={{ color: "var(--text)" }}>Arrastrá los archivos Excel aquí o hacé clic para seleccionar</p>
            <p className="text-xs" style={{ color: "var(--text3)" }}>Formatos: .xlsx .xls</p>
            <input ref={inputRef} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={handleChange} />
          </div>
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-sm" style={{ border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
              <span>{error}</span>
            </div>
          )}
        </div>
      )}


      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard title="Liquidaciones"   value={kpis.total_liquidaciones} />
        <KpiCard title="Sobrecosto"      value={kpis.sobrecosto_fmt} />
        <KpiCard title="Costo Total"     value={kpis.total_costo_fmt} />
        <KpiCard title="Total Bruto"     value={kpis.total_bruto_fmt} />
        <KpiCard title="Neto"            value={kpis.total_neto_fmt} />
        <KpiCard title="Aporte Patronal" value={kpis.aporte_patronal_fmt} />
      </div>

      {/* Tabs */}
      <TabBar tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} active={activeTab} onChange={setActiveTab} />

      {/* ── Tab: Por Agencia ─────────────────────────────────────────────── */}
      {activeTab === "agencia" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {agSob.length > 0 && (
              <ChartCard title="Costos por Agencia">
                <PlotChart
                  light
                  data={[{
                    type: "bar",
                    x: agSob.map((r) => r.AGENCIA),
                    y: agSob.map((r) => r.SOBRECOSTO),
                    marker: {
                      color: agSob.map((r) => r.SOBRECOSTO),
                      colorscale: [[0, "#fecaca"], [1, "#DC2626"]] as [number, string][],
                      showscale: false,
                    },
                  }]}
                  layout={{ xaxis: { title: { text: "Agencia" } }, yaxis: { title: { text: "Costo" } }, margin: { t: 8, r: 16, b: 60, l: 80 } }}
                  height={340}
                />
              </ChartCard>
            )}
            {agCant.length > 0 && (
              <ChartCard title="Cantidad de Liquidaciones por Agencia">
                <PlotChart
                  light
                  data={[{
                    type: "bar", orientation: "h",
                    x: agCant.map((r) => r.cantidad),
                    y: agCant.map((r) => r.AGENCIA),
                    marker: { color: agColors(agCant.length) },
                  }]}
                  layout={{ xaxis: { title: { text: "Cantidad" } }, yaxis: { title: { text: "AGENCIA" } }, margin: { t: 8, r: 16, b: 48, l: 100 } }}
                  height={340}
                />
              </ChartCard>
            )}
          </div>

          {costoMensual.length > 0 && (
            <ChartCard title="Costos Mensuales" fullWidth>
              <PlotChart
                light
                data={costoMensual.map((m) => ({
                  type: "bar" as const,
                  name: m.mes,
                  x: [m.mes],
                  y: [m.total],
                  marker: { color: m.color },
                  text: [fmtGs(m.total)],
                  textposition: "outside" as const,
                }))}
                layout={{ barmode: "group", showlegend: true, xaxis: { title: { text: "Mes" } }, yaxis: { title: { text: "Costo Total" } }, margin: { t: 32, r: 16, b: 60, l: 80 }, legend: { orientation: "h", y: -0.25 } }}
                height={420}
              />
            </ChartCard>
          )}

          {/* Análisis por Nivel AIC */}
          {(nivCosto.length > 0 || nivCant.length > 0) && (
            <div>
              <p className="label-xs mb-3 mt-2" style={{ color: "var(--accent)" }}>Análisis por Nivel AIC</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {nivCosto.length > 0 && (
                <ChartCard title="Costo Total de Liquidaciones por Nivel AIC">
                  <PlotChart
                    light
                    data={[{
                      type: "bar",
                      x: nivCosto.map((r) => r.nivel),
                      y: nivCosto.map((r) => r.total_costo),
                      marker: { color: agColors(nivCosto.length) },
                      text: nivCosto.map((r) => fmtGs(r.total_costo)),
                      textposition: "outside" as const,
                    }]}
                    layout={{ xaxis: { title: { text: "Nivel AIC" } }, yaxis: { title: { text: "Total Costo" } }, margin: { t: 32, r: 16, b: 48, l: 80 } }}
                    height={320}
                  />
                </ChartCard>
              )}
              {nivCant.length > 0 && (
                <ChartCard title="Cantidad de Liquidaciones por Nivel AIC">
                  <PlotChart
                    light
                    data={[{
                      type: "bar",
                      x: nivCant.map((r) => r.nivel),
                      y: nivCant.map((r) => r.cantidad),
                      marker: { color: agColors(nivCant.length) },
                      text: nivCant.map((r) => String(r.cantidad)),
                      textposition: "outside" as const,
                    }]}
                    layout={{ xaxis: { title: { text: "Nivel AIC" } }, yaxis: { title: { text: "Cantidad" } }, margin: { t: 32, r: 16, b: 48, l: 80 } }}
                    height={320}
                  />
                </ChartCard>
              )}
              {nivSob.length > 0 && (
                <ChartCard title="⚠️ Sobrecosto por Nivel AIC (impacto financiero de desvinculaciones)">
                  <PlotChart
                    light
                    data={[{
                      type: "bar",
                      x: nivSob.map((r) => r.nivel),
                      y: nivSob.map((r) => r.sobrecosto),
                      marker: {
                        color: nivSob.map((r) => r.sobrecosto),
                        colorscale: [[0, "#fecaca"], [1, "#DC2626"]] as [number, string][],
                        showscale: false,
                      },
                      text: nivSob.map((r) => fmtGs(r.sobrecosto)),
                      textposition: "outside" as const,
                    }]}
                    layout={{ xaxis: { title: { text: "Nivel AIC" } }, yaxis: { title: { text: "Sobrecosto" } }, margin: { t: 32, r: 16, b: 48, l: 80 } }}
                    height={320}
                  />
                </ChartCard>
              )}
              {nivProm.length > 0 && (
                <ChartCard title="Costo Promedio por Liquidación según Nivel AIC">
                  <PlotChart
                    light
                    data={[{
                      type: "bar",
                      x: nivProm.map((r) => r.nivel),
                      y: nivProm.map((r) => r.prom),
                      marker: { color: agColors(nivProm.length) },
                      text: nivProm.map((r) => fmtGs(r.prom)),
                      textposition: "outside" as const,
                    }]}
                    layout={{ xaxis: { title: { text: "Nivel AIC" } }, yaxis: { title: { text: "Costo Promedio" } }, margin: { t: 32, r: 16, b: 48, l: 80 } }}
                    height={320}
                  />
                </ChartCard>
              )}
              {nivComp.length > 0 && (
                <ChartCard title="Costo Total vs Sobrecosto por Nivel AIC" fullWidth>
                  <PlotChart
                    light
                    data={[
                      { type: "bar", name: "Costo Total", x: nivComp.map((r) => r.nivel), y: nivComp.map((r) => r.total_costo), marker: { color: "#2563EB" } },
                      { type: "bar", name: "Sobrecosto",  x: nivComp.map((r) => r.nivel), y: nivComp.map((r) => r.sobrecosto),  marker: { color: "#DC2626" } },
                    ]}
                    layout={{ barmode: "group", xaxis: { title: { text: "Nivel AIC" } }, yaxis: { title: { text: "Monto" } }, margin: { t: 8, r: 16, b: 48, l: 80 } }}
                    height={340}
                  />
                </ChartCard>
              )}
            </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Composición de Costos ────────────────────────────────────── */}
      {activeTab === "composicion" && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {composicion && (
              <ChartCard title="Composición del Costo Total">
                <PlotChart
                  light
                  data={[{ type: "pie", labels: composicion.labels, values: composicion.values, hole: 0.4, textinfo: "label+percent", textposition: "outside", textfont: { color: "#1e293b" }, marker: { colors: composicion.colors } }]}
                  layout={{ margin: { t: 16, r: 16, b: 16, l: 16 } }}
                  height={380}
                />
              </ChartCard>
            )}
            {composicion && (
              <ChartCard title="Monto por Concepto">
                <PlotChart
                  light
                  data={[{
                    type: "bar", orientation: "h",
                    x: composicion.values,
                    y: composicion.labels,
                    marker: { color: composicion.colors },
                  }]}
                  layout={{ xaxis: { title: { text: "Monto" } }, yaxis: { title: { text: "Concepto" } }, margin: { t: 8, r: 16, b: 48, l: 160 } }}
                  height={380}
                />
              </ChartCard>
            )}
          </div>

          {compPorAgencia.length > 0 && (
            <ChartCard title="Composición del Costo por Agencia" fullWidth>
              <PlotChart
                light
                data={compPorAgencia}
                layout={{ barmode: "stack", xaxis: { title: { text: "AGENCIA" } }, yaxis: { title: { text: "Monto" } }, margin: { t: 8, r: 200, b: 60, l: 80 }, legend: { x: 1.02, y: 1 } }}
                height={420}
              />
            </ChartCard>
          )}
        </div>
      )}

      {/* ── Tab: Por Tipo / Motivo ────────────────────────────────────────── */}

      {/* ── Tab: Comparación ─────────────────────────────────────────────── */}
      {activeTab === "comparacion" && (
        <div className="space-y-5">
          {anosDisponiblesCos.length < 2 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <p className="text-4xl">📂</p>
              <p className="text-sm" style={{ color: "var(--text2)" }}>
                Subí datos de al menos dos años para comparar.
              </p>
            </div>
          ) : (
            <>
              {/* KPI cards por año */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {anosDisponiblesCos.map((ano) => {
                  const d = compDataCos[ano];
                  return (
                    <div key={ano} className="rounded-xl p-4 space-y-2" style={{ background: "var(--card)", border: `1px solid ${YEAR_COLORS_COS[ano] ?? "var(--border)"}` }}>
                      <p className="text-xs font-semibold" style={{ color: YEAR_COLORS_COS[ano] ?? "var(--text2)" }}>{ano}</p>
                      <p className="text-lg font-bold" style={{ color: "var(--text)" }}>{d?.kpis.sobrecosto_fmt ?? "—"}</p>
                      <p className="text-xs" style={{ color: "var(--text2)" }}>Sobrecosto</p>
                      <div className="flex gap-4 pt-1">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{d?.kpis.total_liquidaciones ?? 0}</p>
                          <p className="text-xs" style={{ color: "var(--text3)" }}>Liquidaciones</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{d?.kpis.total_costo_fmt ?? "—"}</p>
                          <p className="text-xs" style={{ color: "var(--text3)" }}>Costo Total</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sobrecosto por Agencia — barras agrupadas */}
              {(() => {
                const agencias = Array.from(new Set(rawRows.map((r) => String(r.AGENCIA ?? "")).filter(Boolean))).sort();
                const traces = anosDisponiblesCos.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: agencias,
                  y: agencias.map((ag) => {
                    const rows = rawRows.filter((r) => String(r.ANO_SALIDA ?? "") === ano && String(r.AGENCIA ?? "") === ag);
                    return rows.reduce((s, r) => s + (Number(r.SOBRECOSTO) || 0), 0);
                  }),
                  marker: { color: YEAR_COLORS_COS[ano] },
                }));
                return agencias.length > 0 ? (
                  <ChartCard title="Sobrecosto por Agencia — Comparación Anual" fullWidth>
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Agencia" } }, yaxis: { title: { text: "Sobrecosto" } }, margin: { t: 8, r: 16, b: 60, l: 80 }, showlegend: true }}
                      height={360}
                    />
                  </ChartCard>
                ) : null;
              })()}

              {/* Liquidaciones por Agencia — barras agrupadas */}
              {(() => {
                const agencias = Array.from(new Set(rawRows.map((r) => String(r.AGENCIA ?? "")).filter(Boolean))).sort();
                const traces = anosDisponiblesCos.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: agencias,
                  y: agencias.map((ag) => rawRows.filter((r) => String(r.ANO_SALIDA ?? "") === ano && String(r.AGENCIA ?? "") === ag).length),
                  marker: { color: YEAR_COLORS_COS[ano] },
                }));
                return agencias.length > 0 ? (
                  <ChartCard title="Cantidad de Liquidaciones por Agencia — Comparación Anual" fullWidth>
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Agencia" } }, yaxis: { title: { text: "Liquidaciones" } }, margin: { t: 8, r: 16, b: 60, l: 80 }, showlegend: true }}
                      height={340}
                    />
                  </ChartCard>
                ) : null;
              })()}

              {/* Evolución mensual sobrecosto */}
              {compDataCos[anosDisponiblesCos[0]]?.sobMensual && (
                <ChartCard title="Evolución Mensual del Sobrecosto" fullWidth>
                  <PlotChart
                    light
                    data={anosDisponiblesCos.flatMap((ano) =>
                      (compDataCos[ano]?.sobMensual ?? []).map((t) => ({ ...t, name: ano, line: { color: YEAR_COLORS_COS[ano] } }))
                    )}
                    layout={{ showlegend: true, xaxis: { title: { text: "Mes" } }, yaxis: { title: { text: "Sobrecosto" } }, margin: { t: 8, r: 16, b: 60, l: 80 } }}
                    height={360}
                  />
                </ChartCard>
              )}

              {/* Sobrecosto por Nivel AIC — barras agrupadas */}
              {(() => {
                const niveles = Array.from(new Set(rawRows.map((r) => String(r.NIVEL_AIC ?? "")).filter(Boolean))).sort();
                if (!niveles.length) return null;
                const traces = anosDisponiblesCos.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: niveles,
                  y: niveles.map((niv) => rawRows.filter((r) => String(r.ANO_SALIDA ?? "") === ano && String(r.NIVEL_AIC ?? "") === niv).reduce((s, r) => s + (Number(r.SOBRECOSTO) || 0), 0)),
                  marker: { color: YEAR_COLORS_COS[ano] },
                }));
                return (
                  <ChartCard title="Sobrecosto por Nivel AIC — Comparación Anual">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Nivel AIC" } }, yaxis: { title: { text: "Sobrecosto" } }, margin: { t: 8, r: 16, b: 48, l: 80 }, showlegend: true }}
                      height={340}
                    />
                  </ChartCard>
                );
              })()}

              {/* Tipo de Salida — barras agrupadas */}
              {(() => {
                const tipos = Array.from(new Set(rawRows.map((r) => String(r.TIPO_SALIDA ?? "")).filter(Boolean))).sort();
                if (!tipos.length) return null;
                const traces = anosDisponiblesCos.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: tipos,
                  y: tipos.map((t) => rawRows.filter((r) => String(r.ANO_SALIDA ?? "") === ano && String(r.TIPO_SALIDA ?? "") === t).length),
                  marker: { color: YEAR_COLORS_COS[ano] },
                }));
                return (
                  <ChartCard title="Tipo de Salida por Año">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Tipo" } }, yaxis: { title: { text: "Liquidaciones" } }, margin: { t: 8, r: 16, b: 48, l: 60 }, showlegend: true }}
                      height={320}
                    />
                  </ChartCard>
                );
              })()}

              {/* Top 10 motivos de salida — barras agrupadas */}
              {(() => {
                const motivoTotal: Record<string, number> = {};
                rawRows.forEach((r) => {
                  const m = String(r.MOTIVO_SALIDA ?? "").trim();
                  if (m && m !== "NAN") motivoTotal[m] = (motivoTotal[m] ?? 0) + 1;
                });
                const top10 = Object.entries(motivoTotal).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([m]) => m);
                if (!top10.length) return null;
                const traces = anosDisponiblesCos.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: top10,
                  y: top10.map((m) => rawRows.filter((r) => String(r.ANO_SALIDA ?? "") === ano && String(r.MOTIVO_SALIDA ?? "").trim() === m).length),
                  marker: { color: YEAR_COLORS_COS[ano] },
                }));
                return (
                  <ChartCard title="Top 10 Motivos de Salida — Comparación Anual" fullWidth>
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { tickangle: -35 }, yaxis: { title: { text: "Liquidaciones" } }, margin: { t: 8, r: 16, b: 120, l: 60 }, showlegend: true }}
                      height={420}
                    />
                  </ChartCard>
                );
              })()}

              {/* Composición de costos por año — barras apiladas % */}
              {(() => {
                const conceptosActivos = CONCEPTOS.filter(([, field]) => rawRows.some((r) => Number(r[field]) > 0));
                if (!conceptosActivos.length) return null;
                const traces = conceptosActivos.map(([label, field], i) => ({
                  type: "bar" as const,
                  name: label,
                  x: anosDisponiblesCos,
                  y: anosDisponiblesCos.map((ano) => {
                    const anoRows = rawRows.filter((r) => String(r.ANO_SALIDA ?? "") === ano);
                    return anoRows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
                  }),
                  marker: { color: CONCEPT_COLORS[i] },
                }));
                return (
                  <ChartCard title="Composición de Costos por Año" fullWidth>
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "stack", xaxis: { title: { text: "Año" } }, yaxis: { title: { text: "Monto" } }, margin: { t: 8, r: 200, b: 48, l: 80 }, showlegend: true, legend: { x: 1.02, y: 1 } }}
                      height={400}
                    />
                  </ChartCard>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Detalle ─────────────────────────────────────────────────── */}
      {activeTab === "detalle" && (
        <DataTable rows={filteredRows} title="Detalle de Liquidaciones" />
      )}
    </div>
  );
}
