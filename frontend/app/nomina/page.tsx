"use client";

import { useState, useEffect } from "react";
import FileUpload from "@/components/FileUpload";
import KpiCard from "@/components/KpiCard";
import PlotChart, { LIGHT_COLOR_SEQ } from "@/components/PlotChart";
import TabBar from "@/components/TabBar";
import DataTable from "@/components/DataTable";
import { useDashboard } from "@/context/DashboardContext";
import LayoutShell from "@/components/LayoutShell";
import { useFilter } from "@/context/FilterContext";
import { Row, sumField, groupBy, applyFilters, FilterConfig } from "@/lib/filterUtils";

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FILTER_CONFIGS: FilterConfig[] = [
  { label: "Año",        field: "ANO_EVALUACION" },
  { label: "Empresa",    field: "EMPRESA" },
  { label: "Nivel AIC",  field: "NIVEL_AIC" },
  { label: "Género",     field: "SEXO" },
  { label: "Generación", field: "GENERACION" },
  { label: "Lider",      field: "LIDER" },
];

const TABS = [
  { id: "distribucion",  label: "Distribución",  icon: "👥" },
  { id: "demografia",    label: "Demografía",    icon: "🌍" },
  { id: "brecha",        label: "Brecha",        icon: "📊" },
  { id: "comparacion",   label: "Comparación",   icon: "⚖️" },
  { id: "detalle",       label: "Detalle",       icon: "📋" },
];

function defaultLatestYear(rows: Row[]): Record<string, string[]> {
  const years = Array.from(new Set(rows.map((r) => String(r.ANO_EVALUACION ?? "")).filter(Boolean))).sort();
  const latest = years[years.length - 1];
  return latest ? { ANO_EVALUACION: [latest] } : {};
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("es-PY", { maximumFractionDigits: 0 });
}

