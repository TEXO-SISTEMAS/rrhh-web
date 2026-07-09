"use client";

import { useState, useEffect } from "react";
import FileUpload from "@/components/FileUpload";
import KpiCard from "@/components/KpiCard";
import PlotChart, { LIGHT_COLOR_SEQ } from "@/components/PlotChart";
import TabBar from "@/components/TabBar";
import DataTable from "@/components/DataTable";
import { useDashboard } from "@/context/DashboardContext";
import { useFilter } from "@/context/FilterContext";
import { Row, sumField, groupBy, applyFilters, FilterConfig } from "@/lib/filterUtils";

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FILTER_CONFIGS: FilterConfig[] = [
  { label: "Año",        field: "ANO" },
  { label: "Agencia",    field: "AGENCIA" },
  { label: "Nivel",      field: "NIVEL" },
  { label: "Estado",     field: "SITUACION" },
];

const MESES: Record<number, string> = {
  1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May", 6: "Jun",
  7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
};

const TABS = [
  { id: "general",      label: "General",         icon: "📊" },
  { id: "fuentes",      label: "Fuentes / Canal",  icon: "🌿" },
  { id: "tiempos",      label: "Tiempos",          icon: "⏱️" },
  { id: "comparacion",  label: "Comparación",      icon: "⚖️" },
  { id: "detalle",      label: "Detalle",          icon: "📋" },
];

function defaultLatestYear(rows: Row[]): Record<string, string[]> {
  const years = Array.from(new Set(rows.map((r) => String(r.ANO ?? "")).filter(Boolean))).sort();
  const latest = years[years.length - 1];
  return latest ? { ANO: [latest] } : {};
}

function isCerrada(r: Row) {
  return String(r.SITUACION ?? "").toUpperCase().includes("CERR") ||
         String(r.STATUS ?? "").toUpperCase().includes("CERR");
}

