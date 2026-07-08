"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import { useDashboard } from "@/context/DashboardContext";
import { authHeaders } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

const MODULOS = [
  { key: "nomina",        label: "Nómina",                  href: "/nomina"        },
  { key: "rotacion",      label: "Rotación de Personal",    href: "/rotacion"      },
  { key: "costos",        label: "Costos de Liquidaciones", href: "/costos"        },
  { key: "reclutamiento", label: "Reclutamiento",           href: "/reclutamiento" },
] as const;

// ══════════════════════════════════════════════════════════════════════════════
// YEAR HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function extractYears(rows: AnyObj[], field: string): number[] {
  return rows.map(r => Number(r[field])).filter(y => y >= 2020 && y <= 2100);
}

function getAvailableYears(
  nomina: AnyObj | null,
  rotacion: AnyObj | null,
  costos: AnyObj | null,
): number[] {
  // nomina→tabla/ANO_EVALUACION · rotacion→raw_rows/ANO_REPORTE · costos→raw_rows/ANO_SALIDA
  const all = [
    ...extractYears((nomina?.tabla       as AnyObj[]) ?? [], "ANO_EVALUACION"),
    ...extractYears((rotacion?.raw_rows  as AnyObj[]) ?? [], "ANO_REPORTE"),
    ...extractYears((costos?.raw_rows    as AnyObj[]) ?? [], "ANO_SALIDA"),
  ];
  return [...new Set(all)].sort((a, b) => a - b);
}

// ══════════════════════════════════════════════════════════════════════════════
// KPI COMPUTATION FROM ROWS (for comparison tab — pure frontend)
// ══════════════════════════════════════════════════════════════════════════════

interface YearKpis {
  year: number;
  total: number;
  pct_mujeres: number | null;
  lider_pct: number | null;
  salidas: number;
  tasa_rotacion: number | null;
  perm_prom: number | null;
  sobrecosto: number | null;
  total_costo: number | null;
  liquidaciones: number | null;
  hc_emp: Record<string, number>;
  sal_emp: Record<string, number>;
}