function computeFromRows(rows: Row[]) {
  const total    = rows.length;
  const empresas = new Set(rows.map((r) => r.EMPRESA).filter(Boolean)).size;

  const TAC_MEDIA_EMP = new Set(["AMPLIFY", "BPR", "TAC MEDIA"]);
  const CSC_EMP       = new Set(["TEXO"]);
  const empNorm = (r: Row) => String(r.EMPRESA ?? "").toUpperCase().trim();
  const tacMedia = rows.filter((r) => TAC_MEDIA_EMP.has(empNorm(r))).length;
  const csc      = rows.filter((r) => CSC_EMP.has(empNorm(r))).length;
  const agencias = rows.filter((r) => !TAC_MEDIA_EMP.has(empNorm(r)) && !CSC_EMP.has(empNorm(r))).length;

  const mujeres     = rows.filter((r) => r.SEXO === "F").length;
  const salRows     = rows.filter((r) => r.SALARIO != null);
  const esParaguay  = (r: Row) => String(r.NACIONALIDAD ?? "").toUpperCase().includes("PARAGUAY");
  const extranjeros = rows.filter((r) => !esParaguay(r) && r.NACIONALIDAD).length;

  const kpis = {
    total,
    empresas,
    agencias,
    tac_media: tacMedia,
    csc,
  };

  const genero = {
    labels: ["Mujeres", "Hombres"],
    values: [mujeres, rows.filter((r) => r.SEXO === "M").length],
    por_empresa: (() => {
      const m = groupBy(rows, "EMPRESA");
      return Object.entries(m).map(([emp, r]) => ({
        EMPRESA: emp,
        Mujeres: r.filter((x) => x.SEXO === "F").length,
        Hombres: r.filter((x) => x.SEXO === "M").length,
      }));
    })(),
  };

  const genDist = (() => {
    const orden = ["Baby Boomers", "Generación X", "Millennials", "Generación Z", "Otra"];
    const m = groupBy(rows, "GENERACION");
    return orden.filter((g) => m[g]).map((g) => ({ Generacion: g, Cantidad: m[g].length }));
  })();

  const lidRows = rows.filter((r) => r.LIDER === "SI");
  const lidFem  = lidRows.filter((r) => r.SEXO === "F").length;
  const lidMasc = lidRows.filter((r) => r.SEXO === "M").length;
  const lidEmp  = (() => {
    const allEmp   = groupBy(rows, "EMPRESA");
    const lidByEmp = groupBy(lidRows, "EMPRESA");
    return Object.entries(allEmp).map(([emp, r]) => ({
      EMPRESA: emp,
      pct_lideres: Math.round((lidByEmp[emp]?.length ?? 0) / r.length * 1000) / 10,
    }));
  })();

  const salEmp = (() => {
    const m = groupBy(salRows, "EMPRESA");
    return Object.entries(m).map(([emp, r]) => ({
      empresa: emp,
      promedio: Math.round(sumField(r, "SALARIO") / r.length),
    }));
  })();

  const brechaNivel = (() => {
    const m = groupBy(salRows, "NIVEL_AIC");
    return Object.entries(m).map(([niv, r]) => {
      const f = r.filter((x) => x.SEXO === "F");
      const h = r.filter((x) => x.SEXO === "M");
      return {
        nivel:        niv,
        prom_mujeres: f.length ? Math.round(sumField(f, "SALARIO") / f.length) : 0,
        prom_hombres: h.length ? Math.round(sumField(h, "SALARIO") / h.length) : 0,
      };
    });
  })();

  const nac = {
    resumen: {
      labels: ["Paraguayos", "Extranjeros"],
      values: [rows.filter(esParaguay).length, extranjeros],
    },
  };

  const extPorNac = (() => {
    const nacRows = rows.filter((r) => r.NACIONALIDAD);
    const m = groupBy(nacRows, "NACIONALIDAD");
    return Object.entries(m)
      .map(([nac, r]) => ({ nac: String(nac).toUpperCase(), count: r.length }))
      .sort((a, b) => b.count - a.count);
  })();

  const discapacidadRows = rows.filter((r) => {
    const v = String(r.DISCAPACIDAD ?? "").toUpperCase().trim();
    return v === "SI" || v === "SÍ" || v === "YES" || v === "1" || v === "TRUE";
  });
  const discapacidad = {
    count: discapacidadRows.length,
    pct: total > 0 ? (discapacidadRows.length / total * 100).toFixed(1) : "0.0",
    personas: discapacidadRows.map((r) => ({ tipo: String(r.DISCAPACIDAD ?? "Sí"), empresa: String(r.EMPRESA ?? "") })),
  };

  const antiguedadRangos = (() => {
    const rangos = [
      { label: "Menor a 1 año",    fn: (a: number) => a < 1 },
      { label: "Entre 1 y 5 años", fn: (a: number) => a >= 1 && a < 5 },
      { label: "Entre 5 y 10 años",fn: (a: number) => a >= 5 && a < 10 },
      { label: "Mayor a 10 años",  fn: (a: number) => a >= 10 },
    ];
    return rangos.map(({ label, fn }) => ({
      label,
      count: rows.filter((r) => r.ANTIGUEDAD_ANOS != null && fn(Number(r.ANTIGUEDAD_ANOS))).length,
    }));
  })();

  const antiguedadPorTipo = (() => {
    const grupos: [string, (r: Row) => boolean][] = [
      ["Agencias",  (r) => !TAC_MEDIA_EMP.has(empNorm(r)) && !CSC_EMP.has(empNorm(r))],
      ["TAC Media", (r) => TAC_MEDIA_EMP.has(empNorm(r))],
      ["CSC",       (r) => CSC_EMP.has(empNorm(r))],
    ];
    return grupos
      .map(([tipo, fn]) => {
        const r = rows.filter((x) => fn(x) && x.ANTIGUEDAD_ANOS != null);
        return { tipo, promedio: r.length ? Math.round(sumField(r, "ANTIGUEDAD_ANOS") / r.length * 10) / 10 : null };
      })
      .filter((g) => g.promedio !== null) as { tipo: string; promedio: number }[];
  })();

  const brechaEmpresa = (() => {
    const m = groupBy(salRows, "EMPRESA");
    return Object.entries(m).map(([emp, r]) => {
      const f = r.filter((x) => x.SEXO === "F");
      const h = r.filter((x) => x.SEXO === "M");
      return {
        empresa: emp,
        prom_mujeres: f.length ? Math.round(sumField(f, "SALARIO") / f.length) : 0,
        prom_hombres: h.length ? Math.round(sumField(h, "SALARIO") / h.length) : 0,
      };
    });
  })();

  const salGlobal = {
    mujeres: salRows.filter((r) => r.SEXO === "F").length
      ? Math.round(sumField(salRows.filter((r) => r.SEXO === "F"), "SALARIO") / salRows.filter((r) => r.SEXO === "F").length)
      : 0,
    hombres: salRows.filter((r) => r.SEXO === "M").length
      ? Math.round(sumField(salRows.filter((r) => r.SEXO === "M"), "SALARIO") / salRows.filter((r) => r.SEXO === "M").length)
      : 0,
  };

  const ANILLOS = ["ANILLO 1", "ANILLO 2", "ANILLO 3"];
  const anillosGenero = ANILLOS.map((anillo) => {
    const r = rows.filter((x) => String(x.SECCION ?? "").toUpperCase().trim() === anillo);
    return { anillo, mujeres: r.filter((x) => x.SEXO === "F").length, hombres: r.filter((x) => x.SEXO === "M").length };
  });

  return { kpis, genero, genDist, lidFem, lidMasc, lidEmp, salEmp, brechaNivel, brechaEmpresa, salGlobal, nac, anillosGenero, extPorNac, discapacidad, antiguedadRangos, antiguedadPorTipo };
}

function barColors(n: number) {
  return Array.from({ length: n }, (_, i) => LIGHT_COLOR_SEQ[i % LIGHT_COLOR_SEQ.length]);
}