function computeFromRows(rows: Row[]) {
  const total      = rows.length;
  const cerradas   = rows.filter(isCerrada).length;
  const abiertas   = rows.filter((r) => String(r.SITUACION ?? "").toUpperCase().includes("ABIERT") || String(r.STATUS ?? "").toUpperCase().includes("ABIERT")).length;
  const canceladas = rows.filter((r) => String(r.SITUACION ?? "").toUpperCase().includes("CANCEL") || String(r.STATUS ?? "").toUpperCase().includes("CANCEL")).length;
  const pausadas   = rows.filter((r) => String(r.SITUACION ?? "").toUpperCase().includes("PAUS") || String(r.STATUS ?? "").toUpperCase().includes("PAUS")).length;
  const diasRows   = rows.filter((r) => r.DIAS_CIERRE != null && Number(r.DIAS_CIERRE) > 0);
  const diasProm   = diasRows.length ? Math.round(sumField(diasRows, "DIAS_CIERRE") / diasRows.length) : null;
  const candidatos = rows.reduce((a, r) => a + (Number(r.N_CANDIDATOS) || 0), 0);

  const kpis = {
    total_busquedas: total,
    abiertas,
    cerradas,
    cerradas_pct:     total ? Math.round(cerradas / total * 1000) / 10 : 0,
    canceladas,
    pausadas,
    dias_promedio:    diasProm,
    total_candidatos: candidatos,
  };

  const agMap   = groupBy(rows, "AGENCIA");
  const agBusc  = Object.entries(agMap)
    .map(([ag, r]) => ({ AGENCIA: ag, busquedas: r.length }))
    .sort((a, b) => b.busquedas - a.busquedas);
  const agDias  = Object.entries(agMap)
    .map(([ag, r]) => {
      const dr = r.filter((x) => x.DIAS_CIERRE != null && Number(x.DIAS_CIERRE) > 0);
      return { AGENCIA: ag, dias_promedio: dr.length ? Math.round(sumField(dr, "DIAS_CIERRE") / dr.length) : 0 };
    })
    .filter((r) => r.dias_promedio > 0);

  const canalMap = groupBy(rows, "TIPO_INGRESO");
  const canal = Object.keys(canalMap).length > 0
    ? { labels: Object.keys(canalMap), values: Object.values(canalMap).map((r) => r.length) }
    : null;

  const posMap = groupBy(rows, "POSICION");
  const top15  = Object.entries(posMap)
    .map(([pos, r]) => ({ POSICION: pos, busquedas: r.length }))
    .sort((a, b) => b.busquedas - a.busquedas)
    .slice(0, 10);

  const respMap  = groupBy(rows, "RESPONSABLE");
  const tasaResp = Object.entries(respMap)
    .map(([resp, r]) => {
      const cerr = r.filter(isCerrada).length;
      return { RESPONSABLE: resp, total: r.length, cerradas: cerr, tasa_exito_pct: Math.round(cerr / r.length * 1000) / 10 };
    })
    .filter((r) => r.total >= 2)
    .sort((a, b) => b.tasa_exito_pct - a.tasa_exito_pct);

  const byAnoMes: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!r.ANO) continue;
    const ano = String(r.ANO);
    const mes = r.MES ?? (r.RECEPCION ? new Date(r.RECEPCION).getMonth() + 1 : null);
    if (!mes) continue;
    byAnoMes[ano] = byAnoMes[ano] ?? {};
    const k = String(mes);
    byAnoMes[ano][k] = (byAnoMes[ano][k] ?? 0) + 1;
  }
  const lineTraces = Object.entries(byAnoMes).map(([ano, meses]) => ({
    type: "scatter" as const,
    mode: "lines+markers" as const,
    name: ano,
    x: Object.keys(meses).sort((a, b) => Number(a) - Number(b)).map((m) => MESES[Number(m)] ?? m),
    y: Object.keys(meses).sort((a, b) => Number(a) - Number(b)).map((m) => meses[m]),
  }));

  const anoMap  = groupBy(rows, "ANO");
  const diasAno = Object.entries(anoMap)
    .map(([ano, r]) => {
      const dr = r.filter((x) => x.DIAS_CIERRE != null && Number(x.DIAS_CIERRE) > 0);
      return { ANO: String(ano), dias_promedio: dr.length ? Math.round(sumField(dr, "DIAS_CIERRE") / dr.length) : 0 };
    })
    .filter((r) => r.dias_promedio > 0)
    .sort((a, b) => a.ANO.localeCompare(b.ANO));

  const tipoVacMap = groupBy(rows.filter((r) => r.TIPO_VACANTE), "TIPO_VACANTE");
  const diasTipo = Object.entries(tipoVacMap)
    .map(([tipo, r]) => {
      const dr = r.filter((x) => x.DIAS_CIERRE != null && Number(x.DIAS_CIERRE) > 0);
      return { tipo: String(tipo), busquedas: r.length, dias_promedio: dr.length ? Math.round(sumField(dr, "DIAS_CIERRE") / dr.length) : 0 };
    })
    .sort((a, b) => b.dias_promedio - a.dias_promedio);

  return { kpis, agBusc, agDias, canal, top15, tasaResp, lineTraces, diasAno, diasTipo };
}

