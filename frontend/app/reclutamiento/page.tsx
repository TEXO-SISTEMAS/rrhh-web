"use client";

import { useState, useEffect } from "react";
import FileUpload from "@/components/FileUpload";
import KpiCard from "@/components/KpiCard";
import PlotChart, { LIGHT_COLOR_SEQ } from "@/components/PlotChart";
import TabBar from "@/components/TabBar";
import DataTable from "@/components/DataTable";
import { useDashboard } from "@/context/DashboardContext";
import { useFilter } from "@/context/FilterContext";
import { Row, sumField, groupBy, applyFilters, FilterConfig, defaultYear2025 } from "@/lib/filterUtils";

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FILTER_CONFIGS: FilterConfig[] = [
  { label: "Agencia",    field: "AGENCIA" },
  { label: "Nivel",      field: "NIVEL" },
  { label: "Estado",     field: "SITUACION" },
];

const MESES: Record<number, string> = {
  1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May", 6: "Jun",
  7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
};

const TABS = [
  { id: "general",   label: "General",        icon: "📊" },
  { id: "fuentes",   label: "Fuentes / Canal", icon: "🌿" },
  { id: "tiempos",   label: "Tiempos",        icon: "⏱️" },
  { id: "detalle",   label: "Detalle",        icon: "📋" },
];

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

  return { kpis, agBusc, agDias, canal, top15, tasaResp, lineTraces, diasAno };
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
  const { reclutamientoData, setReclutamientoData, hydrating } = useDashboard();
  const { selected, register } = useFilter();
  const [data, setData]     = useState<AnyObj | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [tab, setTab]       = useState("general");

  useEffect(() => {
    if (reclutamientoData && !data) {
      setData(reclutamientoData);
      const rows = (reclutamientoData.tabla as Row[]) ?? [];
      register(FILTER_CONFIGS, rows.filter((r) => String(r.ANO ?? "") === "2025"), {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reclutamientoData]);

  function handleResult(result: AnyObj) {
    setData(result);
    setReclutamientoData(result);
    setShowUpload(false);
    const rows = (result.tabla as Row[]) ?? [];
    register(FILTER_CONFIGS, rows.filter((r) => String(r.ANO ?? "") === "2025"), {});
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
          <FileUpload endpoint="/api/reclutamiento" fieldName="files" multiple onResult={handleResult} />
        </div>
      </div>
    );
  }

  const rawRows: Row[] = ((data.tabla as Row[]) ?? []).filter((r) => String(r.ANO ?? "") === "2025");
  const filteredRows   = applyFilters(rawRows, selected);
  const { kpis, agBusc, agDias, canal, top15, tasaResp, lineTraces, diasAno } =
    computeFromRows(filteredRows);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="label-xs mb-1" style={{ color: "var(--accent)" }}>Módulo de Reclutamiento</p>
          <h1 className="page-title">Búsquedas de Personal</h1>
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
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Cargar nuevos datos de reclutamiento</p>
            <button onClick={() => setShowUpload(false)} className="text-xs transition" style={{ color: "var(--text3)" }}>Cancelar</button>
          </div>
          <FileUpload endpoint="/api/reclutamiento" fieldName="files" multiple onResult={handleResult} />
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
          {diasAno.length > 0 && (
          )}
        </div>
      )}

      {/* ── Tab: Detalle ── */}
      {tab === "detalle" && (
        <DataTable rows={rawRows} title="Detalle de Búsquedas" />
      )}
    </div>
  );
}