function ChartCard({ title, children, span2 = false }: { title: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={`chart-card${span2 ? " md:col-span-2" : ""}`}>
      <h3 className="chart-title mb-4">{title}</h3>
      {children}
    </div>
  );
}


export default function NominaPage() {
  const { nominaData, setNominaData, clearNominaData, hydrating } = useDashboard();
  const { selected, register } = useFilter();
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<AnyObj | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [tab, setTab] = useState("distribucion");
  const [clearConfirm, setClearConfirm] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (nominaData && !data) {
      setData(nominaData);
      const rows = (nominaData.tabla as Row[]) ?? [];
      register(FILTER_CONFIGS, rows, defaultLatestYear(rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nominaData]);

  if (!mounted) return null;

  if (hydrating && !data) {
    return (
      <div className="flex items-center justify-center min-h-[72vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#4f8ef7] border-t-transparent" />
      </div>
    );
  }

  function handleRefresh() {
    setShowUpload(true);
  }

  function handleClear() {
    if (!clearConfirm) { setClearConfirm(true); return; }
    clearNominaData();
    setData(null);
    setClearConfirm(false);
    setShowUpload(false);
  }

  function handleResult(result: AnyObj) {
    const newRows = (result.tabla as Row[]) ?? [];
    let mergedRows = newRows;
    if (!replaceAll) {
      const newYears = new Set(newRows.map((r) => String(r.ANO_EVALUACION ?? "")));
      const existingRows = (data?.tabla as Row[]) ?? [];
      mergedRows = [
        ...existingRows.filter((r) => !newYears.has(String(r.ANO_EVALUACION ?? ""))),
        ...newRows,
      ];
    }
    const merged = { ...result, tabla: mergedRows };
    setData(merged);
    setNominaData(merged);
    setShowUpload(false);
    register(FILTER_CONFIGS, mergedRows, defaultLatestYear(mergedRows));
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[72vh] gap-6">
        <div className="text-center">
          <p className="label-xs mb-2" style={{ color: "var(--accent)" }}>Módulo de Nómina</p>
          <h1 className="page-title">Análisis de Colaboradores</h1>
          <p className="mt-2 text-sm max-w-sm mx-auto" style={{ color: "var(--text2)" }}>
            Subí el Excel de nómina para analizar headcount, géneros, generaciones y brecha salarial por empresa.
          </p>
        </div>
        <div className="w-full max-w-md">
          <FileUpload endpoint="/api/nomina" fieldName="file" multiple={false} onResult={handleResult}
            />
        </div>
      </div>
    );
  }

  const rawRows: Row[]  = (data.tabla as Row[]) ?? [];
  const rawYears = Array.from(new Set(rawRows.map((r) => String(r.ANO_EVALUACION ?? "")).filter(Boolean))).sort();
  const filteredRows    = applyFilters(rawRows, selected);
  const { kpis, genero, genDist, lidFem, lidMasc, lidEmp, salEmp, brechaNivel, brechaEmpresa, salGlobal, nac, anillosGenero, extPorNac, discapacidad, antiguedadRangos, antiguedadPorTipo } =
    computeFromRows(filteredRows);

  // ── Comparación ───────────────────────────────────────────────────────────
  const anosDisponiblesNom = Array.from(new Set(rawRows.map((r) => String(r.ANO_EVALUACION ?? "")).filter(Boolean))).sort();
  const compDataNom = Object.fromEntries(
    anosDisponiblesNom.map((ano) => [ano, computeFromRows(rawRows.filter((r) => String(r.ANO_EVALUACION ?? "") === ano))])
  );
  const YEAR_COLORS_NOM: Record<string, string> = {
    [anosDisponiblesNom[0]]: "#0d9488",
    [anosDisponiblesNom[1]]: "#6366f1",
    [anosDisponiblesNom[2]]: "#f59e0b",
  };

  return (
    <div>
      {/* Encabezado con botones */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <p className="label-xs" style={{ color: "var(--accent)" }}>Módulo de Nómina</p>
          <h1 className="page-title">Análisis de Colaboradores</h1>
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
              <button onClick={handleRefresh} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-medium transition-all" style={{ background: "var(--card2)", color: "var(--text2)", border: "1px solid var(--border)" }}>
                ↺ Actualizar datos
              </button>
            </>
          )}
        </div>
      </div>

      {/* Panel actualizar datos */}
      {showUpload && (
        <div className="mb-6 p-4 rounded-xl border" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>Actualizar datos de nómina</span>
            <button onClick={() => setShowUpload(false)} className="text-xs px-3 py-1 rounded-lg" style={{ background: "var(--card2)", color: "var(--text2)" }}>Cancelar</button>
          </div>
          <label className="flex items-center gap-2 mb-3 cursor-pointer select-none w-fit">
            <input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} className="accent-indigo-500 w-4 h-4" />
            <span className="text-xs" style={{ color: "var(--text2)" }}>Reemplazar todos los datos (elimina años anteriores)</span>
          </label>
          <FileUpload endpoint="/api/nomina" fieldName="file" multiple={false} onResult={handleResult}
            />
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiCard title="Colaboradores"  value={fmt(kpis.total)} />
        <KpiCard title="Empresas"       value={fmt(kpis.empresas)} />
        <KpiCard title="Colaboradores en Agencias"  value={fmt(kpis.agencias)} />
        <KpiCard title="Colaboradores en TAC Media" value={fmt(kpis.tac_media)} />
        <KpiCard title="Colaboradores en CSC"       value={fmt(kpis.csc)} />
      </div>

      {/* Tabs */}
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {/* Tab: Distribución */}
      {tab === "distribucion" && (
        <div className="tab-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartCard title="DISTRIBUCIÓN POR GÉNERO">
              {(() => {
                const pctF = kpis.total > 0 ? Math.round((genero.values[0] ?? 0) / kpis.total * 100) : 0;
                const pctM = kpis.total > 0 ? Math.round((genero.values[1] ?? 0) / kpis.total * 100) : 0;
                return (
                  <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col items-center gap-2 py-5 px-3 rounded-2xl"
                        style={{ background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.2)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/mujer.png" alt="Mujeres" style={{ height: 100, width: "auto" }} />
                        <div className="text-5xl font-black leading-none" style={{ color: "#EC4899" }}>{pctF}%</div>
                        <div className="text-base font-semibold" style={{ color: "var(--text2)" }}>Mujeres</div>
                        <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>{genero.values[0] ?? 0}</div>
                      </div>
                      <div className="flex flex-col items-center gap-2 py-5 px-3 rounded-2xl"
                        style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.15)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/hombre.png" alt="Hombres" style={{ height: 100, width: "auto" }} />
                        <div className="text-5xl font-black leading-none" style={{ color: "#2563EB" }}>{pctM}%</div>
                        <div className="text-base font-semibold" style={{ color: "var(--text2)" }}>Hombres</div>
                        <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>{genero.values[1] ?? 0}</div>
                      </div>
                    </div>
                    <div>
                      <div className="flex rounded-full overflow-hidden h-2.5">
                        <div style={{ width: `${pctF}%`, background: "linear-gradient(90deg,#db2777,#EC4899)" }} />
                        <div style={{ flex: 1, background: "linear-gradient(90deg,#2563EB,#1d4ed8)" }} />
                      </div>
                      <div className="flex justify-between text-xs mt-1.5" style={{ color: "var(--text2)" }}>
                        <span>Mujeres {pctF}%</span>
                        <span>Hombres {pctM}%</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </ChartCard>
            {genero.por_empresa.length > 0 && (
              <ChartCard title="GÉNERO POR EMPRESA">
                <PlotChart
                  light
                  data={[
                    { type: "bar", name: "Mujeres", x: genero.por_empresa.map((r) => r.EMPRESA), y: genero.por_empresa.map((r) => r.Mujeres), marker: { color: "#EC4899" } },
                    { type: "bar", name: "Hombres", x: genero.por_empresa.map((r) => r.EMPRESA), y: genero.por_empresa.map((r) => r.Hombres), marker: { color: "#2563EB" } },
                  ]}
                  layout={{ barmode: "group" }}
                  height={280}
                />
              </ChartCard>
            )}
            <ChartCard title="Líderes por Género">
              <PlotChart
                light
                data={[{
                  type: "pie", labels: ["Mujeres", "Hombres"], values: [lidFem, lidMasc],
                  hole: 0.45, textinfo: "label+percent",
                  textposition: "outside", textfont: { color: "#1e293b" },
                  marker: { colors: ["#7C3AED", "#2563EB"] },
                }]}
                layout={{ margin: { t: 16, r: 16, b: 16, l: 16 } }}
                height={280}
              />
            </ChartCard>
            {anillosGenero.some((a) => a.mujeres + a.hombres > 0) && (
              <ChartCard title="Distribución por Anillos y Género">
                <PlotChart
                  light
                  data={[
                    {
                      name: "ANILLO 3", type: "bar", orientation: "h",
                      y: ["HOMBRES", "MUJERES"],
                      x: [anillosGenero[2].hombres, anillosGenero[2].mujeres],
                      marker: { color: "#D97706" },
                      text: [String(anillosGenero[2].hombres), String(anillosGenero[2].mujeres)],
                      textposition: "inside", insidetextanchor: "middle",
                    },
                    {
                      name: "ANILLO 2", type: "bar", orientation: "h",
                      y: ["HOMBRES", "MUJERES"],
                      x: [anillosGenero[1].hombres, anillosGenero[1].mujeres],
                      marker: { color: "#2563EB" },
                      text: [String(anillosGenero[1].hombres), String(anillosGenero[1].mujeres)],
                      textposition: "inside", insidetextanchor: "middle",
                    },
                    {
                      name: "ANILLO 1", type: "bar", orientation: "h",
                      y: ["HOMBRES", "MUJERES"],
                      x: [anillosGenero[0].hombres, anillosGenero[0].mujeres],
                      marker: { color: "#059669" },
                      text: [String(anillosGenero[0].hombres), String(anillosGenero[0].mujeres)],
                      textposition: "inside", insidetextanchor: "middle",
                    },
                  ]}
                  layout={{ barmode: "group", xaxis: { title: { text: "Cantidad" } } }}
                  height={280}
                />
              </ChartCard>
            )}
            {/* Headcount por Empresa */}
            {(() => {
              const empMap = groupBy(filteredRows, "EMPRESA");
              const empData = Object.entries(empMap)
                .map(([emp, r]) => ({ empresa: emp, count: r.length }))
                .sort((a, b) => b.count - a.count);
              return empData.length > 0 ? (
                <ChartCard title="Headcount por Empresa">
                  <PlotChart
                    light
                    data={[{
                      type: "bar",
                      x: empData.map((r) => r.empresa),
                      y: empData.map((r) => r.count),
                      marker: { color: barColors(empData.length) },
                      text: empData.map((r) => String(r.count)),
                      textposition: "outside",
                    }]}
                    layout={{ yaxis: { title: { text: "Colaboradores" } }, margin: { t: 32, r: 16, b: 80, l: 60 } }}
                    height={280}
                  />
                </ChartCard>
              ) : null;
            })()}
            {/* Headcount por Nivel AIC */}
            {(() => {
              const NIVEL_ORDER = ["JUNIOR", "INTERMEDIO", "SENIOR", "GERENCIA", "DIRECTIVO"];
              const nivMap = groupBy(filteredRows.filter((r) => r.NIVEL_AIC), "NIVEL_AIC");
              const nivData = NIVEL_ORDER.filter((n) => nivMap[n])
                .map((n) => ({ nivel: n, count: nivMap[n].length }));
              return nivData.length > 0 ? (
                <ChartCard title="Headcount por Nivel AIC">
                  <PlotChart
                    light
                    data={[{
                      type: "bar",
                      x: nivData.map((r) => r.nivel),
                      y: nivData.map((r) => r.count),
                      marker: { color: barColors(nivData.length) },
                      text: nivData.map((r) => String(r.count)),
                      textposition: "outside",
                    }]}
                    layout={{ yaxis: { title: { text: "Colaboradores" } }, margin: { t: 32, r: 16, b: 60, l: 60 } }}
                    height={280}
                  />
                </ChartCard>
              ) : null;
            })()}
          </div>
        </div>
      )}

      {/* Tab: Demografía */}
      {tab === "demografia" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {nac.resumen.values[1] >= 0 && (
            <ChartCard title="Nacionalidad">
              <PlotChart
                light
                data={[{
                  type: "pie", labels: nac.resumen.labels, values: nac.resumen.values,
                  hole: 0.45, textinfo: "label+value+percent",
                  textposition: "outside",
                  textfont: { color: "#1e293b", size: 12 },
                  marker: { colors: ["#2563EB", "#059669"] },
                  automargin: true,
                }]}
                layout={{ margin: { t: 24, r: 80, b: 16, l: 80 } }}
                height={280}
              />
            </ChartCard>
          )}
          {extPorNac.length > 0 && (
            <ChartCard title="Colaboradores por Nacionalidad">
              <PlotChart
                light
                data={[{
                  type: "bar",
                  x: extPorNac.map((r) => r.nac),
                  y: extPorNac.map((r) => r.count),
                  marker: { color: barColors(extPorNac.length) },
                  text: extPorNac.map((r) => String(r.count)),
                  textposition: "outside",
                }]}
                height={280}
              />
            </ChartCard>
          )}
          <ChartCard title="Inclusión Laboral" span2>
            <div className="flex flex-col items-center justify-center gap-4 py-6 text-center">
              <div className="text-8xl font-black" style={{ color: "#059669", lineHeight: 1 }}>{discapacidad.pct}%</div>
              <div className="text-base" style={{ color: "var(--text2)" }}>Personas con Discapacidad</div>
              {discapacidad.count > 0 && (
                <div className="flex flex-col gap-2 mt-2">
                  {discapacidad.personas.map((p, i) => (
                    <div key={i}>
                      <div className="text-lg font-bold" style={{ color: "var(--text)" }}>{p.tipo}</div>
                      <div className="text-sm" style={{ color: "var(--text2)" }}>{p.empresa}</div>
                    </div>
                  ))}
                </div>
              )}
              {discapacidad.count === 0 && (
                <div className="text-base" style={{ color: "var(--text2)" }}>Sin registros</div>
              )}
              <div className="text-sm font-semibold mt-1" style={{ color: "var(--text3)" }}>
                {discapacidad.count} persona{discapacidad.count !== 1 ? "s" : ""} de {kpis.total} colaboradores
              </div>
            </div>
          </ChartCard>
          {genDist.length > 0 && (
            <ChartCard title="Distribución por Generaciones">
              <PlotChart
                light
                data={[{ type: "bar", x: genDist.map((r) => r.Generacion), y: genDist.map((r) => r.Cantidad), marker: { color: barColors(genDist.length) }, text: genDist.map((r) => String(r.Cantidad)), textposition: "outside" }]}
                height={280}
              />
            </ChartCard>
          )}
          <ChartCard title="Personas por Rango de Antigüedad">
            <PlotChart
              light
              data={[{
                type: "bar",
                x: antiguedadRangos.map((r) => r.label),
                y: antiguedadRangos.map((r) => r.count),
                marker: { color: [LIGHT_COLOR_SEQ[0], LIGHT_COLOR_SEQ[2], LIGHT_COLOR_SEQ[4], LIGHT_COLOR_SEQ[3]] },
                text: antiguedadRangos.map((r) => String(r.count)),
                textposition: "outside",
              }]}
              height={280}
            />
          </ChartCard>
          {antiguedadPorTipo.length > 0 && (
            <ChartCard title="Antigüedad Promedio por Tipo de Empresa">
              <PlotChart
                light
                data={[{
                  type: "bar",
                  x: antiguedadPorTipo.map((r) => r.tipo),
                  y: antiguedadPorTipo.map((r) => r.promedio),
                  marker: { color: [LIGHT_COLOR_SEQ[0], LIGHT_COLOR_SEQ[2], LIGHT_COLOR_SEQ[4], LIGHT_COLOR_SEQ[3]].slice(0, antiguedadPorTipo.length) },
                  text: antiguedadPorTipo.map((r) => String(r.promedio)),
                  textposition: "outside",
                }]}
                height={280}
              />
            </ChartCard>
          )}
        </div>
      )}

      {/* Tab: Brecha Salarial */}
      {tab === "brecha" && (
        <div className="space-y-5">
          {/* KPIs globales de brecha */}
          {salGlobal.mujeres > 0 || salGlobal.hombres > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl p-4 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--text2)" }}>Salario Promedio Mujeres</p>
                <p className="text-2xl font-bold" style={{ color: "#db2777" }}>
                  ₲{(salGlobal.mujeres / 1_000_000).toFixed(1)}M
                </p>
              </div>
              <div className="rounded-xl p-4 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--text2)" }}>Salario Promedio Hombres</p>
                <p className="text-2xl font-bold" style={{ color: "#2563EB" }}>
                  ₲{(salGlobal.hombres / 1_000_000).toFixed(1)}M
                </p>
              </div>
              <div className="rounded-xl p-4 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold mb-1" style={{ color: "var(--text2)" }}>Brecha Global H/M</p>
                <p className="text-2xl font-bold" style={{ color: salGlobal.hombres > salGlobal.mujeres ? "#f59e0b" : "#059669" }}>
                  {salGlobal.hombres > 0 ? `${((salGlobal.hombres - salGlobal.mujeres) / salGlobal.hombres * 100).toFixed(1)}%` : "—"}
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text3)" }}>
                  {salGlobal.hombres >= salGlobal.mujeres ? "hombres cobran más" : "mujeres cobran más"}
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Brecha por Nivel AIC */}
            {brechaNivel.length > 0 && (
              <ChartCard title="Salario Promedio H vs M por Nivel AIC" span2>
                <PlotChart
                  light
                  data={[
                    {
                      name: "Hombres", type: "bar",
                      x: brechaNivel.map((r) => r.nivel),
                      y: brechaNivel.map((r) => r.prom_hombres),
                      marker: { color: "#2563EB" },
                      text: brechaNivel.map((r) => r.prom_hombres > 0 ? `₲${(r.prom_hombres / 1_000_000).toFixed(1)}M` : ""),
                      textposition: "outside" as const,
                    },
                    {
                      name: "Mujeres", type: "bar",
                      x: brechaNivel.map((r) => r.nivel),
                      y: brechaNivel.map((r) => r.prom_mujeres),
                      marker: { color: "#db2777" },
                      text: brechaNivel.map((r) => r.prom_mujeres > 0 ? `₲${(r.prom_mujeres / 1_000_000).toFixed(1)}M` : ""),
                      textposition: "outside" as const,
                    },
                  ]}
                  layout={{ barmode: "group", yaxis: { title: { text: "Salario Promedio (₲)" } }, margin: { t: 32, r: 16, b: 80, l: 80 }, showlegend: true }}
                  height={320}
                />
              </ChartCard>
            )}

            {/* Brecha % por nivel — barras horizontales */}
            {brechaNivel.length > 0 && (
              <ChartCard title="Brecha Salarial % por Nivel AIC">
                {(() => {
                  const nivelConBrecha = brechaNivel
                    .map((r) => ({
                      nivel: r.nivel,
                      brecha: r.prom_hombres > 0
                        ? parseFloat(((r.prom_hombres - r.prom_mujeres) / r.prom_hombres * 100).toFixed(1))
                        : 0,
                    }))
                    .filter((r) => r.brecha !== 0);
                  return (
                    <PlotChart
                      light
                      data={[{
                        type: "bar", orientation: "h",
                        y: nivelConBrecha.map((r) => r.nivel),
                        x: nivelConBrecha.map((r) => r.brecha),
                        marker: { color: nivelConBrecha.map((r) => r.brecha > 0 ? "#f59e0b" : "#059669") },
                        text: nivelConBrecha.map((r) => `${r.brecha > 0 ? "+" : ""}${r.brecha}%`),
                        textposition: "outside" as const,
                      }]}
                      layout={{ xaxis: { title: { text: "% diferencia H vs M (positivo = hombres cobran más)" }, ticksuffix: "%" }, margin: { t: 16, r: 80, b: 48, l: 100 } }}
                      height={280}
                    />
                  );
                })()}
              </ChartCard>
            )}

            {/* Brecha por empresa — H vs M */}
            {brechaEmpresa.length > 0 && (
              <ChartCard title="Salario Promedio H vs M por Empresa" span2>
                <PlotChart
                  light
                  data={[
                    {
                      name: "Hombres", type: "bar",
                      x: brechaEmpresa.map((r) => r.empresa),
                      y: brechaEmpresa.map((r) => r.prom_hombres),
                      marker: { color: "#2563EB" },
                      text: brechaEmpresa.map((r) => r.prom_hombres > 0 ? `₲${(r.prom_hombres / 1_000_000).toFixed(1)}M` : ""),
                      textposition: "outside" as const,
                    },
                    {
                      name: "Mujeres", type: "bar",
                      x: brechaEmpresa.map((r) => r.empresa),
                      y: brechaEmpresa.map((r) => r.prom_mujeres),
                      marker: { color: "#db2777" },
                      text: brechaEmpresa.map((r) => r.prom_mujeres > 0 ? `₲${(r.prom_mujeres / 1_000_000).toFixed(1)}M` : ""),
                      textposition: "outside" as const,
                    },
                  ]}
                  layout={{ barmode: "group", yaxis: { title: { text: "Salario Promedio (₲)" } }, margin: { t: 32, r: 16, b: 80, l: 80 }, showlegend: true }}
                  height={320}
                />
              </ChartCard>
            )}

            {/* Salario promedio por empresa (total) */}
            {salEmp.length > 0 && (
              <ChartCard title="Salario Promedio por Empresa">
                <PlotChart
                  light
                  data={[{
                    type: "bar",
                    x: salEmp.map((r) => r.empresa),
                    y: salEmp.map((r) => r.promedio),
                    marker: { color: barColors(salEmp.length) },
                    text: salEmp.map((r) => `₲${(r.promedio / 1_000_000).toFixed(1)}M`),
                    textposition: "outside" as const,
                  }]}
                  layout={{ yaxis: { title: { text: "Salario Promedio (₲)" } }, margin: { t: 32, r: 16, b: 80, l: 80 } }}
                  height={280}
                />
              </ChartCard>
            )}
          </div>
        </div>
      )}

      {/* Tab: Comparación */}
      {tab === "comparacion" && (
        <div className="space-y-5">
          {anosDisponiblesNom.length < 2 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <p className="text-4xl">📂</p>
              <p className="text-sm" style={{ color: "var(--text2)" }}>
                Subí nóminas de al menos dos años para comparar.
              </p>
            </div>
          ) : (
            <>
              {/* KPI cards por año */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {anosDisponiblesNom.map((ano) => {
                  const d = compDataNom[ano];
                  return (
                    <div key={ano} className="rounded-xl p-4 space-y-2" style={{ background: "var(--card)", border: `1px solid ${YEAR_COLORS_NOM[ano] ?? "var(--border)"}` }}>
                      <p className="text-xs font-semibold" style={{ color: YEAR_COLORS_NOM[ano] ?? "var(--text2)" }}>{ano}</p>
                      <p className="text-lg font-bold" style={{ color: "var(--text)" }}>{d?.kpis.total ?? 0}</p>
                      <p className="text-xs" style={{ color: "var(--text2)" }}>Colaboradores</p>
                      <div className="flex gap-4 pt-1">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                            {d ? `${Math.round((d.genero.values[0] ?? 0) / Math.max(d.kpis.total, 1) * 100)}%` : "—"}
                          </p>
                          <p className="text-xs" style={{ color: "var(--text3)" }}>Mujeres</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                            {d?.kpis.empresas ?? 0}
                          </p>
                          <p className="text-xs" style={{ color: "var(--text3)" }}>Empresas</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Headcount por empresa — barras agrupadas */}
              {(() => {
                const empresas = Array.from(new Set(rawRows.map((r) => String(r.EMPRESA ?? "")).filter(Boolean))).sort();
                const traces = anosDisponiblesNom.map((ano) => ({
                  type: "bar" as const,
                  name: ano,
                  x: empresas,
                  y: empresas.map((emp) => rawRows.filter((r) => String(r.ANO_EVALUACION ?? "") === ano && String(r.EMPRESA ?? "") === emp).length),
                  marker: { color: YEAR_COLORS_NOM[ano] },
                }));
                return empresas.length > 0 ? (
                  <ChartCard title="Headcount por Empresa — Comparación Anual" span2>
                    <PlotChart
                      light
                      data={traces}
                      layout={{ barmode: "group", xaxis: { title: { text: "Empresa" } }, yaxis: { title: { text: "Colaboradores" } }, margin: { t: 8, r: 16, b: 80, l: 60 }, showlegend: true }}
                      height={360}
                    />
                  </ChartCard>
                ) : null;
              })()}

              {/* % Mujeres por año — barras simples */}
              <ChartCard title="% Mujeres por Año">
                <PlotChart
                  light
                  data={[{
                    type: "bar",
                    x: anosDisponiblesNom,
                    y: anosDisponiblesNom.map((ano) => {
                      const d = compDataNom[ano];
                      return d ? Math.round((d.genero.values[0] ?? 0) / Math.max(d.kpis.total, 1) * 100) : 0;
                    }),
                    marker: { color: anosDisponiblesNom.map((ano) => YEAR_COLORS_NOM[ano] ?? "#0d9488") },
                    text: anosDisponiblesNom.map((ano) => {
                      const d = compDataNom[ano];
                      return d ? `${Math.round((d.genero.values[0] ?? 0) / Math.max(d.kpis.total, 1) * 100)}%` : "";
                    }),
                    textposition: "outside" as const,
                  }]}
                  layout={{ yaxis: { ticksuffix: "%", range: [0, 100] }, margin: { t: 32, r: 16, b: 48, l: 60 } }}
                  height={300}
                />
              </ChartCard>

              {/* Salario promedio H vs M por año */}
              <ChartCard title="Salario Promedio H vs M por Año" span2>
                <PlotChart
                  light
                  data={[
                    {
                      name: "Hombres", type: "bar",
                      x: anosDisponiblesNom,
                      y: anosDisponiblesNom.map((ano) => compDataNom[ano]?.salGlobal?.hombres ?? 0),
                      marker: { color: "#2563EB" },
                      text: anosDisponiblesNom.map((ano) => {
                        const v = compDataNom[ano]?.salGlobal?.hombres ?? 0;
                        return v > 0 ? `₲${(v / 1_000_000).toFixed(1)}M` : "";
                      }),
                      textposition: "outside" as const,
                    },
                    {
                      name: "Mujeres", type: "bar",
                      x: anosDisponiblesNom,
                      y: anosDisponiblesNom.map((ano) => compDataNom[ano]?.salGlobal?.mujeres ?? 0),
                      marker: { color: "#db2777" },
                      text: anosDisponiblesNom.map((ano) => {
                        const v = compDataNom[ano]?.salGlobal?.mujeres ?? 0;
                        return v > 0 ? `₲${(v / 1_000_000).toFixed(1)}M` : "";
                      }),
                      textposition: "outside" as const,
                    },
                  ]}
                  layout={{ barmode: "group", yaxis: { title: { text: "Salario Promedio (₲)" } }, margin: { t: 32, r: 16, b: 48, l: 80 }, showlegend: true }}
                  height={320}
                />
              </ChartCard>

              {/* % Líderes por año */}
              <ChartCard title="% Líderes por Año">
                <PlotChart
                  light
                  data={[{
                    type: "bar",
                    x: anosDisponiblesNom,
                    y: anosDisponiblesNom.map((ano) => {
                      const d = compDataNom[ano];
                      if (!d) return 0;
                      return Math.round((d.lidFem + d.lidMasc) / Math.max(d.kpis.total, 1) * 100);
                    }),
                    marker: { color: anosDisponiblesNom.map((ano) => YEAR_COLORS_NOM[ano] ?? "#0d9488") },
                    text: anosDisponiblesNom.map((ano) => {
                      const d = compDataNom[ano];
                      if (!d) return "";
                      return `${Math.round((d.lidFem + d.lidMasc) / Math.max(d.kpis.total, 1) * 100)}%`;
                    }),
                    textposition: "outside" as const,
                  }]}
                  layout={{ yaxis: { ticksuffix: "%", range: [0, 100] }, margin: { t: 32, r: 16, b: 48, l: 60 } }}
                  height={300}
                />
              </ChartCard>
            </>
          )}
        </div>
      )}

      {tab === "detalle" && (
        <div className="mt-2">
          <DataTable rows={filteredRows} title="Detalle de Nómina" />
        </div>
      )}
    </div>
  );
}