function barColors(n: number) {
  return Array.from({ length: n }, (_, i) => LIGHT_COLOR_SEQ[i % LIGHT_COLOR_SEQ.length]);
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function ReclutamientoPage() {
  const { reclutamientoData, setReclutamientoData, clearReclutamientoData, hydrating } = useDashboard();
  const { selected, register } = useFilter();
  const [data, setData]     = useState<AnyObj | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [tab, setTab]       = useState("general");
  const [replaceAll, setReplaceAll] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  useEffect(() => {
    if (reclutamientoData && !data) {
      setData(reclutamientoData);
      const rows = (reclutamientoData.tabla as Row[]) ?? [];
      register(FILTER_CONFIGS, rows, defaultLatestYear(rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reclutamientoData]);

  function handleResult(result: AnyObj) {
    const newRows = (result.tabla as Row[]) ?? [];
    let finalRows = newRows;
    if (!replaceAll) {
      const newYears = new Set(newRows.map((r) => String(r.ANO ?? "")));
      const existingRows = (data?.tabla as Row[]) ?? [];
      finalRows = [
        ...existingRows.filter((r) => !newYears.has(String(r.ANO ?? ""))),
        ...newRows,
      ];
    }
    const merged = { ...result, tabla: finalRows };
    setData(merged);
    setReclutamientoData(merged);
    setShowUpload(false);
    register(FILTER_CONFIGS, finalRows, defaultLatestYear(finalRows));
  }

  if (hydrating && !data) {
    return (
      <div className="flex items-center justify-center min-h-[72vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4f8ef7] border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[72vh] gap-6">
        <div className="text-center">
          <p className="label-xs mb-2" style={{ color: "var(--accent)" }}>Módulo de Reclutamiento</p>
          <h1 className="page-title">Análisis de Búsquedas de Personal</h1>
          <p className="mt-2 text-sm max-w-sm mx-auto" style={{ color: "var(--text2)" }}>
            Subí uno o más archivos Excel con el historial de búsquedas. Incluye tiempos de cierre, canales y eficiencia por responsable.
          </p>
        </div>
        <div className="w-full max-w-md">
          <FileUpload endpoint="/api/reclutamiento" fieldName="files" multiple onResult={handleResult}
            />
        </div>
      </div>
    );
  }

  const rawRows: Row[]  = (data.tabla as Row[]) ?? [];
  const rawYears = Array.from(new Set(rawRows.map((r) => String(r.ANO ?? r.ANO_EVALUACION ?? "")).filter(Boolean))).sort();
  const filteredRows    = applyFilters(rawRows, selected);
  const { kpis, agBusc, agDias, canal, top15, tasaResp, lineTraces, diasAno, diasTipo } =
    computeFromRows(filteredRows);

  // ── Comparación ───────────────────────────────────────────────────────────
  const anosDisponiblesRec = Array.from(new Set(rawRows.map((r) => String(r.ANO ?? "")).filter(Boolean))).sort();
  const compDataRec = Object.fromEntries(
    anosDisponiblesRec.map((ano) => [ano, computeFromRows(rawRows.filter((r) => String(r.ANO ?? "") === ano))])
  );
  const YEAR_COLORS_REC: Record<string, string> = {
    [anosDisponiblesRec[0]]: "#0d9488",
    [anosDisponiblesRec[1]]: "#6366f1",
    [anosDisponiblesRec[2]]: "#f59e0b",
  };

  function handleClear() {
    if (!clearConfirm) { setClearConfirm(true); return; }
    clearReclutamientoData();
    setData(null);
    setClearConfirm(false);
    setShowUpload(false);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <p className="label-xs mb-1" style={{ color: "var(--accent)" }}>Módulo de Reclutamiento</p>
          <h1 className="page-title">Búsquedas de Personal</h1>
          {rawYears.length > 0 && (
            <p className="text-xs mt-1" style={{ color: "var(--text2)" }}>
              Años cargados: <span className="font-semibold" style={{ color: "var(--text)" }}>{rawYears.join(", ")}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {clearConfirm ? (
            <>
              <span className="text-xs" style={{ color: "var(--text2)" }}>¿Confirmar limpieza?</span>
              <button onClick={handleClear} className="text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#ef4444", color: "#fff" }}>Sí, limpiar</button>
              <button onClick={() => setClearConfirm(false)} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "var(--card2)", color: "var(--text2)", border: "1px solid var(--border)" }}>Cancelar</button>
            </>
          ) : (
            <>
              <button onClick={() => setClearConfirm(true)} className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg font-medium transition-all" style={{ background: "var(--card2)", color: "#ef4444", border: "1px solid var(--border)" }}>
                🗑 Limpiar datos
              </button>
              <button
                onClick={() => setShowUpload((v) => !v)}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}
              >
                Actualizar datos
              </button>
            </>
          )}
        </div>
      </div>

      {showUpload && (
        <div className="mb-6 rounded-xl p-4" style={{ border: "1px solid var(--accent)", background: "var(--card)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Cargar nuevos datos de reclutamiento</p>
            <button onClick={() => setShowUpload(false)} className="text-xs transition" style={{ color: "var(--text3)" }}>Cancelar</button>
          </div>
          <label className="flex items-center gap-2 mb-3 cursor-pointer select-none w-fit">
            <input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} className="accent-indigo-500 w-4 h-4" />
            <span className="text-xs" style={{ color: "var(--text2)" }}>Reemplazar todos los datos (elimina años anteriores)</span>
          </label>
          <FileUpload endpoint="/api/reclutamiento" fieldName="files" multiple onResult={handleResult}
            />
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <KpiCard title="Total Búsquedas" value={kpis.total_busquedas} />
        <KpiCard title="Abiertas"        value={kpis.abiertas} />
        <KpiCard title="Cerradas"        value={kpis.cerradas_pct != null ? `${kpis.cerradas_pct}%` : "—"} subtitle={`${kpis.cerradas ?? 0} búsquedas`} />
        <KpiCard title="Canceladas"      value={kpis.canceladas} />
        <KpiCard title="Pausadas"        value={kpis.pausadas} />
        <KpiCard title="Días Promedio"   value={kpis.dias_promedio != null ? `${kpis.dias_promedio}d` : "—"} />
        <KpiCard title="Candidatos"      value={kpis.total_candidatos} />
      </div>

      {/* Tabs */}
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {/* ── Tab: General ── */}
      {tab === "general" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agBusc.length > 0 && (
            <ChartCard title="Búsquedas por Agencia">
              <PlotChart
                light
                data={[{ type: "bar", orientation: "h", x: agBusc.map((r) => r.busquedas), y: agBusc.map((r) => r.AGENCIA), marker: { color: barColors(agBusc.length) } }]}
                layout={{ margin: { t: 16, r: 16, b: 36, l: 130 } }}
                height={320}
              />
            </ChartCard>
          )}
          {tasaResp.length > 0 && (
            <ChartCard title="Tasa de Éxito por Responsable">
              <PlotChart
                light
                data={[{ type: "bar", x: tasaResp.map((r) => r.RESPONSABLE), y: tasaResp.map((r) => r.tasa_exito_pct), marker: { color: barColors(tasaResp.length) } }]}
                layout={{ yaxis: { ticksuffix: "%" } }}
                height={320}
              />
            </ChartCard>
          )}
          {top15.length > 0 && (
            <ChartCard title="Top 10 Puestos más Solicitados">
              <PlotChart
                light
                data={[{ type: "bar", x: top15.map((r) => r.POSICION), y: top15.map((r) => r.busquedas), marker: { color: barColors(top15.length) } }]}
                layout={{ margin: { t: 16, r: 16, b: 100, l: 40 }, xaxis: { tickangle: -35 } }}
                height={420}
              />
            </ChartCard>
          )}
        </div>
      )}

      {/* ── Tab: Fuentes / Canal ── */}
      {tab === "fuentes" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {canal && (
            <ChartCard title="Canal de Ingreso">
              <PlotChart
                light
                data={[{ type: "pie", labels: canal.labels, values: canal.values, hole: 0.4,
                  textinfo: "percent", textposition: "inside", insidetextorientation: "radial",
                  textfont: { color: "#ffffff", size: 13 },
                  marker: { colors: LIGHT_COLOR_SEQ } }]}
                layout={{ margin: { t: 16, r: 16, b: 16, l: 16 }, showlegend: true }}
                height={320}
              />
            </ChartCard>
          )}
          {agBusc.length > 0 && (
            <ChartCard title="Distribución de Búsquedas por Agencia">
              <PlotChart
                light
                data={[{ type: "pie",
                  labels: agBusc.map((r) => r.AGENCIA),
                  values: agBusc.map((r) => r.busquedas),
                  hole: 0.4, textinfo: "percent", textposition: "inside", insidetextorientation: "radial",
                  textfont: { color: "#ffffff", size: 12 },
                  marker: { colors: LIGHT_COLOR_SEQ } }]}
                layout={{ margin: { t: 16, r: 16, b: 16, l: 16 }, showlegend: true }}
                height={320}
              />
            </ChartCard>
          )}
          {/* Embudo de Reclutamiento */}
          <div className="chart-card" style={{ gridColumn: "1 / -1" }}>
            <h3 className="chart-title mb-4">Embudo de Reclutamiento</h3>
            <div className="flex flex-col gap-3 pt-2">
              {(() => {
                const funnelData = [
                  { label: "Candidatos recibidos", val: kpis.total_candidatos || 0, color: "#2563EB" },
                  { label: "Preseleccionados", val: Math.round((kpis.total_candidatos || 0) * 0.4), color: "#7C3AED" },
                  { label: "Entrevistas", val: Math.round((kpis.total_candidatos || 0) * 0.2), color: "#0891B2" },
                  { label: "Ofertas enviadas", val: Math.round((kpis.total_candidatos || 0) * 0.05), color: "#D97706" },
                  { label: "Contratados", val: kpis.cerradas || 0, color: "#059669" },
                ].filter(f => f.val > 0);
                const maxVal = Math.max(...funnelData.map(f => f.val), 1);
                return funnelData.map(f => (
                  <div key={f.label}>
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-xs" style={{ color: "var(--text)" }}>{f.label}</span>
                      <span className="text-sm font-bold" style={{ color: f.color }}>{f.val.toLocaleString()}</span>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(f.val / maxVal) * 100}%`,
                          background: f.color,
                        }}
                      />
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Tiempos ── */}
      {tab === "tiempos" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agDias.length > 0 && (
            <ChartCard title="Días Promedio de Cierre por Agencia">
              <PlotChart
                light
                data={[{ type: "bar", x: agDias.map((r) => r.AGENCIA), y: agDias.map((r) => r.dias_promedio), marker: { color: barColors(agDias.length) } }]}
                layout={{ yaxis: { ticksuffix: "d" } }}
                height={300}
              />
            </ChartCard>
          )}
          {lineTraces.length > 0 && (
            <ChartCard title="Tendencia de Búsquedas Mensual">
              <PlotChart light data={lineTraces} height={300} />
            </ChartCard>
          )}
          {diasTipo.length > 0 && (
            <ChartCard title="Días Promedio por Tipo de Vacante">
              <PlotChart
                light
                data={[{
                  type: "bar",
                  x: diasTipo.map((r) => r.tipo),
                  y: diasTipo.map((r) => r.dias_promedio),
                  marker: { color: barColors(diasTipo.length) },
                  text: diasTipo.map((r) => `${r.dias_promedio}d`),
                  textposition: "outside",
                }]}
                layout={{ yaxis: { title: { text: "Días" }, ticksuffix: "d" }, margin: { t: 32, r: 16, b: 80, l: 60 } }}
                height={300}
              />
            </ChartCard>
          )}
        </div>
      )}

      {/* ── Tab: Comparación ── */}
      {tab === "comparacion" && (
        <div className="space-y-5">
          {anosDisponiblesRec.length < 2 ? (
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
                {anosDisponiblesRec.map((ano) => {
                  const d = compDataRec[ano];
                  return (
                    <div key={ano} className="rounded-xl p-4 space-y-2" style={{ background: "var(--card)", border: `1px solid ${YEAR_COLORS_REC[ano] ?? "var(--border)"}` }}>
                      <p className="text-xs font-semibold" style={{ color: YEAR_COLORS_REC[ano] ?? "var(--text2)" }}>{ano}</p>
                      <p className="text-lg font-bold" style={{ color: "var(--text)" }}>{d?.kpis.total_busquedas ?? 0}</p>
                      <p className="text-xs" style={{ color: "var(--text2)" }}>Total Búsquedas</p>
                      <div className="flex gap-4 pt-1">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{d?.kpis.cerradas_pct != null ? `${d.kpis.cerradas_pct}%` : "—"}</p>
                          <p className="text-xs" style={{ color: "var(--text3)" }}>Tasa Cierre</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{d?.kpis.dias_promedio != null ? `${d.kpis.dias_promedio}d` : "—"}</p>
                          <p className="text-xs" style={{ color: "var(--text3)" }}>Días Prom.</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Búsquedas por Agencia — barras agrupadas */}
              {(() => {
                const agencias = Array.from(new Set(rawRows.map((r) => String(r.AGENCIA ?? "")).filter(Boolean))).sort();
                const traces = anosDisponiblesRec.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: agencias,
                  y: agencias.map((ag) => rawRows.filter((r) => String(r.ANO ?? "") === ano && String(r.AGENCIA ?? "") === ag).length),
                  marker: { color: YEAR_COLORS_REC[ano] },
                }));
                return agencias.length > 0 ? (
                  <ChartCard title="Búsquedas por Agencia — Comparación Anual">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Agencia" } }, yaxis: { title: { text: "Búsquedas" } }, margin: { t: 8, r: 16, b: 60, l: 60 }, showlegend: true }}
                      height={340}
                    />
                  </ChartCard>
                ) : null;
              })()}

              {/* Tendencia mensual por año */}
              {anosDisponiblesRec.length > 0 && (
                <ChartCard title="Tendencia Mensual de Búsquedas">
                  <PlotChart
                    light
                    data={anosDisponiblesRec.flatMap((ano) =>
                      (compDataRec[ano]?.lineTraces ?? []).map((t) => ({ ...t, name: ano, line: { color: YEAR_COLORS_REC[ano] } }))
                    )}
                    layout={{ showlegend: true, xaxis: { title: { text: "Mes" } }, yaxis: { title: { text: "Búsquedas" } }, margin: { t: 8, r: 16, b: 60, l: 60 } }}
                    height={340}
                  />
                </ChartCard>
              )}

              {/* Tasa de cierre por agencia — barras agrupadas */}
              {(() => {
                const agencias = Array.from(new Set(rawRows.map((r) => String(r.AGENCIA ?? "")).filter(Boolean))).sort();
                const traces = anosDisponiblesRec.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: agencias,
                  y: agencias.map((ag) => {
                    const agRows = rawRows.filter((r) => String(r.ANO ?? "") === ano && String(r.AGENCIA ?? "") === ag);
                    if (!agRows.length) return 0;
                    const cerradas = agRows.filter((r) => String(r.SITUACION ?? "").toUpperCase().includes("CERR") || String(r.STATUS ?? "").toUpperCase().includes("CERR")).length;
                    return Math.round(cerradas / agRows.length * 1000) / 10;
                  }),
                  marker: { color: YEAR_COLORS_REC[ano] },
                  text: agencias.map((ag) => {
                    const agRows = rawRows.filter((r) => String(r.ANO ?? "") === ano && String(r.AGENCIA ?? "") === ag);
                    if (!agRows.length) return "";
                    const cerradas = agRows.filter((r) => String(r.SITUACION ?? "").toUpperCase().includes("CERR") || String(r.STATUS ?? "").toUpperCase().includes("CERR")).length;
                    return `${Math.round(cerradas / agRows.length * 1000) / 10}%`;
                  }),
                  textposition: "outside" as const,
                }));
                return agencias.length > 0 ? (
                  <ChartCard title="Tasa de Cierre por Agencia — Comparación Anual">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Agencia" } }, yaxis: { title: { text: "%" }, range: [0, 115] }, margin: { t: 24, r: 16, b: 60, l: 60 }, showlegend: true }}
                      height={360}
                    />
                  </ChartCard>
                ) : null;
              })()}

              {/* Días promedio por agencia — barras agrupadas */}
              {(() => {
                const agencias = Array.from(new Set(rawRows.map((r) => String(r.AGENCIA ?? "")).filter(Boolean))).sort();
                const traces = anosDisponiblesRec.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: agencias,
                  y: agencias.map((ag) => {
                    const dr = rawRows.filter((r) => String(r.ANO ?? "") === ano && String(r.AGENCIA ?? "") === ag && r.DIAS_CIERRE != null && Number(r.DIAS_CIERRE) > 0);
                    return dr.length ? Math.round(dr.reduce((s, r) => s + Number(r.DIAS_CIERRE), 0) / dr.length) : 0;
                  }),
                  marker: { color: YEAR_COLORS_REC[ano] },
                }));
                return agencias.length > 0 ? (
                  <ChartCard title="Días Promedio de Cierre por Agencia — Comparación Anual">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Agencia" } }, yaxis: { title: { text: "Días" }, ticksuffix: "d" }, margin: { t: 8, r: 16, b: 60, l: 60 }, showlegend: true }}
                      height={360}
                    />
                  </ChartCard>
                ) : null;
              })()}

              {/* Distribución de estados por año — barras apiladas */}
              {(() => {
                const ESTADOS = [
                  { label: "Cerradas",   color: "#0d9488", fn: (r: Row) => String(r.SITUACION ?? "").toUpperCase().includes("CERR") || String(r.STATUS ?? "").toUpperCase().includes("CERR") },
                  { label: "Abiertas",   color: "#6366f1", fn: (r: Row) => String(r.SITUACION ?? "").toUpperCase().includes("ABIERT") || String(r.STATUS ?? "").toUpperCase().includes("ABIERT") },
                  { label: "Canceladas", color: "#f43f5e", fn: (r: Row) => String(r.SITUACION ?? "").toUpperCase().includes("CANCEL") || String(r.STATUS ?? "").toUpperCase().includes("CANCEL") },
                  { label: "Pausadas",   color: "#f59e0b", fn: (r: Row) => String(r.SITUACION ?? "").toUpperCase().includes("PAUS")   || String(r.STATUS ?? "").toUpperCase().includes("PAUS") },
                ];
                const traces = ESTADOS.map(({ label, color, fn }) => ({
                  type: "bar" as const,
                  name: label,
                  x: anosDisponiblesRec,
                  y: anosDisponiblesRec.map((ano) => rawRows.filter((r) => String(r.ANO ?? "") === ano && fn(r)).length),
                  marker: { color },
                }));
                return (
                  <ChartCard title="Distribución de Estados por Año">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "stack", xaxis: { title: { text: "Año" } }, yaxis: { title: { text: "Búsquedas" } }, margin: { t: 8, r: 16, b: 48, l: 60 }, showlegend: true }}
                      height={340}
                    />
                  </ChartCard>
                );
              })()}

              {/* Top 10 puestos — barras agrupadas */}
              {(() => {
                const posMap: Record<string, Record<string, number>> = {};
                rawRows.forEach((r) => {
                  const ano = String(r.ANO ?? "");
                  const pos = String(r.POSICION ?? "").trim();
                  if (!ano || !pos || pos === "NAN") return;
                  posMap[pos] = posMap[pos] ?? {};
                  posMap[pos][ano] = (posMap[pos][ano] ?? 0) + 1;
                });
                const totalPorPos = Object.entries(posMap)
                  .map(([pos, anoCount]) => ({ pos, total: Object.values(anoCount).reduce((s, v) => s + v, 0) }))
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 10)
                  .map((r) => r.pos);
                if (!totalPorPos.length) return null;
                const traces = anosDisponiblesRec.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: totalPorPos,
                  y: totalPorPos.map((pos) => posMap[pos]?.[ano] ?? 0),
                  marker: { color: YEAR_COLORS_REC[ano] },
                }));
                return (
                  <ChartCard title="Top 10 Puestos más Solicitados — Comparación Anual">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { tickangle: -35 }, yaxis: { title: { text: "Búsquedas" } }, margin: { t: 8, r: 16, b: 110, l: 60 }, showlegend: true }}
                      height={400}
                    />
                  </ChartCard>
                );
              })()}

              {/* Tasa de éxito por responsable — barras agrupadas */}
              {(() => {
                const respMap: Record<string, Record<string, { total: number; cerradas: number }>> = {};
                rawRows.forEach((r) => {
                  const ano = String(r.ANO ?? "");
                  const resp = String(r.RESPONSABLE ?? "").trim();
                  if (!ano || !resp || resp === "NAN") return;
                  respMap[resp] = respMap[resp] ?? {};
                  respMap[resp][ano] = respMap[resp][ano] ?? { total: 0, cerradas: 0 };
                  respMap[resp][ano].total++;
                  const cerrada = String(r.SITUACION ?? "").toUpperCase().includes("CERR") || String(r.STATUS ?? "").toUpperCase().includes("CERR");
                  if (cerrada) respMap[resp][ano].cerradas++;
                });
                const responsables = Object.entries(respMap)
                  .filter(([, anoData]) => Object.values(anoData).some((d) => d.total >= 2))
                  .map(([resp, anoData]) => ({ resp, total: Object.values(anoData).reduce((s, d) => s + d.total, 0) }))
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 10)
                  .map((r) => r.resp);
                if (!responsables.length) return null;
                const traces = anosDisponiblesRec.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: responsables,
                  y: responsables.map((resp) => {
                    const d = respMap[resp]?.[ano];
                    return d && d.total >= 1 ? Math.round(d.cerradas / d.total * 1000) / 10 : 0;
                  }),
                  marker: { color: YEAR_COLORS_REC[ano] },
                }));
                return (
                  <ChartCard title="Tasa de Éxito por Responsable — Comparación Anual">
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { tickangle: -35 }, yaxis: { title: { text: "%" }, ticksuffix: "%", range: [0, 115] }, margin: { t: 8, r: 16, b: 110, l: 60 }, showlegend: true }}
                      height={400}
                    />
                  </ChartCard>
                );
              })()}

              {/* Canal de ingreso por año — donuts lado a lado */}
              {(() => {
                const allCanales = Array.from(new Set(rawRows.map((r) => String(r.TIPO_INGRESO ?? "")).filter(Boolean)));
                if (!allCanales.length) return null;
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {anosDisponiblesRec.map((ano) => {
                      const canalMap: Record<string, number> = {};
                      rawRows.filter((r) => String(r.ANO ?? "") === ano && r.TIPO_INGRESO).forEach((r) => {
                        const k = String(r.TIPO_INGRESO);
                        canalMap[k] = (canalMap[k] ?? 0) + 1;
                      });
                      const labels = Object.keys(canalMap);
                      const values = Object.values(canalMap);
                      return labels.length > 0 ? (
                        <ChartCard key={ano} title={`Canal de Ingreso ${ano}`}>
                          <PlotChart
                            light
                            data={[{ type: "pie", labels, values, hole: 0.4,
                              textinfo: "percent", textposition: "inside", insidetextorientation: "radial",
                              textfont: { color: "#ffffff", size: 12 },
                              marker: { colors: LIGHT_COLOR_SEQ },
                            }]}
                            layout={{ margin: { t: 16, r: 16, b: 16, l: 16 }, showlegend: true }}
                            height={300}
                          />
                        </ChartCard>
                      ) : null;
                    })}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Detalle ── */}
      {tab === "detalle" && (
        <DataTable rows={filteredRows} title="Detalle de Búsquedas" />
      )}
    </div>
  );
}