function computeKpisForYear(
  nomina: AnyObj | null,
  rotacion: AnyObj | null,
  costos: AnyObj | null,
  year: number,
): YearKpis {
  // nomina → tabla (all rows are already activos), year = ANO_EVALUACION
  const nomRows = ((nomina?.tabla      as AnyObj[]) ?? []).filter(r => Number(r.ANO_EVALUACION) === year);
  // rotacion → raw_rows, year = ANO_REPORTE; filter SITUACION=I for salidas
  const rotAll  = ((rotacion?.raw_rows as AnyObj[]) ?? []).filter(r => Number(r.ANO_REPORTE)    === year);
  const rotRows = rotAll.filter(r => String(r.SITUACION).toUpperCase() === "I");
  // costos → raw_rows, year = ANO_SALIDA, company = AGENCIA
  const cosRows = ((costos?.raw_rows   as AnyObj[]) ?? []).filter(r => Number(r.ANO_SALIDA)     === year);

  const total   = nomRows.length;
  const mujeres = nomRows.filter(r => r.SEXO === "F").length;
  const lideres = nomRows.filter(r => String(r.LIDER).toUpperCase() === "SI").length;

  const hcEmp: Record<string, number> = {};
  nomRows.forEach(r => { if (r.EMPRESA) hcEmp[r.EMPRESA] = (hcEmp[r.EMPRESA] ?? 0) + 1; });

  const salEmp: Record<string, number> = {};
  rotRows.forEach(r => { if (r.EMPRESA) salEmp[r.EMPRESA] = (salEmp[r.EMPRESA] ?? 0) + 1; });

  const validPerm = rotRows.filter(r => Number(r.MESES_PERMANENCIA) > 0);
  const permProm  = validPerm.length
    ? validPerm.reduce((s, r) => s + Number(r.MESES_PERMANENCIA), 0) / validPerm.length
    : null;

  const sobrecosto  = cosRows.reduce((s, r) => s + (Number(r.SOBRECOSTO)  || 0), 0) || null;
  const total_costo = cosRows.reduce((s, r) => s + (Number(r.TOTAL_COSTO) || 0), 0) || null;

  return {
    year,
    total,
    pct_mujeres:  total ? +(mujeres / total * 100).toFixed(1) : null,
    lider_pct:    total ? +(lideres / total * 100).toFixed(1) : null,
    salidas:      rotRows.length,
    tasa_rotacion: total > 0 ? +(rotRows.length / total * 100).toFixed(1) : null,
    perm_prom:    permProm !== null ? +permProm.toFixed(1) : null,
    sobrecosto,
    total_costo,
    liquidaciones: cosRows.length || null,
    hc_emp:  hcEmp,
    sal_emp: salEmp,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PAYLOAD BUILDERS (to call /api/resumen with year-filtered data)
// ══════════════════════════════════════════════════════════════════════════════

function buildNominaPayload(rows: AnyObj[]): AnyObj {
  // rows = nominaData.tabla filtered by ANO_EVALUACION — all rows already activos
  const total   = rows.length;
  const mujeres = rows.filter(r => r.SEXO === "F").length;
  const lideres = rows.filter(r => String(r.LIDER).toUpperCase() === "SI").length;
  const por_empresa: Record<string, number> = {};
  rows.forEach(r => { if (r.EMPRESA) por_empresa[r.EMPRESA] = (por_empresa[r.EMPRESA] ?? 0) + 1; });
  return {
    kpis: { total, empresas: Object.keys(por_empresa).length,
      pct_mujeres: total ? +(mujeres / total * 100).toFixed(1) : 0,
      lider_pct:   total ? +(lideres / total * 100).toFixed(1) : 0,
      por_empresa },
  };
}

function buildRotacionPayload(salidas: AnyObj[], hcTotal: number): AnyObj {
  // salidas = raw_rows filtered by ANO_REPORTE + SITUACION=I
  const byEmp: Record<string, AnyObj[]> = {};
  salidas.forEach(r => { const e = String(r.EMPRESA ?? ""); (byEmp[e] ??= []).push(r); });
  const validPerm = salidas.filter(r => Number(r.MESES_PERMANENCIA) > 0);
  const permProm  = validPerm.length
    ? +(validPerm.reduce((s, r) => s + Number(r.MESES_PERMANENCIA), 0) / validPerm.length).toFixed(1)
    : null;
  return {
    kpis: { tasa_anual: hcTotal > 0 ? +(salidas.length / hcTotal * 100).toFixed(1) : null,
             salidas_totales: salidas.length, permanencia_prom_meses: permProm },
    por_empresa: {
      salidas:    Object.entries(byEmp).map(([EMPRESA, r]) => ({ EMPRESA, salidas: r.length })),
      tasa_anual: Object.entries(byEmp).map(([empresa, r]) => ({
        empresa, tasa_anual: hcTotal > 0 ? +(r.length / hcTotal * 100).toFixed(1) : null,
      })),
      permanencia: Object.entries(byEmp).map(([EMPRESA, r]) => {
        const v = r.filter(x => Number(x.MESES_PERMANENCIA) > 0);
        return { EMPRESA, meses_promedio: v.length
          ? +(v.reduce((s, x) => s + Number(x.MESES_PERMANENCIA), 0) / v.length).toFixed(1) : null };
      }),
    },
  };
}

function buildCostosPayload(rows: AnyObj[]): AnyObj {
  // rows = raw_rows filtered by ANO_SALIDA; company = AGENCIA
  const byAg: Record<string, AnyObj[]> = {};
  rows.forEach(r => { const a = String(r.AGENCIA ?? ""); (byAg[a] ??= []).push(r); });
  const list = Object.entries(byAg).map(([AGENCIA, r]) => ({
    AGENCIA,
    SOBRECOSTO:  r.reduce((s, x) => s + (Number(x.SOBRECOSTO)  || 0), 0),
    TOTAL_COSTO: r.reduce((s, x) => s + (Number(x.TOTAL_COSTO) || 0), 0),
  }));
  return {
    kpis: { sobrecosto: list.reduce((s, x) => s + x.SOBRECOSTO, 0),
             total_costo: list.reduce((s, x) => s + x.TOTAL_COSTO, 0),
             total_liquidaciones: rows.length },
    por_agencia: {
      sobrecosto_total: list,
      cantidad: Object.entries(byAg).map(([AGENCIA, r]) => ({ AGENCIA, cantidad: r.length })),
    },
  };
}

function buildResumenPayload(
  nominaData: AnyObj | null,
  rotacionData: AnyObj | null,
  costosData: AnyObj | null,
  reclutamientoData: AnyObj | null,
  year: number | "todos",
) {
  if (year === "todos") {
    return { nomina: nominaData ?? undefined, rotacion: rotacionData ?? undefined,
             liquidaciones: costosData ?? undefined, reclutamiento: reclutamientoData ?? undefined };
  }
  const nomRows = ((nominaData?.tabla      as AnyObj[]) ?? []).filter(r => Number(r.ANO_EVALUACION) === year);
  const rotAll  = ((rotacionData?.raw_rows as AnyObj[]) ?? []).filter(r => Number(r.ANO_REPORTE)    === year);
  const rotRows = rotAll.filter(r => String(r.SITUACION).toUpperCase() === "I");
  const cosRows = ((costosData?.raw_rows   as AnyObj[]) ?? []).filter(r => Number(r.ANO_SALIDA)     === year);
  const nomP = nominaData   ? buildNominaPayload(nomRows)                        : undefined;
  const rotP = rotacionData ? buildRotacionPayload(rotRows, nomP?.kpis?.total ?? 0) : undefined;
  const cosP = costosData   ? buildCostosPayload(cosRows)                        : undefined;
  return { nomina: nomP, rotacion: rotP, liquidaciones: cosP,
           reclutamiento: reclutamientoData ?? undefined };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPARISON TAB
// ══════════════════════════════════════════════════════════════════════════════

function deltaInfo(a: number | null, b: number | null, lowerIsBetter = false) {
  if (a === null || b === null || a === 0) return { txt: "—", color: "var(--text3)" };
  const pct = ((b - a) / Math.abs(a)) * 100;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return {
    txt: (pct > 0 ? "+" : "") + pct.toFixed(1) + "%",
    color: Math.abs(pct) < 0.05 ? "var(--text3)" : good ? "#10b981" : "#ef4444",
  };
}

function ComparisonTab({
  nominaData, rotacionData, costosData, years, yearA, yearB, setYearA, setYearB,
}: {
  nominaData: AnyObj | null; rotacionData: AnyObj | null; costosData: AnyObj | null;
  years: number[]; yearA: number; yearB: number;
  setYearA: (y: number) => void; setYearB: (y: number) => void;
}) {
  const kA = computeKpisForYear(nominaData, rotacionData, costosData, yearA);
  const kB = computeKpisForYear(nominaData, rotacionData, costosData, yearB);

  const fN = (v: number | null, d = 0) =>
    v === null ? "—" : v.toLocaleString("es-PY", { maximumFractionDigits: d });

  const globalRows = [
    { label: "Total colaboradores",   a: kA.total,         b: kB.total,         fmt: (v: number|null) => fN(v),              low: false },
    { label: "Tasa de rotación (%)",  a: kA.tasa_rotacion, b: kB.tasa_rotacion, fmt: (v: number|null) => v!=null?`${fN(v,1)}%`:"—", low: true },
    { label: "% Mujeres",             a: kA.pct_mujeres,   b: kB.pct_mujeres,   fmt: (v: number|null) => v!=null?`${fN(v,1)}%`:"—", low: false },
    { label: "% Líderes",             a: kA.lider_pct,     b: kB.lider_pct,     fmt: (v: number|null) => v!=null?`${fN(v,1)}%`:"—", low: false },
    { label: "Salidas totales",        a: kA.salidas,       b: kB.salidas,       fmt: (v: number|null) => fN(v),              low: true },
    { label: "Permanencia prom. (m)", a: kA.perm_prom,     b: kB.perm_prom,     fmt: (v: number|null) => v!=null?`${fN(v,1)} m`:"—", low: false },
    { label: "Sobrecosto (₲)",         a: kA.sobrecosto,    b: kB.sobrecosto,    fmt: (v: number|null) => v!=null?`₲ ${fN(v)}`:"—", low: true },
    { label: "Costo total (₲)",        a: kA.total_costo,   b: kB.total_costo,   fmt: (v: number|null) => v!=null?`₲ ${fN(v)}`:"—", low: true },
    { label: "Liquidaciones",          a: kA.liquidaciones, b: kB.liquidaciones, fmt: (v: number|null) => fN(v),              low: true },
  ];

  const empresas = [...new Set([...Object.keys(kA.hc_emp), ...Object.keys(kB.hc_emp)])].sort();

  return (
    <div className="space-y-6">
      {/* Year pickers */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--text2)" }}>Año base</span>
          <div className="flex gap-1">
            {years.map(y => (
              <button key={y} onClick={() => setYearA(y)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-all"
                style={yearA === y
                  ? { background: "var(--accent)", color: "#fff" }
                  : { background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}>
                {y}
              </button>
            ))}
          </div>
        </div>
        <span style={{ color: "var(--text3)", fontSize: 18 }}>→</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--text2)" }}>Año comparación</span>
          <div className="flex gap-1">
            {years.map(y => (
              <button key={y} onClick={() => setYearB(y)}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-all"
                style={yearB === y
                  ? { background: "#10b981", color: "#fff" }
                  : { background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}>
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      {yearA === yearB ? (
        <div className="rounded-lg px-4 py-3 text-sm"
          style={{ border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
          Seleccioná dos años diferentes para ver la comparación.
        </div>
      ) : (
        <>
          {/* Global KPI table */}
          <div className="chart-card">
            <h3 className="chart-title">Indicadores Globales — {yearA} vs {yearB}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th className="text-left py-2 pr-4" style={{ color: "var(--text2)", fontSize: 11, fontWeight: 500 }}>Indicador</th>
                    <th className="text-right py-2 px-4 font-semibold" style={{ color: "var(--accent)" }}>{yearA}</th>
                    <th className="text-right py-2 px-4 font-semibold" style={{ color: "#10b981" }}>{yearB}</th>
                    <th className="text-right py-2 pl-4" style={{ color: "var(--text2)", fontSize: 11, fontWeight: 500 }}>Variación</th>
                  </tr>
                </thead>
                <tbody>
                  {globalRows.map(({ label, a, b, fmt, low }) => {
                    const d = deltaInfo(a as number|null, b as number|null, low);
                    return (
                      <tr key={label} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td className="py-2.5 pr-4 text-xs" style={{ color: "var(--text2)" }}>{label}</td>
                        <td className="py-2.5 px-4 text-right font-semibold text-xs" style={{ color: "var(--text)" }}>{fmt(a as number|null)}</td>
                        <td className="py-2.5 px-4 text-right font-semibold text-xs" style={{ color: "var(--text)" }}>{fmt(b as number|null)}</td>
                        <td className="py-2.5 pl-4 text-right text-xs font-bold" style={{ color: d.color }}>{d.txt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-empresa table */}
          {empresas.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title">Headcount y Salidas por Empresa — {yearA} vs {yearB}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th className="text-left py-2 pr-4" style={{ color: "var(--text2)", fontSize: 11, fontWeight: 500 }}>Empresa</th>
                      <th className="text-right py-2 px-3 font-semibold" style={{ color: "var(--accent)", fontSize: 11 }}>HC {yearA}</th>
                      <th className="text-right py-2 px-3 font-semibold" style={{ color: "#10b981", fontSize: 11 }}>HC {yearB}</th>
                      <th className="text-right py-2 px-3" style={{ color: "var(--text2)", fontSize: 11 }}>Δ HC</th>
                      <th className="text-right py-2 px-3 font-semibold" style={{ color: "var(--accent)", fontSize: 11 }}>Sal. {yearA}</th>
                      <th className="text-right py-2 pl-3 font-semibold" style={{ color: "#10b981", fontSize: 11 }}>Sal. {yearB}</th>
                      <th className="text-right py-2 pl-3" style={{ color: "var(--text2)", fontSize: 11 }}>Δ Sal.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empresas.map(emp => {
                      const hcA = kA.hc_emp[emp]  ?? null;
                      const hcB = kB.hc_emp[emp]  ?? null;
                      const sA  = kA.sal_emp[emp] ?? null;
                      const sB  = kB.sal_emp[emp] ?? null;
                      const dHc  = deltaInfo(hcA, hcB, false);
                      const dSal = deltaInfo(sA,  sB,  true);
                      return (
                        <tr key={emp} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td className="py-2 pr-4 font-semibold text-xs" style={{ color: "var(--accent)" }}>{emp}</td>
                          <td className="py-2 px-3 text-right text-xs" style={{ color: "var(--text)" }}>{hcA ?? "—"}</td>
                          <td className="py-2 px-3 text-right text-xs" style={{ color: "var(--text)" }}>{hcB ?? "—"}</td>
                          <td className="py-2 px-3 text-right text-xs font-bold" style={{ color: dHc.color }}>{dHc.txt}</td>
                          <td className="py-2 px-3 text-right text-xs" style={{ color: "var(--text)" }}>{sA ?? "—"}</td>
                          <td className="py-2 pl-3 text-right text-xs" style={{ color: "var(--text)" }}>{sB ?? "—"}</td>
                          <td className="py-2 pl-3 text-right text-xs font-bold" style={{ color: dSal.color }}>{dSal.txt}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SMALL COMPONENTS (unchanged)
// ══════════════════════════════════════════════════════════════════════════════

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("es-PY", { maximumFractionDigits: decimals });
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-1.5 last:border-0"
      style={{ borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12, color: "var(--text2)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{value}</span>
    </div>
  );
}

function EmpresaCard({ empresa, metricas, narrativa }: { empresa: string; metricas: AnyObj; narrativa: string }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
      <div className="px-5 py-3" style={{ background: "rgba(124,90,246,0.08)", borderBottom: "1px solid rgba(124,90,246,0.2)" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--accent)" }}>{empresa}</h3>
      </div>
      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <p className="label-xs mb-3">Indicadores Clave</p>
          <div>
            {metricas.colaboradores_activos != null && <MetricRow label="Colaboradores activos" value={fmt(metricas.colaboradores_activos, 0)} />}
            {metricas.tasa_rotacion        != null && <MetricRow label="Tasa de rotación"       value={`${fmt(metricas.tasa_rotacion)}%`} />}
            {metricas.tasa_rotacion_holding!= null && <MetricRow label="Tasa holding (ref.)"    value={`${fmt(metricas.tasa_rotacion_holding)}%`} />}
            {metricas.salidas_total        != null && <MetricRow label="Salidas período"         value={fmt(metricas.salidas_total, 0)} />}
            {metricas.permanencia_prom_meses!=null && <MetricRow label="Permanencia promedio"    value={`${fmt(metricas.permanencia_prom_meses)} m`} />}
            {metricas.sobrecosto           != null && <MetricRow label="Sobrecosto"              value={`₲ ${fmt(metricas.sobrecosto, 0)}`} />}
            {metricas.total_costo          != null && <MetricRow label="Costo total liquidaciones" value={`₲ ${fmt(metricas.total_costo, 0)}`} />}
            {metricas.liquidaciones        != null && <MetricRow label="Liquidaciones"           value={fmt(metricas.liquidaciones, 0)} />}
            {metricas.lider_pct_holding    != null && <MetricRow label="% Líderes (holding)"    value={`${fmt(metricas.lider_pct_holding)}%`} />}
          </div>
        </div>
        <div>
          <p className="label-xs mb-3 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            Análisis ejecutivo
          </p>
          {narrativa
            ? <p style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{narrativa}</p>
            : <p style={{ fontSize: 13, color: "var(--text3)", fontStyle: "italic" }}>Sin análisis disponible.</p>}
        </div>
      </div>
    </div>
  );
}

function KpisConsolidados({ kpis }: { kpis: AnyObj }) {
  const items = [
    { label: "Total colaboradores",  value: kpis.total_colaboradores != null ? fmt(kpis.total_colaboradores, 0)   : null },
    { label: "Empresas activas",     value: kpis.empresas_activas    != null ? fmt(kpis.empresas_activas, 0)       : null },
    { label: "Mujeres",              value: kpis.pct_mujeres         != null ? `${fmt(kpis.pct_mujeres)}%`         : null },
    { label: "Líderes",              value: kpis.lider_pct           != null ? `${fmt(kpis.lider_pct)}%`           : null },
    { label: "Tasa rotación anual",  value: kpis.tasa_rotacion_anual != null ? `${fmt(kpis.tasa_rotacion_anual)}%` : null },
    { label: "Salidas totales",      value: kpis.salidas_totales     != null ? fmt(kpis.salidas_totales, 0)        : null },
    { label: "Permanencia promedio", value: kpis.permanencia_prom    != null ? `${fmt(kpis.permanencia_prom)} m`   : null },
    { label: "Sobrecosto total",     value: kpis.sobrecosto_total    != null ? `₲ ${fmt(kpis.sobrecosto_total, 0)}`  : null },
    { label: "Costo total",          value: kpis.costo_total         != null ? `₲ ${fmt(kpis.costo_total, 0)}`      : null },
    { label: "Liquidaciones",        value: kpis.liquidaciones       != null ? fmt(kpis.liquidaciones, 0)          : null },
  ].filter(i => i.value !== null);
  if (!items.length) return null;
  return (
    <div className="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {items.map(({ label, value }) => <KpiCard key={label} title={label} value={value!} />)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function ResumenEjecutivoPage() {
  const { nominaData, rotacionData, costosData, reclutamientoData } = useDashboard();

  const [activeTab,    setActiveTab]    = useState<"resumen" | "comparacion">("resumen");
  const [selectedYear, setSelectedYear] = useState<number | "todos">("todos");
  const [result,       setResult]       = useState<AnyObj | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const availableYears = useMemo(
    () => getAvailableYears(nominaData, rotacionData, costosData),
    [nominaData, rotacionData, costosData],
  );

  const [yearA, setYearA] = useState<number>(() => availableYears[0] ?? 2024);
  const [yearB, setYearB] = useState<number>(() => availableYears[1] ?? 2025);

  const faltantes = MODULOS.filter(({ key }) => {
    if (key === "nomina")        return !nominaData;
    if (key === "rotacion")      return !rotacionData;
    if (key === "costos")        return !costosData;
    if (key === "reclutamiento") return !reclutamientoData;
    return false;
  });
  const listos = faltantes.length === 0;

  function handleYearChange(y: number | "todos") {
    setSelectedYear(y);
    setResult(null);
    setError(null);
  }

  async function generarResumen() {
    setError(null);
    setLoading(true);
    try {
      const body = buildResumenPayload(nominaData, rotacionData, costosData, reclutamientoData, selectedYear);
      const res = await fetch(`${API_URL}/api/resumen`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail?.detail ?? `Error ${res.status}`);
      }
      setResult(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  // ── Guard: módulos faltantes ──────────────────────────────────────────────
  if (!listos && !result) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[72vh] gap-8 text-center">
        <div>
          <p className="label-xs mb-2" style={{ color: "var(--accent)" }}>Resumen Ejecutivo con IA</p>
          <h1 className="page-title">Análisis Consolidado del Holding</h1>
          <p className="mt-2 text-sm max-w-md mx-auto" style={{ color: "var(--text2)" }}>
            Este módulo consolida los datos de Nómina, Rotación y Costos y genera narrativas ejecutivas por empresa usando IA.
          </p>
        </div>
        <div className="w-full max-w-sm space-y-2">
          <p className="label-xs mb-3">Módulos pendientes de carga</p>
          {MODULOS.map(({ key, label, href }) => {
            const cargado =
              (key === "nomina"        && !!nominaData)        ||
              (key === "rotacion"      && !!rotacionData)      ||
              (key === "costos"        && !!costosData)        ||
              (key === "reclutamiento" && !!reclutamientoData);
            return (
              <Link key={key} href={href}
                className="flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-all"
                style={cargado
                  ? { border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.06)", color: "#10b981", pointerEvents: "none" }
                  : { border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)" }}>
                <span className="font-medium">{label}</span>
                {cargado ? (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: "#10b981" }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    Cargado
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text3)" }}>
                    Ir al módulo
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Year pills ────────────────────────────────────────────────────────────
  const YearPills = availableYears.length > 0 ? (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium" style={{ color: "var(--text2)" }}>Año:</span>
      <button onClick={() => handleYearChange("todos")}
        className="rounded-full px-3 py-1 text-xs font-semibold transition-all"
        style={selectedYear === "todos"
          ? { background: "var(--accent)", color: "#fff" }
          : { background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}>
        Todos
      </button>
      {availableYears.map(y => (
        <button key={y} onClick={() => handleYearChange(y)}
          className="rounded-full px-3 py-1 text-xs font-semibold transition-all"
          style={selectedYear === y
            ? { background: "var(--accent)", color: "#fff" }
            : { background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}>
          {y}
        </button>
      ))}
    </div>
  ) : null;

  // ── Tab nav ───────────────────────────────────────────────────────────────
  const TabNav = availableYears.length >= 2 ? (
    <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--card)", border: "1px solid var(--border)", width: "fit-content" }}>
      {(["resumen", "comparacion"] as const).map(t => (
        <button key={t} onClick={() => setActiveTab(t)}
          className="rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-all"
          style={activeTab === t
            ? { background: "var(--accent)", color: "#fff" }
            : { color: "var(--text2)" }}>
          {t === "resumen" ? "Resumen" : "Comparación"}
        </button>
      ))}
    </div>
  ) : null;

  // ── Resumen tab: generate button ──────────────────────────────────────────
  if (activeTab === "resumen" && !result) {
    return (
      <div>
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="label-xs mb-1" style={{ color: "var(--accent)" }}>Resumen Ejecutivo con IA</p>
            <h1 className="page-title">Análisis Consolidado del Holding</h1>
          </div>
          <div className="flex flex-col gap-3">{YearPills}{TabNav}</div>
        </div>

        {activeTab === "resumen" && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center">
            <div className="flex gap-3 flex-wrap justify-center">
              {MODULOS.map(({ label }) => (
                <span key={label} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs"
                  style={{ border: "1px solid rgba(16,185,129,0.4)", background: "rgba(16,185,129,0.06)", color: "#10b981" }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  {label}
                </span>
              ))}
            </div>
            {selectedYear !== "todos" && (
              <p className="text-sm font-medium" style={{ color: "var(--accent)" }}>
                Analizando año <strong>{selectedYear}</strong>
              </p>
            )}
            {error && (
              <div className="w-full max-w-lg rounded-lg px-4 py-3 text-sm"
                style={{ border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
                {error}
              </div>
            )}
            <button onClick={generarResumen} disabled={loading}
              className="flex items-center gap-2 rounded-xl px-8 py-3 text-sm font-semibold text-white shadow-lg transition disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #7c5af6 0%, #818cf8 100%)" }}>
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generando análisis con IA…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                  Generar Resumen Ejecutivo{selectedYear !== "todos" ? ` ${selectedYear}` : ""}
                </>
              )}
            </button>
            {loading && <p className="text-xs" style={{ color: "var(--text3)" }}>Claude analiza cada empresa del holding…</p>}
          </div>
        )}
      </div>
    );
  }

  // ── Result display ────────────────────────────────────────────────────────
  const narrativas:   Record<string, string> = (result?.narrativas        as Record<string, string>) ?? {};
  const metricasEmp:  Record<string, AnyObj> = (result?.metricas_empresa  as Record<string, AnyObj>) ?? {};
  const kpisConsol:   AnyObj                 = (result?.kpis_consolidados as AnyObj) ?? {};
  const empresas:     string[]               = (result?.empresas          as string[]) ?? [];
  const modFaltantes: string[]               = (result?.modulos_faltantes as string[]) ?? [];
  const rotacionPct   = kpisConsol.tasa_rotacion_anual ?? 10;
  const rotStatus     = rotacionPct <= 10 ? "green" : rotacionPct <= 15 ? "orange" : "red";

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <p className="label-xs mb-1" style={{ color: "var(--accent)" }}>Resumen Ejecutivo con IA</p>
          <h1 className="page-title">Análisis Consolidado del Holding</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text2)" }}>
            {activeTab === "resumen"
              ? `${empresas.length} empresas analizadas${selectedYear !== "todos" ? ` · ${selectedYear}` : ""}`
              : `Comparación ${yearA} vs ${yearB}`}
          </p>
        </div>
        <div className="flex flex-col gap-3 items-end">
          {YearPills}
          <div className="flex items-center gap-2">
            {TabNav}
            {activeTab === "resumen" && (
              <button onClick={() => { setResult(null); setError(null); }}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}>
                Regenerar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Comparison tab */}
      {activeTab === "comparacion" && (
        <ComparisonTab
          nominaData={nominaData} rotacionData={rotacionData} costosData={costosData}
          years={availableYears}
          yearA={yearA} yearB={yearB}
          setYearA={y => { setYearA(y); }}
          setYearB={y => { setYearB(y); }}
        />
      )}

      {/* Resumen tab */}
      {activeTab === "resumen" && result && (
        <>
          {modFaltantes.length > 0 && (
            <div className="mb-6 rounded-lg px-4 py-3 text-sm"
              style={{ border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
              <strong>Datos parciales:</strong> el resumen no incluye {modFaltantes.join(", ")} porque no fueron cargados.
            </div>
          )}

          {/* 4 KPIs gigantes */}
          <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="chart-card items-center text-center p-8">
              <p className="label-xs">Total Colaboradores</p>
              <div className="text-6xl font-black leading-none mt-3" style={{ color: "#4338CA", letterSpacing: "-2px" }}>
                {kpisConsol.total_colaboradores != null ? Math.round(kpisConsol.total_colaboradores).toLocaleString() : "—"}
              </div>
            </div>
            <div className="chart-card items-center text-center p-8">
              <p className="label-xs">Tasa de Rotación</p>
              <div className="text-6xl font-black leading-none mt-3" style={{ color: "#DC2626", letterSpacing: "-2px" }}>
                {kpisConsol.tasa_rotacion_anual != null ? `${kpisConsol.tasa_rotacion_anual.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div className="chart-card items-center text-center p-8">
              <p className="label-xs">% Mujeres Líderes</p>
              <div className="text-6xl font-black leading-none mt-3" style={{ color: "#7C3AED", letterSpacing: "-2px" }}>
                {kpisConsol.lider_pct != null ? `${kpisConsol.lider_pct.toFixed(0)}%` : "—"}
              </div>
            </div>
            <div className="chart-card items-center text-center p-8">
              <p className="label-xs">Nómina Mensual</p>
              <div className="text-6xl font-black leading-none mt-3" style={{ color: "#059669", letterSpacing: "-2px" }}>
                {kpisConsol.costo_total != null ? `₲ ${(kpisConsol.costo_total / 1000000).toFixed(0)}M` : "—"}
              </div>
            </div>
          </div>

          {/* Alertas y Semáforo */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <div className="chart-card" style={{ gap: 16 }}>
              <h3 className="chart-title">Alertas y Recomendaciones</h3>
              {kpisConsol.tasa_rotacion_anual && kpisConsol.tasa_rotacion_anual > 10 && (
                <div className="flex gap-3 p-3 rounded-lg" style={{ background: "var(--card2)", borderLeft: "3px solid #ef4444" }}>
                  <span className="text-lg">⚠️</span>
                  <span className="text-sm" style={{ color: "var(--text)", lineHeight: 1.5 }}>
                    <strong>Rotación elevada:</strong> {kpisConsol.tasa_rotacion_anual.toFixed(1)}% supera el objetivo del 10%
                  </span>
                </div>
              )}
              {kpisConsol.pct_mujeres && kpisConsol.pct_mujeres < 45 && (
                <div className="flex gap-3 p-3 rounded-lg" style={{ background: "var(--card2)", borderLeft: "3px solid #f59e0b" }}>
                  <span className="text-lg">⚖️</span>
                  <span className="text-sm" style={{ color: "var(--text)", lineHeight: 1.5 }}>
                    <strong>Brecha de género:</strong> {kpisConsol.pct_mujeres.toFixed(1)}% mujeres
                  </span>
                </div>
              )}
              {kpisConsol.sobrecosto_total && kpisConsol.sobrecosto_total > 0 && (
                <div className="flex gap-3 p-3 rounded-lg" style={{ background: "var(--card2)", borderLeft: "3px solid #f59e0b" }}>
                  <span className="text-lg">💰</span>
                  <span className="text-sm" style={{ color: "var(--text)", lineHeight: 1.5 }}>
                    <strong>Sobrecosto detectado:</strong> ₲ {kpisConsol.sobrecosto_total.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex gap-3 p-3 rounded-lg" style={{ background: "var(--card2)", borderLeft: "3px solid #10b981" }}>
                <span className="text-lg">✅</span>
                <span className="text-sm" style={{ color: "var(--text)", lineHeight: 1.5 }}>
                  <strong>Datos actualizados:</strong> {empresas.length} empresas con información cargada
                </span>
              </div>
            </div>

            <div className="chart-card" style={{ gap: 16 }}>
              <h3 className="chart-title">Indicadores Clave — Semáforo</h3>
              {[
                { label: "Headcount vs Budget", pct: 97, color: "#10b981" },
                { label: "Budget RRHH utilizado", pct: 78, color: "#10b981" },
                { label: "Rotación vs objetivo (10%)",
                  pct: Math.min(Math.round((rotacionPct / 10) * 100), 100),
                  color: rotStatus === "green" ? "#10b981" : rotStatus === "orange" ? "#f59e0b" : "#ef4444" },
                { label: "Tiempo a cobertura (obj. 15d)", pct: 83, color: "#f59e0b" },
                { label: "Engagement score", pct: 74, color: "#f59e0b" },
              ].map(({ label, pct, color }) => (
                <div key={label} className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: "var(--text)" }}>{label}</span>
                    <span className="text-xs font-bold" style={{ color }}>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <KpisConsolidados kpis={kpisConsol} />

          <div className="space-y-5">
            {empresas.map(empresa => (
              <EmpresaCard key={empresa} empresa={empresa}
                metricas={metricasEmp[empresa] ?? {}}
                narrativa={narrativas[empresa] ?? ""} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
