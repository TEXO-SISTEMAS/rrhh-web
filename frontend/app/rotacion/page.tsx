"use client";

import { useState, useEffect } from "react";
import FileUpload from "@/components/FileUpload";
import KpiCard from "@/components/KpiCard";
import PlotChart, { LIGHT_COLOR_SEQ } from "@/components/PlotChart";
import TabBar from "@/components/TabBar";
import DataTable from "@/components/DataTable";
import { useDashboard } from "@/context/DashboardContext";
import { useFilter } from "@/context/FilterContext";
import { Row, groupBy, applyFilters, FilterConfig, defaultYear2025 } from "@/lib/filterUtils";

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FILTER_CONFIGS: FilterConfig[] = [
  { label: "Empresa",     field: "EMPRESA" },
  { label: "Tipo Salida", field: "TIPO_SALIDA" },
  { label: "Departamento", field: "DEPARTAMENTO" },
];

const MESES_NOMBRE: Record<number, string> = {
  1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May", 6: "Jun",
  7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
};

const TABS = [
  { id: "general",      label: "Rotación General",     icon: "🔄" },
  { id: "empresa",      label: "Por Empresa",          icon: "🏢" },
  { id: "cargo",        label: "Por Cargo / Área",     icon: "📋" },
  { id: "tendencia",    label: "Tendencia",            icon: "📈" },
  { id: "detalle",      label: "Detalle",              icon: "📄" },
  { id: "respuestas",   label: "Respuestas",           icon: "💬" },
];

// ── Paleta corporativa para directorio ───────────────────────────────────────
const C_BLUE   = "#2563EB"; // dato principal / activos
const C_GRAY   = "#94a3b8"; // dato secundario / referencia
const C_GREEN  = "#22c55e"; // ingresos / positivo
const C_RED    = "#ef4444"; // salidas / negativo / involuntaria
const C_ORANGE = "#f97316"; // línea de tendencia / tasa

function barColors(n: number) {
  return Array.from({ length: n }, () => C_RED);
}

function isSalida(r: Row) {
  const sit  = String(r.SITUACION ?? "").trim().toUpperCase();
  const tipo = String(r.TIPO_SALIDA ?? "").trim().toUpperCase();
  return sit === "I" && tipo !== "" && tipo !== "NAN";
}

function isAnySalida(r: Row) {
  return String(r.SITUACION ?? "").trim().toUpperCase() === "I";
}

function computeFromRows(allRows: Row[]) {
  const salidas      = allRows.filter(isSalida);
  const todasSalidas = allRows.filter(isAnySalida);
  const hcEnero      = allRows.filter((r) => Number(r.MES_REPORTE) === 1).length;
  const empresas     = new Set(allRows.map((r) => r.EMPRESA).filter(Boolean)).size;
  const vol          = salidas.filter((r) => { const t = String(r.TIPO_SALIDA ?? "").toUpperCase(); return t.includes("VOL") && !t.includes("INV"); }).length;
  const invol        = salidas.filter((r) => String(r.TIPO_SALIDA ?? "").toUpperCase().includes("INV")).length;
  const permArr      = todasSalidas.map((r) => Number(r.MESES_PERMANENCIA)).filter((v) => !isNaN(v));
  const permProm     = permArr.length ? Math.round((permArr.reduce((a, b) => a + b, 0) / permArr.length) * 10) / 10 : null;
  const tasa         = hcEnero > 0 ? Math.round(todasSalidas.length / hcEnero * 1000) / 10 : null;

  const kpis = { tasa_anual: tasa, salidas_totales: todasSalidas.length, empresas, voluntarias: vol, involuntarias: invol, permanencia_prom_meses: permProm };

  const tipoSalida = (() => {
    const m = groupBy(salidas.filter((r) => r.TIPO_SALIDA && String(r.TIPO_SALIDA).toUpperCase() !== "NAN"), "TIPO_SALIDA");
    return { labels: Object.keys(m), values: Object.values(m).map((v) => v.length) };
  })();

  const categorizarMotivo = (raw: string): string | null => {
    const v = raw.trim().toUpperCase();
    if (v === "RENUNCIA") return "Renuncia";
    if (v.includes("DESPIDO INJUSTIFICADO")) return "Despido Injustificado";
    if (v.includes("PRUEBA")) return "Término de Contrato de Prueba";
    return null;
  };

  const motOrig = (() => {
    const counts: Record<string, number> = {};
    for (const r of todasSalidas) {
      const raw = String(r.MOTIVO_SALIDA ?? "").trim();
      if (!raw || raw.toUpperCase() === "NAN") continue;
      const cat = categorizarMotivo(raw);
      if (!cat) continue;
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return Object.entries(counts).map(([motivo, cantidad]) => ({ motivo, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
  })();

  const tasaMensual = (() => {
    const byAnoMes: Record<string, Record<number, { sal: number; hc: number }>> = {};
    for (const r of allRows) {
      const ano = String(r.ANO_REPORTE ?? "");
      const mes = Number(r.MES_REPORTE);
      if (!ano || isNaN(mes)) continue;
      byAnoMes[ano] = byAnoMes[ano] ?? {};
      byAnoMes[ano][mes] = byAnoMes[ano][mes] ?? { sal: 0, hc: 0 };
      byAnoMes[ano][mes].hc++;
      if (isAnySalida(r)) byAnoMes[ano][mes].sal++;
    }
    const rows: AnyObj[] = [];
    for (const [ano, meses] of Object.entries(byAnoMes)) {
      for (const [mes, d] of Object.entries(meses)) {
        const tasa = d.hc > 0 ? Math.round(d.sal / d.hc * 1000) / 10 : 0;
        rows.push({ ano, mes: Number(mes), mes_nombre: MESES_NOMBRE[Number(mes)], tasa });
      }
    }
    return rows.sort((a, b) => Number(a.ano) - Number(b.ano) || a.mes - b.mes);
  })();

  const salEmp = Object.entries(groupBy(todasSalidas, "EMPRESA"))
    .map(([EMPRESA, r]) => ({ EMPRESA, salidas: r.length }))
    .sort((a, b) => a.salidas - b.salidas);

  const tasaEmp = (() => {
    const byEmpAno: Record<string, Record<string, { sal: number; hcEnero: number }>> = {};
    for (const r of allRows) {
      const emp = String(r.EMPRESA ?? ""); const ano = String(r.ANO_REPORTE ?? "");
      if (!emp || !ano) continue;
      byEmpAno[emp] = byEmpAno[emp] ?? {};
      byEmpAno[emp][ano] = byEmpAno[emp][ano] ?? { sal: 0, hcEnero: 0 };
      if (isAnySalida(r)) byEmpAno[emp][ano].sal++;
      if (Number(r.MES_REPORTE) === 1) byEmpAno[emp][ano].hcEnero++;
    }
    const rows: { empresa: string; tasa: number }[] = [];
    for (const [emp, anos] of Object.entries(byEmpAno)) {
      const sorted = Object.entries(anos).sort((a, b) => b[0].localeCompare(a[0]));
      for (const [, d] of sorted) {
        if (d.hcEnero > 0) { rows.push({ empresa: emp, tasa: Math.round(d.sal / d.hcEnero * 1000) / 10 }); break; }
      }
    }
    return rows.sort((a, b) => a.tasa - b.tasa);
  })();

  const tipoEmp = Object.entries(
    salidas.filter((r) => r.TIPO_SALIDA && String(r.TIPO_SALIDA).toUpperCase() !== "NAN")
      .reduce((acc, r) => {
        const key = `${r.EMPRESA}||${r.TIPO_SALIDA}`;
        acc[key] = (acc[key] ?? 0) + 1; return acc;
      }, {} as Record<string, number>)
  ).map(([k, n]) => { const [empresa, tipo] = k.split("||"); return { empresa, tipo, n }; });

  const motivoEmp = (() => {
    const acc: Record<string, number> = {};
    for (const r of todasSalidas) {
      const raw = String(r.MOTIVO_SALIDA ?? "").trim();
      if (!raw || raw.toUpperCase() === "NAN") continue;
      const cat = categorizarMotivo(raw);
      if (!cat) continue;
      const key = `${r.EMPRESA}||${cat}`;
      acc[key] = (acc[key] ?? 0) + 1;
    }
    return Object.entries(acc).map(([k, n]) => { const [empresa, motivo] = k.split("||"); return { empresa, motivo, n }; });
  })();

  const permEmp = Object.entries(groupBy(todasSalidas.filter((r) => r.MESES_PERMANENCIA != null && !isNaN(Number(r.MESES_PERMANENCIA))), "EMPRESA"))
    .map(([emp, r]) => ({ empresa: emp, meses: Math.round(r.reduce((a, x) => a + Number(x.MESES_PERMANENCIA), 0) / r.length * 10) / 10 }))
    .filter((r) => r.meses > 0).sort((a, b) => a.meses - b.meses);

  // Permanencia de activos: snapshot del último mes disponible, calcula meses desde FECHA_INGRESO
  const permEmpActivos = (() => {
    const anos = allRows.map((r) => Number(r.ANO_REPORTE)).filter((v) => !isNaN(v));
    const ultAno = anos.length ? Math.max(...anos) : null;
    if (!ultAno) return [];
    const rowsAno = allRows.filter((r) => Number(r.ANO_REPORTE) === ultAno);
    const meses = rowsAno.map((r) => Number(r.MES_REPORTE)).filter((v) => !isNaN(v));
    const ultMes = meses.length ? Math.max(...meses) : null;
    if (!ultMes) return [];
    const snap = rowsAno.filter((r) =>
      Number(r.MES_REPORTE) === ultMes &&
      String(r.SITUACION ?? "").trim().toUpperCase() === "A" &&
      (r.FECHA_INGRESO != null && String(r.FECHA_INGRESO).trim() !== "" && String(r.FECHA_INGRESO).trim() !== "null")
    );
    const refDate = new Date(ultAno, ultMes - 1, 1);
    const byEmp: Record<string, number[]> = {};
    for (const r of snap) {
      const fi = new Date(String(r.FECHA_INGRESO));
      if (isNaN(fi.getTime())) continue;
      const mesesPerm = Math.round(((refDate.getTime() - fi.getTime()) / (1000 * 60 * 60 * 24 * 30.44)) * 10) / 10;
      if (mesesPerm <= 0) continue;
      const emp = String(r.EMPRESA ?? "").trim();
      if (!emp) continue;
      byEmp[emp] = byEmp[emp] ?? [];
      byEmp[emp].push(mesesPerm);
    }
    return Object.entries(byEmp)
      .map(([empresa, vals]) => ({ empresa, n: vals.length, meses: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 }))
      .filter((r) => r.meses > 0)
      .sort((a, b) => a.meses - b.meses);
  })();

  const topCargos = Object.entries(groupBy(todasSalidas.filter((r) => r.CARGO && String(r.CARGO).toUpperCase() !== "NAN"), "CARGO"))
    .map(([cargo, r]) => ({ cargo, salidas: r.length })).sort((a, b) => b.salidas - a.salidas).slice(0, 10);

  const permCargo = Object.entries(groupBy(todasSalidas.filter((r) => r.CARGO && r.MESES_PERMANENCIA != null), "CARGO"))
    .map(([cargo, r]) => ({ cargo, meses: Math.round(r.reduce((a, x) => a + Number(x.MESES_PERMANENCIA), 0) / r.length * 10) / 10 }))
    .filter((r) => r.meses > 0).sort((a, b) => a.meses - b.meses).slice(0, 10);

  const topAreas = Object.entries(groupBy(todasSalidas.filter((r) => r.AREA && String(r.AREA).toUpperCase() !== "NAN"), "AREA"))
    .map(([area, r]) => ({ area, salidas: r.length })).sort((a, b) => b.salidas - a.salidas).slice(0, 10);

  const topDept = Object.entries(groupBy(todasSalidas.filter((r) => r.DEPARTAMENTO && String(r.DEPARTAMENTO).toUpperCase() !== "NAN"), "DEPARTAMENTO"))
    .map(([dept, r]) => ({ dept, salidas: r.length })).sort((a, b) => b.salidas - a.salidas).slice(0, 10);

  const permArea = Object.entries(groupBy(todasSalidas.filter((r) => r.AREA && String(r.AREA).toUpperCase() !== "NAN" && r.MESES_PERMANENCIA != null && !isNaN(Number(r.MESES_PERMANENCIA))), "AREA"))
    .map(([area, r]) => ({ area, n: r.length, meses: Math.round(r.reduce((a, x) => a + Number(x.MESES_PERMANENCIA), 0) / r.length * 10) / 10 }))
    .filter((r) => r.meses > 0).sort((a, b) => a.meses - b.meses).slice(0, 12);

  const byAno: Record<string, typeof tasaMensual> = {};
  for (const r of tasaMensual) { (byAno[r.ano] = byAno[r.ano] ?? []).push(r); }

  const porAno = Object.entries(groupBy(todasSalidas, "ANO_REPORTE"))
    .map(([ano, r]) => ({ ano: String(ano), salidas: r.length })).sort((a, b) => a.ano.localeCompare(b.ano));

  const tipoAno = (() => {
    const acc: Record<string, Record<string, number>> = {};
    for (const r of salidas.filter((r) => r.TIPO_SALIDA && String(r.TIPO_SALIDA).toUpperCase() !== "NAN")) {
      const ano = String(r.ANO_REPORTE ?? ""); const tipo = String(r.TIPO_SALIDA);
      acc[ano] = acc[ano] ?? {}; acc[ano][tipo] = (acc[ano][tipo] ?? 0) + 1;
    }
    const rows: AnyObj[] = [];
    for (const [ano, tipos] of Object.entries(acc)) for (const [tipo, n] of Object.entries(tipos)) rows.push({ ano, tipo, n });
    return rows;
  })();

  const heatmap = (() => {
    const acc: Record<string, Record<number, number>> = {};
    for (const r of todasSalidas.filter((r) => r.EMPRESA)) {
      const emp = String(r.EMPRESA); const mes = Number(r.MES_REPORTE);
      if (isNaN(mes)) continue;
      acc[emp] = acc[emp] ?? {}; acc[emp][mes] = (acc[emp][mes] ?? 0) + 1;
    }
    const empresas = Object.keys(acc);
    const mesesDisp = Array.from(new Set(
      Object.values(acc).flatMap((m) => Object.keys(m).map(Number))
    )).sort((a, b) => a - b);
    // Matriz completa: 0 donde no hay salidas (evita NaN gris)
    const z = empresas.map((emp) => mesesDisp.map((mes) => acc[emp][mes] ?? 0));
    const xLabels = mesesDisp.map((m) => MESES_NOMBRE[m]);
    return { empresas, xLabels, z };
  })();

  const TAC_SET      = new Set(["AMPLIFY","BPR"]);
  const CSC_SET      = new Set(["TEXO"]);

  const retencion = (() => {
    const empMap = groupBy(allRows.filter((r) => r.EMPRESA), "EMPRESA");
    return Object.entries(empMap).map(([empresa, rows]) => {
      // Egresos = total de filas con SITUACION=I en todo el período
      const egresos = rows.filter((r) => String(r.SITUACION ?? "").trim().toUpperCase() === "I").length;
      // Activos = snapshot del último mes disponible (evita contar la misma persona 12 veces)
      const anos  = rows.map((r) => Number(r.ANO_REPORTE)).filter((v) => !isNaN(v));
      const ultAno = anos.length ? Math.max(...anos) : null;
      const rowsAno = ultAno != null ? rows.filter((r) => Number(r.ANO_REPORTE) === ultAno) : rows;
      const meses  = rowsAno.map((r) => Number(r.MES_REPORTE)).filter((v) => !isNaN(v));
      const ultMes = meses.length ? Math.max(...meses) : null;
      const snap   = ultMes != null ? rowsAno.filter((r) => Number(r.MES_REPORTE) === ultMes) : rowsAno;
      const activos = snap.filter((r) => String(r.SITUACION ?? "").trim().toUpperCase() === "A").length;
      const total   = activos + egresos;
      const pct     = total > 0 ? Math.round(activos / total * 100) : 0;
      const empUp   = empresa.toUpperCase().trim();
      const grupo   = CSC_SET.has(empUp) ? "csc"
                    : TAC_SET.has(empUp) ? "tac"
                    : "agencia";
      return { empresa, activos, egresos, pct, grupo };
    }).sort((a, b) => a.empresa.localeCompare(b.empresa));
  })();

  const pctAvg = (arr: { pct: number }[]) => arr.length ? Math.round(arr.reduce((s, r) => s + r.pct, 0) / arr.length) : null;
  const retKpis = {
    agencias: pctAvg(retencion.filter((r) => r.grupo === "agencia")),
    tac:      pctAvg(retencion.filter((r) => r.grupo === "tac")),
    csc:      pctAvg(retencion.filter((r) => r.grupo === "csc")),
  };

  // ── Rotación Involuntaria por Empresa ────────────────────────────────────
  // Helper: personas únicas por CEDULA (fallback NOMBRE) dentro de un conjunto de filas con cierta condición
  const uniquePersons = (rows: Row[], predicate: (r: Row) => boolean): number => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (!predicate(r)) continue;
      const id = String(r.CEDULA ?? r.NOMBRE ?? "").trim();
      if (id && id.toUpperCase() !== "NAN") seen.add(id);
    }
    return seen.size;
  };

  const rotInv = (() => {
    const empMap = groupBy(allRows.filter((r) => r.EMPRESA), "EMPRESA");
    const rows = Object.entries(empMap).map(([empresa, empRows]) => {
      const anos    = empRows.map((r) => Number(r.ANO_REPORTE)).filter((v) => !isNaN(v));
      const ultAno  = anos.length ? Math.max(...anos) : null;
      if (!ultAno) return null;
      const rowsAno      = empRows.filter((r) => Number(r.ANO_REPORTE) === ultAno);
      const involuntaria = uniquePersons(rowsAno, (r) => String(r.TIPO_SALIDA ?? "").toUpperCase().includes("INV"));
      const hcEnero      = rowsAno.filter((r) => Number(r.MES_REPORTE) === 1).length;
      const pct          = hcEnero > 0 ? Math.round(involuntaria / hcEnero * 100) : null;
      const empUp        = empresa.toUpperCase().trim();
      const grupo        = CSC_SET.has(empUp) ? "csc" : TAC_SET.has(empUp) ? "tac" : "agencia";
      return { empresa, involuntaria, pct, grupo };
    }).filter(Boolean) as { empresa: string; involuntaria: number; pct: number | null; grupo: string }[];

    const avg = (arr: typeof rows) => {
      const v = arr.filter((r) => r.pct != null);
      return v.length ? Math.round(v.reduce((s, r) => s + (r.pct ?? 0), 0) / v.length) : null;
    };
    return {
      data: rows.sort((a, b) => a.empresa.localeCompare(b.empresa)),
      kpis: {
        agencias: avg(rows.filter((r) => r.grupo === "agencia")),
        tac:      avg(rows.filter((r) => r.grupo === "tac")),
        csc:      avg(rows.filter((r) => r.grupo === "csc")),
      },
    };
  })();

  // ── Rotación Voluntaria por Empresa ──────────────────────────────────────
  const rotVol = (() => {
    const empMap = groupBy(allRows.filter((r) => r.EMPRESA), "EMPRESA");
    const rows = Object.entries(empMap).map(([empresa, empRows]) => {
      const anos    = empRows.map((r) => Number(r.ANO_REPORTE)).filter((v) => !isNaN(v));
      const ultAno  = anos.length ? Math.max(...anos) : null;
      if (!ultAno) return null;
      const rowsAno    = empRows.filter((r) => Number(r.ANO_REPORTE) === ultAno);
      const voluntaria = uniquePersons(rowsAno, (r) => { const t = String(r.TIPO_SALIDA ?? "").toUpperCase(); return t.includes("VOL") && !t.includes("INV"); });
      const hcEnero    = rowsAno.filter((r) => Number(r.MES_REPORTE) === 1).length;
      const pct        = hcEnero > 0 ? Math.round(voluntaria / hcEnero * 100) : null;
      const empUp      = empresa.toUpperCase().trim();
      const grupo      = CSC_SET.has(empUp) ? "csc" : TAC_SET.has(empUp) ? "tac" : "agencia";
      return { empresa, voluntaria, pct, grupo };
    }).filter(Boolean) as { empresa: string; voluntaria: number; pct: number | null; grupo: string }[];

    const avg = (arr: typeof rows) => {
      const v = arr.filter((r) => r.pct != null);
      return v.length ? Math.round(v.reduce((s, r) => s + (r.pct ?? 0), 0) / v.length) : null;
    };
    return {
      data: rows.sort((a, b) => a.empresa.localeCompare(b.empresa)),
      kpis: {
        agencias: avg(rows.filter((r) => r.grupo === "agencia")),
        tac:      avg(rows.filter((r) => r.grupo === "tac")),
        csc:      avg(rows.filter((r) => r.grupo === "csc")),
      },
    };
  })();

  // ── Incremento / Disminución de Nómina ───────────────────────────────────
  const incDecHC = (() => {
    const empMap = groupBy(allRows.filter((r) => r.EMPRESA), "EMPRESA");
    const perEmp = Object.entries(empMap).map(([empresa, empRows]) => {
      const anos = empRows.map((r) => Number(r.ANO_REPORTE)).filter((v) => !isNaN(v));
      const ultAno = anos.length ? Math.max(...anos) : null;
      if (!ultAno) return null;
      const rowsAno = empRows.filter((r) => Number(r.ANO_REPORTE) === ultAno);
      const hcInicio = rowsAno.filter((r) => Number(r.MES_REPORTE) === 1).length;
      const meses  = rowsAno.map((r) => Number(r.MES_REPORTE)).filter((v) => !isNaN(v));
      const ultMes = meses.length ? Math.max(...meses) : null;
      const hcFin  = ultMes != null
        ? rowsAno.filter((r) => Number(r.MES_REPORTE) === ultMes && String(r.SITUACION ?? "").trim().toUpperCase() === "A").length
        : 0;
      const empUp  = empresa.toUpperCase().trim();
      const grupo  = CSC_SET.has(empUp) ? "CSC" : TAC_SET.has(empUp) ? "TAC Media" : "Agencias";
      return { hcFin, hcInicio, grupo, ano: ultAno };
    }).filter(Boolean) as { hcFin: number; hcInicio: number; grupo: string; ano: number }[];

    const data = (["TAC Media", "CSC", "Agencias"] as const).map((label) => {
      const gr       = perEmp.filter((r) => r.grupo === label);
      const hcFin    = gr.reduce((s, r) => s + r.hcFin, 0);
      const hcInicio = gr.reduce((s, r) => s + r.hcInicio, 0);
      const pct      = hcInicio > 0 ? Math.round((hcFin - hcInicio) / hcInicio * 100) : null;
      return { label, hcFin, hcInicio, pct };
    }).filter((r) => r.hcInicio > 0 || r.hcFin > 0);

    return { data, ano: perEmp[0]?.ano ?? new Date().getFullYear() };
  })();

  // ── Rotación del Talento por Empresa ─────────────────────────────────────
  const rotTalento = (() => {
    const empMap = groupBy(allRows.filter((r) => r.EMPRESA), "EMPRESA");
    return Object.entries(empMap).map(([empresa, empRows]) => {
      const anos   = empRows.map((r) => Number(r.ANO_REPORTE)).filter((v) => !isNaN(v));
      const ultAno = anos.length ? Math.max(...anos) : null;
      if (!ultAno) return null;
      const rowsAno = empRows.filter((r) => Number(r.ANO_REPORTE) === ultAno);

      // Ingresos reales: personas únicas con SITUACION=A y año de ingreso = año analizado
      const ingresosSet = new Set(
        rowsAno
          .filter((r) => {
            if (String(r.SITUACION ?? "").trim().toUpperCase() !== "A") return false;
            // Usar ANO_INGRESO si existe, sino parsear FECHA_INGRESO
            const anoIng = r.ANO_INGRESO != null
              ? Number(r.ANO_INGRESO)
              : (() => { const fi = String(r.FECHA_INGRESO ?? ""); return fi && fi !== "null" ? new Date(fi).getFullYear() : null; })();
            return anoIng === ultAno;
          })
          .map((r) => {
            const id = String(r.CEDULA ?? r.NOMBRE ?? "").trim();
            return id && id.toUpperCase() !== "NAN" ? id : null;
          })
          .filter(Boolean)
      );
      const ingresos = ingresosSet.size;

      const egresos = rowsAno.filter((r) => String(r.SITUACION ?? "").trim().toUpperCase() === "I").length;
      const hcEnero = rowsAno.filter((r) => Number(r.MES_REPORTE) === 1).length;
      const pct     = hcEnero > 0 ? Math.round(egresos / hcEnero * 100) : null;
      return { empresa, ingresos, egresos, pct };
    }).filter(Boolean).filter((r) => r!.ingresos > 0 || r!.egresos > 0) as
      { empresa: string; ingresos: number; egresos: number; pct: number | null }[];
  })();

  return { kpis, tipoSalida, motOrig, tasaMensual, byAno, salEmp, tasaEmp, tipoEmp, motivoEmp, permEmp, permEmpActivos, topCargos, permCargo, topAreas, permArea, topDept, porAno, tipoAno, heatmap, retencion, retKpis, rotInv, rotVol, incDecHC, rotTalento };
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <h3 className="chart-title mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function RotacionPage() {
  const { rotacionData, setRotacionData, respuestasData, setRespuestasData, hydrating } = useDashboard();
  const { selected, register } = useFilter();
  const [data, setData]       = useState<AnyObj | null>(null);
  const [activeTab, setActiveTab] = useState("general");
  const [showUpload, setShowUpload] = useState(false);
  const [respData, setRespData]     = useState<AnyObj | null>(null);
  const [showRespUpload, setShowRespUpload] = useState(false);

  useEffect(() => {
    if (rotacionData && !data) {
      setData(rotacionData);
      const rows = (rotacionData.raw_rows as Row[]) ?? [];
      register(FILTER_CONFIGS, rows.filter((r) => String(r.ANO_REPORTE ?? "") === "2025"), {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotacionData]);

  useEffect(() => {
    if (respuestasData && !respData) setRespData(respuestasData as AnyObj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respuestasData]);

  function handleResult(result: AnyObj) {
    setData(result);
    setRotacionData(result);
    setShowUpload(false);
    const rows = (result.raw_rows as Row[]) ?? [];
    register(FILTER_CONFIGS, rows, defaultYear2025(rows, "ANO_REPORTE"));
  }

  function handleRespResult(result: AnyObj) {
    setRespData(result);
    setRespuestasData(result);
    setShowRespUpload(false);
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
          <p className="label-xs mb-2" style={{ color: "var(--accent)" }}>Módulo de Rotación</p>
          <h1 className="page-title">Análisis de Rotación de Personal</h1>
          <p className="mt-2 text-sm max-w-sm mx-auto" style={{ color: "var(--text2)" }}>
            Subí uno o más archivos Excel de rotación (un archivo por año). Claude categorizará motivos de salida automáticamente.
          </p>
        </div>
        <div className="w-full max-w-md">
          <FileUpload endpoint="/api/rotacion" fieldName="files" multiple onResult={handleResult} />
        </div>
      </div>
    );
  }

  const rawRows: Row[]         = ((data.raw_rows as Row[]) ?? []).filter((r) => String(r.ANO_REPORTE ?? "") === "2025");
  const filteredRows            = applyFilters(rawRows, selected);
  const advertencias: string[] = (data.advertencias as string[]) ?? [];
  const computed = computeFromRows(filteredRows);
  const { kpis, tipoSalida, motOrig, byAno, salEmp, tasaEmp, tipoEmp, motivoEmp, permEmp, permEmpActivos, topCargos, permCargo, topAreas, permArea, topDept, porAno, tipoAno, heatmap, retencion, retKpis, rotInv, rotVol, incDecHC, rotTalento } = computed;

  const entrevistas: AnyObj = (data.entrevistas as AnyObj) ?? {};
  const dimData = entrevistas.por_dimension
    ? Object.entries(entrevistas.por_dimension as Record<string, number>).sort((a, b) => a[1] - b[1])
    : null;

  const lineTraces = Object.entries(byAno).map(([ano, rows]) => ({
    type: "scatter" as const, mode: "lines+markers" as const, name: ano,
    x: rows.map((r) => r.mes_nombre), y: rows.map((r) => r.tasa),
  }));

  const tiposUnicos   = Array.from(new Set(tipoEmp.map((r) => r.tipo)));
  const empresasUniq  = Array.from(new Set(tipoEmp.map((r) => r.empresa)));
  const TIPO_COLOR: Record<string, string> = { "VOLUNTARIA": C_BLUE, "INVOLUNTARIA": C_RED };
  const tipoEmpTraces = tiposUnicos.map((tipo) => ({
    type: "bar" as const, name: tipo,
    x: empresasUniq,
    y: empresasUniq.map((emp) => tipoEmp.find((r) => r.empresa === emp && r.tipo === tipo)?.n ?? 0),
    marker: { color: TIPO_COLOR[String(tipo).toUpperCase()] ?? C_GRAY },
  }));

  const motivosUnicos     = Array.from(new Set(motivoEmp.map((r) => r.motivo)));
  const empresasMotivo    = Array.from(new Set(motivoEmp.map((r) => r.empresa)));
  const MOTIVO_COLOR: Record<string, string> = {
    "Renuncia": C_BLUE,
    "Despido Injustificado": C_RED,
    "Término de Contrato de Prueba": C_ORANGE,
  };
  const motivoEmpTraces   = motivosUnicos.map((motivo) => ({
    type: "bar" as const, name: motivo,
    x: empresasMotivo,
    y: empresasMotivo.map((emp) => motivoEmp.find((r) => r.empresa === emp && r.motivo === motivo)?.n ?? 0),
    marker: { color: MOTIVO_COLOR[motivo] ?? C_GRAY },
  }));

  const tiposUnicosAno = Array.from(new Set(tipoAno.map((r) => r.tipo)));
  const anosUniq       = Array.from(new Set(tipoAno.map((r) => r.ano))).sort();
  const tipoAnoTraces  = tiposUnicosAno.map((tipo, i) => ({
    type: "bar" as const, name: tipo,
    x: anosUniq,
    y: anosUniq.map((ano) => tipoAno.find((r) => r.ano === ano && r.tipo === tipo)?.n ?? 0),
    marker: { color: LIGHT_COLOR_SEQ[i % LIGHT_COLOR_SEQ.length] },
  }));

  const tablaRot: AnyObj[]     = (data.tabla as AnyObj[]) ?? [];
  const salidasFiltradas        = filteredRows.filter(isAnySalida);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="label-xs mb-1" style={{ color: "var(--accent)" }}>Módulo de Rotación</p>
          <h1 className="page-title">Rotación de Personal</h1>
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
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Cargar nuevos datos de rotación</p>
            <button onClick={() => setShowUpload(false)} className="text-xs transition" style={{ color: "var(--text3)" }}>Cancelar</button>
          </div>
          <FileUpload endpoint="/api/rotacion" fieldName="files" multiple onResult={handleResult} />
        </div>
      )}

      {advertencias.length > 0 && (
        <div className="mb-5 rounded-lg px-4 py-3 text-sm" style={{ border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
          <strong>Advertencias:</strong>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 opacity-80">
            {advertencias.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard title="Total Salidas"     value={kpis.salidas_totales} />
        <KpiCard title="Empresas"          value={kpis.empresas} />
        <KpiCard title="Tasa Rot. Anual"   value={kpis.tasa_anual != null ? `${kpis.tasa_anual}%` : "—"} />
        <KpiCard title="Voluntarias"       value={kpis.voluntarias} />
        <KpiCard title="Involuntarias"     value={kpis.involuntarias} />
        <KpiCard title="Permanencia Prom." value={kpis.permanencia_prom_meses != null ? `${kpis.permanencia_prom_meses} m` : "—"} />
      </div>

      {/* Tabs */}
      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {/* ── Tab: Rotación General ── */}
      {activeTab === "general" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tipoSalida.labels.length > 0 && (
              <ChartCard title="Voluntaria vs Involuntaria">
                <PlotChart
                  light
                  data={[{ type: "pie", labels: tipoSalida.labels, values: tipoSalida.values, hole: 0.4,
                    textinfo: "label+percent", textposition: "outside",
                    textfont: { color: "#1e293b" },
                    marker: { colors: tipoSalida.labels.map((l) => String(l).toUpperCase().includes("INV") ? "#ef4444" : "#2563EB") } }]}
                  layout={{ margin: { t: 16, r: 16, b: 16, l: 16 } }}
                  height={300}
                />
              </ChartCard>
            )}
            {motOrig.length > 0 && (
              <ChartCard title="Motivos de Salida">
                <PlotChart
                  light
                  data={[{ type: "bar", orientation: "h",
                    x: motOrig.map((r) => r.cantidad),
                    y: motOrig.map((r) => r.motivo),
                    marker: { color: C_RED },
                    text: motOrig.map((r) => String(r.cantidad)),
                    textposition: "outside" }]}
                  layout={{
                    margin: { t: 10, r: 50, b: 30, l: 10 },
                    xaxis: { range: [0, Math.max(...motOrig.map((r) => r.cantidad)) * 1.15] },
                    yaxis: { automargin: true, tickfont: { size: 13 } },
                    bargap: 0.08,
                    autosize: true,
                  }}
                  height={Math.max(320, motOrig.length * 110)}
                />
              </ChartCard>
            )}
          </div>

          {/* Incremento / Disminución de Nómina */}
          {incDecHC.data.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title mb-5">INCREMENTO / DISMINUCIÓN DE NÓMINA</h3>
              <PlotChart
                light
                data={[
                  {
                    type: "bar",
                    name: `Activos al 31/12/${incDecHC.ano}`,
                    x: incDecHC.data.map((r) => r.label),
                    y: incDecHC.data.map((r) => r.hcFin),
                    marker: { color: C_BLUE },
                    text: incDecHC.data.map((r) => String(r.hcFin)),
                    textposition: "outside" as const,
                  },
                  {
                    type: "bar",
                    name: `Activos al 01/01/${incDecHC.ano}`,
                    x: incDecHC.data.map((r) => r.label),
                    y: incDecHC.data.map((r) => r.hcInicio),
                    marker: { color: C_GRAY },
                    text: incDecHC.data.map((r) => String(r.hcInicio)),
                    textposition: "outside" as const,
                  },
                  {
                    type: "scatter" as const,
                    mode: "lines+markers+text" as const,
                    name: "% Incremento / Disminución",
                    x: incDecHC.data.map((r) => r.label),
                    y: incDecHC.data.map((r) => r.pct ?? 0),
                    yaxis: "y2",
                    line:   { color: C_ORANGE, width: 2 },
                    marker: { color: C_ORANGE, size: 7 },
                    text: incDecHC.data.map((r) => r.pct != null ? `${r.pct}%` : ""),
                    textposition: "top center" as const,
                  },
                ] as AnyObj[]}
                layout={{
                  barmode: "group",
                  yaxis2: { overlaying: "y", side: "right", ticksuffix: "%", showgrid: false, zeroline: true },
                  margin: { t: 30, r: 70, b: 80, l: 50 },
                  legend: { orientation: "h", y: -0.22 },
                }}
                height={380}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Por Empresa ── */}
      {activeTab === "empresa" && (
        <div className="space-y-4">
          {salEmp.length > 0 && (
            <ChartCard title="Total Salidas por Empresa">
              <PlotChart
                light
                data={[{ type: "bar",
                  x: salEmp.map((r) => r.EMPRESA), y: salEmp.map((r) => r.salidas),
                  text: salEmp.map((r) => String(r.salidas)),
                  textposition: "outside" as const,
                  marker: { color: C_BLUE }, }]}
                layout={{ margin: { t: 30, r: 16, b: 80, l: 40 } }}
                height={280}
              />
            </ChartCard>
          )}
          {rotTalento.length > 0 && (
            <ChartCard title="ROTACIÓN DEL TALENTO">
              <PlotChart
                light
                data={[
                  {
                    type: "bar",
                    name: "Nº de Ingresos",
                    x: rotTalento.map((r) => r.empresa),
                    y: rotTalento.map((r) => r.ingresos),
                    marker: { color: C_BLUE },
                    text: rotTalento.map((r) => String(r.ingresos)),
                    textposition: "outside" as const,
                  },
                  {
                    type: "bar",
                    name: "Nº de Egresos",
                    x: rotTalento.map((r) => r.empresa),
                    y: rotTalento.map((r) => r.egresos),
                    marker: { color: C_RED },
                    text: rotTalento.map((r) => String(r.egresos)),
                    textposition: "outside" as const,
                  },
                  {
                    type: "scatter" as const,
                    mode: "lines+markers+text" as const,
                    name: "% Rotación",
                    x: rotTalento.map((r) => r.empresa),
                    y: rotTalento.map((r) => r.pct ?? 0),
                    yaxis: "y2",
                    line:   { color: C_ORANGE, width: 2 },
                    marker: { color: C_ORANGE, size: 7 },
                    text: rotTalento.map((r) => r.pct != null ? `${r.pct}%` : ""),
                    textposition: "top center" as const,
                  },
                ] as AnyObj[]}
                layout={{
                  barmode: "group",
                  yaxis:  { ticksuffix: "%", rangemode: "tozero" },
                  yaxis2: { overlaying: "y", side: "right", showgrid: false, zeroline: true },
                  margin: { t: 30, r: 60, b: 80, l: 50 },
                  legend: { orientation: "h", y: -0.22 },
                }}
                height={420}
              />
              {motivoEmpTraces.length > 0 && (() => {
                return (
                  <>
                    <h4 className="text-xs font-semibold mt-6 mb-2" style={{ color: "var(--text2)" }}>MOTIVO DE SALIDA POR EMPRESA</h4>
                    <PlotChart
                      light
                      data={motivoEmpTraces.map((t) => ({
                        ...t,
                        text: t.y.map((v: number) => v > 0 ? String(v) : ""),
                        textposition: "outside",
                      })) as AnyObj[]}
                      layout={{
                        barmode: "group",
                        margin: { t: 20, r: 16, b: 80, l: 50 },
                        legend: { orientation: "h", y: -0.25 },
                        yaxis: { rangemode: "tozero" },
                      }}
                      height={320}
                    />
                  </>
                );
              })()}
            </ChartCard>
          )}
          {/* Retención del Talento */}
          {retencion.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title mb-4">Retención del Talento</h3>
              <div className="flex gap-8">
                <div className="flex flex-col justify-center gap-6 min-w-[140px]">
                  {retKpis.agencias != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_BLUE }}>{retKpis.agencias}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>Agencias</span></div>
                    </div>
                  )}
                  {retKpis.tac != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_BLUE }}>{retKpis.tac}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>TAC Media</span></div>
                    </div>
                  )}
                  {retKpis.csc != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_BLUE }}>{retKpis.csc}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>CSC</span></div>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <PlotChart
                    light
                    data={[
                      { type: "bar", name: "Activos",
                        x: retencion.map((r) => r.empresa), y: retencion.map((r) => r.activos),
                        marker: { color: C_BLUE },
                        text: retencion.map((r) => String(r.activos)), textposition: "outside" },
                      { type: "bar", name: "Egresos",
                        x: retencion.map((r) => r.empresa), y: retencion.map((r) => r.egresos),
                        marker: { color: C_RED },
                        text: retencion.map((r) => String(r.egresos)), textposition: "outside" },
                      { type: "scatter", mode: "text+lines+markers", name: "% Retención",
                        x: retencion.map((r) => r.empresa), y: retencion.map((r) => r.pct),
                        yaxis: "y2", line: { color: C_ORANGE, width: 2 }, marker: { color: C_ORANGE, size: 7 },
                        text: retencion.map((r) => `${r.pct}%`), textposition: "top center" },
                    ]}
                    layout={{ barmode: "group",
                      yaxis2: { overlaying: "y", side: "right", ticksuffix: "%", showgrid: false },
                      margin: { t: 30, r: 60, b: 60, l: 40 } }}
                    height={380}
                  />
                </div>
              </div>
            </div>
          )}

          {permEmp.length > 0 && (
            <ChartCard title="Permanencia Promedio — Salientes (meses)">
              <PlotChart
                light
                data={[{ type: "bar", orientation: "h",
                  x: permEmp.map((r) => r.meses), y: permEmp.map((r) => r.empresa),
                  text: permEmp.map((r) => `${r.meses} meses`), textposition: "outside" as const,
                  marker: { color: C_RED } }]}
                layout={{ margin: { t: 16, r: 100, b: 36, l: 120 }, bargap: 0.4, yaxis: { automargin: true } }}
                height={Math.max(320, permEmp.length * 42)}
              />
            </ChartCard>
          )}

          {permEmpActivos.length > 0 && (
            <ChartCard title="Permanencia Promedio — Activos (meses)">
              <PlotChart
                light
                data={[{ type: "bar", orientation: "h",
                  x: permEmpActivos.map((r) => r.meses), y: permEmpActivos.map((r) => r.empresa),
                  text: permEmpActivos.map((r) => `${r.meses} meses`), textposition: "outside" as const,
                  marker: { color: C_BLUE } }]}
                layout={{ margin: { t: 16, r: 100, b: 36, l: 120 }, bargap: 0.4, yaxis: { automargin: true } }}
                height={Math.max(320, permEmpActivos.length * 42)}
              />
            </ChartCard>
          )}

          {/* Rotación Involuntaria por Empresa */}
          {rotInv.data.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title mb-4">Rotación Involuntaria por Empresa</h3>
              <div className="flex gap-8">
                <div className="flex flex-col justify-center gap-6 min-w-[140px]">
                  {rotInv.kpis.agencias != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_RED }}>{rotInv.kpis.agencias}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>Agencias</span></div>
                    </div>
                  )}
                  {rotInv.kpis.tac != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_RED }}>{rotInv.kpis.tac}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>TAC Media</span></div>
                    </div>
                  )}
                  {rotInv.kpis.csc != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_RED }}>{rotInv.kpis.csc}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>CSC</span></div>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <PlotChart
                    light
                    data={[
                      { type: "bar", name: "Involuntaria",
                        x: rotInv.data.map((r) => r.empresa), y: rotInv.data.map((r) => r.involuntaria),
                        marker: { color: C_RED }, text: rotInv.data.map((r) => String(r.involuntaria)),
                        textposition: "outside" as const },
                      { type: "scatter" as const, mode: "text+lines+markers" as const, name: "% Rotación Involuntaria",
                        x: rotInv.data.map((r) => r.empresa), y: rotInv.data.map((r) => r.pct ?? 0),
                        yaxis: "y2", line: { color: C_ORANGE, width: 2 }, marker: { color: C_ORANGE, size: 7 },
                        text: rotInv.data.map((r) => r.pct != null ? `${r.pct}%` : ""), textposition: "top center" as const },
                    ]}
                    layout={{ barmode: "group", yaxis2: { overlaying: "y", side: "right", ticksuffix: "%", showgrid: false },
                      margin: { t: 30, r: 60, b: 60, l: 40 }, legend: { orientation: "h", y: -0.2 } }}
                    height={380}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Rotación Voluntaria por Empresa */}
          {rotVol.data.length > 0 && (
            <div className="chart-card">
              <h3 className="chart-title mb-4">Rotación Voluntaria por Empresa</h3>
              <div className="flex gap-8">
                <div className="flex flex-col justify-center gap-6 min-w-[140px]">
                  {rotVol.kpis.agencias != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_BLUE }}>{rotVol.kpis.agencias}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>Agencias</span></div>
                    </div>
                  )}
                  {rotVol.kpis.tac != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_BLUE }}>{rotVol.kpis.tac}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>TAC Media</span></div>
                    </div>
                  )}
                  {rotVol.kpis.csc != null && (
                    <div>
                      <div className="text-4xl font-black" style={{ color: C_BLUE }}>{rotVol.kpis.csc}%</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--text2)" }}>Promedio<br/><span className="font-bold" style={{ color: "var(--text)" }}>CSC</span></div>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <PlotChart
                    light
                    data={[
                      { type: "bar", name: "Voluntaria",
                        x: rotVol.data.map((r) => r.empresa), y: rotVol.data.map((r) => r.voluntaria),
                        marker: { color: C_BLUE }, text: rotVol.data.map((r) => String(r.voluntaria)),
                        textposition: "outside" as const },
                      { type: "scatter" as const, mode: "text+lines+markers" as const, name: "% Rotación Voluntaria",
                        x: rotVol.data.map((r) => r.empresa), y: rotVol.data.map((r) => r.pct ?? 0),
                        yaxis: "y2", line: { color: C_ORANGE, width: 2 }, marker: { color: C_ORANGE, size: 7 },
                        text: rotVol.data.map((r) => r.pct != null ? `${r.pct}%` : ""), textposition: "top center" as const },
                    ]}
                    layout={{ barmode: "group", yaxis2: { overlaying: "y", side: "right", ticksuffix: "%", showgrid: false },
                      margin: { t: 30, r: 60, b: 60, l: 40 }, legend: { orientation: "h", y: -0.2 } }}
                    height={380}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Por Cargo / Área ── */}
      {activeTab === "cargo" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {topCargos.length > 0 && (
              <ChartCard title="Top 10 Cargos con Más Rotación">
                <PlotChart
                  light
                  data={[{ type: "bar", orientation: "h",
                    x: topCargos.map((r) => r.salidas), y: topCargos.map((r) => r.cargo),
                    marker: { color: barColors(topCargos.length) } }]}
                  layout={{ margin: { t: 16, r: 16, b: 36, l: 180 } }}
                  height={Math.max(280, topCargos.length * 24)}
                />
              </ChartCard>
            )}
            {permCargo.length > 0 && (
              <ChartCard title="Top 10 Cargos con Menor Permanencia">
                <PlotChart
                  light
                  data={[{ type: "bar", orientation: "h",
                    x: permCargo.map((r) => r.meses), y: permCargo.map((r) => r.cargo),
                    marker: { color: permCargo.map((r) => r.meses), colorscale: "RdYlGn", showscale: false } }]}
                  layout={{ margin: { t: 16, r: 16, b: 36, l: 180 } }}
                  height={Math.max(280, permCargo.length * 24)}
                />
              </ChartCard>
            )}
          </div>
          {permArea.length > 0 && (
            <ChartCard title="Permanencia Promedio por Área (meses) — Salientes">
              <PlotChart
                light
                data={[{ type: "bar", orientation: "h",
                  x: permArea.map((r) => r.meses), y: permArea.map((r) => r.area),
                  text: permArea.map((r) => `${r.meses} meses`), textposition: "outside" as const,
                  marker: { color: C_RED } }]}
                layout={{ margin: { t: 16, r: 120, b: 36, l: 130 } }}
                height={Math.max(280, permArea.length * 28)}
              />
            </ChartCard>
          )}
          {topCargos.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text2)" }}>No hay datos de cargo o área disponibles en este archivo.</p>
          )}
        </div>
      )}

      {/* ── Tab: Tendencia ── */}
      {activeTab === "tendencia" && (
        <div className="space-y-4">
          {lineTraces.length > 0 && (
            <ChartCard title="Tendencia de Salidas por Mes y Año">
              <PlotChart light data={lineTraces} height={300} />
            </ChartCard>
          )}

          {heatmap.empresas.length > 0 && (
            <ChartCard title="Mapa de Calor: Salidas por Empresa y Mes">
              <PlotChart
                light
                data={[{
                  type: "heatmap" as const,
                  x: heatmap.xLabels,
                  y: heatmap.empresas,
                  z: heatmap.z,
                  text: heatmap.z.map((row) => row.map((v) => v > 0 ? String(v) : "")) as unknown as string[],
                  texttemplate: "%{text}",
                  textfont: { color: heatmap.z.map((row) => row.map((v) => v >= 5 ? "#ffffff" : "#111827")) as unknown as string, size: 12 },
                  colorscale: [[0, "#f0f4ff"], [0.01, "#bfdbfe"], [0.4, "#3b82f6"], [1, "#1e3a8a"]],
                  zmin: 0,
                  hoverongaps: false,
                  xgap: 2, ygap: 2,
                }]}
                layout={{ margin: { t: 16, r: 16, b: 60, l: 110 } }}
                height={Math.max(320, heatmap.empresas.length * 36)}
              />
            </ChartCard>
          )}
        </div>
      )}


      {/* ── Tab: Detalle ── */}
      {activeTab === "detalle" && (
        <div>
          <p className="text-sm mb-3" style={{ color: "var(--text2)" }}>
            <span className="font-medium" style={{ color: "var(--text)" }}>{salidasFiltradas.length}</span> salidas registradas con los filtros aplicados
          </p>
          <DataTable rows={tablaRot} title="Detalle de Rotación" />
        </div>
      )}

      {/* ── Tab: Respuestas ── */}
      {activeTab === "respuestas" && (
        <RespuestasTab
          respData={respData}
          showUpload={showRespUpload}
          setShowUpload={setShowRespUpload}
          onResult={handleRespResult}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componente: pestaña Respuestas de Entrevista de Salida
// ─────────────────────────────────────────────────────────────────────────────

const RESP_LABEL: Record<string, string> = {
  P1: "1. Orientación",
  P2: "2. Capacitación",
  P3: "3. Crecimiento",
  P4: "4. Infraestructura",
  P5: "5. Ambiente",
  P6: "6. Supervisor",
  P7: "7. Apoyo superior",
  P8: "8. Apertura",
};

function RespuestasTab({
  respData,
  showUpload,
  setShowUpload,
  onResult,
}: {
  respData: AnyObj | null;
  showUpload: boolean;
  setShowUpload: (v: boolean) => void;
  onResult: (r: AnyObj) => void;
}) {
  const [subTab, setSubTab] = useState<"analisis" | "detalle">("analisis");
  if (!respData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[48vh] gap-6">
        <div className="text-center">
          <p className="label-xs mb-2" style={{ color: "var(--accent)" }}>Entrevistas de Salida</p>
          <h2 className="page-title text-2xl">Respuestas de Entrevista</h2>
          <p className="mt-2 text-sm max-w-sm mx-auto" style={{ color: "var(--text2)" }}>
            Subí el archivo Excel de respuestas del formulario de entrevista de salida.
          </p>
        </div>
        <div className="w-full max-w-md">
          <FileUpload endpoint="/api/respuestas" fieldName="file" multiple={false} onResult={onResult} />
        </div>
      </div>
    );
  }

  type Dim = { dimension: string; promedio: number };
  type EmpRow = { EMPRESA: string; promedio_general: number };
  type EmpDim = { empresa: string; dimension: string; promedio: number | null };
  type Motivo = { motivo: string; cantidad: number };
  type VolvEmp = { EMPRESA: string; si: number; total: number; pct: number };
  type Tema = { tema: string; personas: number; pct: number };
  type AnalisisTexto = { temas: Tema[]; total: number; narrativa: string | null };
  type TablaRow = AnyObj;

  const kpis            = (respData.kpis as AnyObj) ?? {};
  const dimensiones     = (respData.dimensiones as Dim[]) ?? [];
  const porEmpresa      = (respData.por_empresa as EmpRow[]) ?? [];
  const porEmpDim       = (respData.por_empresa_dimension as EmpDim[]) ?? [];
  const motivos         = (respData.motivos as Motivo[]) ?? [];
  const volveriaEmp     = (respData.volveria_emp as VolvEmp[]) ?? [];
  const tabla           = (respData.tabla as TablaRow[]) ?? [];
  const analisisGusto   = (respData.analisis_gusto   as AnalisisTexto) ?? { temas: [], narrativa: null };
  const analisisMejorar = (respData.analisis_mejorar as AnalisisTexto) ?? { temas: [], narrativa: null };

  // Top 5 motivos
  const top5Motivos = [...motivos].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);

  // Top 5 cargos con más renuncias — calculado desde tabla
  const cargoCounts = tabla.reduce((acc, row) => {
    const c = String(row.CARGO ?? "").trim();
    if (c && c.toUpperCase() !== "NAN") acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const top5Cargos = Object.entries(cargoCounts)
    .map(([cargo, cantidad]) => ({ cargo, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5);

  // Traces para heatmap empresa × dimensión
  const empresasUniq = Array.from(new Set(porEmpDim.map((r) => r.empresa)));
  const dimsUniq     = Array.from(new Set(porEmpDim.map((r) => r.dimension)));
  const heatZ        = dimsUniq.map((dim) =>
    empresasUniq.map((emp) => porEmpDim.find((r) => r.empresa === emp && r.dimension === dim)?.promedio ?? null)
  );

  // Preguntas disponibles en tabla
  const pCols = Object.keys(RESP_LABEL).filter((k) => tabla.length > 0 && k in tabla[0]);

  return (
    <div className="space-y-4">
      {/* Header con botón actualizar */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: "var(--text2)" }}>
          Entrevistas de salida — {kpis.total_respuestas ?? 0} respuestas
        </p>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-all"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text2)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text2)"; }}
        >
          Actualizar datos
        </button>
      </div>

      {showUpload && (
        <div className="rounded-xl p-4" style={{ border: "1px solid var(--accent)", background: "var(--card)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Cargar nuevas respuestas</p>
            <button onClick={() => setShowUpload(false)} className="text-xs" style={{ color: "var(--text3)" }}>Cancelar</button>
          </div>
          <FileUpload endpoint="/api/respuestas" fieldName="file" multiple={false} onResult={onResult} />
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="Total Respuestas"      value={kpis.total_respuestas ?? "—"} />
        <KpiCard title="Satisfacción Promedio" value={kpis.satisfaccion_promedio != null ? `${kpis.satisfaccion_promedio} / 5` : "—"} />
        <KpiCard title="Volvería a trabajar"   value={kpis.pct_volveria != null ? `${kpis.pct_volveria}%` : "—"} />
        <KpiCard title="Recomendaría Texo"     value={kpis.pct_recomienda != null ? `${kpis.pct_recomienda}%` : "—"} />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--card)", border: "1px solid var(--border)", width: "fit-content" }}>
        {(["analisis", "detalle"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: subTab === t ? "var(--accent)" : "transparent",
              color: subTab === t ? "#fff" : "var(--text2)",
            }}
          >
            {t === "analisis" ? "Análisis" : "Detalle"}
          </button>
        ))}
      </div>

      {/* ── Sub-tab: Análisis ── */}
      {subTab === "analisis" && (<>

      {/* Promedio por dimensión */}
      {dimensiones.length > 0 && (
        <ChartCard title="Satisfacción promedio por dimensión (escala 1–5)">
          <PlotChart
            light
            data={[{
              type: "bar",
              orientation: "h",
              x: [...dimensiones].sort((a, b) => a.promedio - b.promedio).map((d) => d.promedio),
              y: [...dimensiones].sort((a, b) => a.promedio - b.promedio).map((d) => d.dimension),
              text: [...dimensiones].sort((a, b) => a.promedio - b.promedio).map((d) => String(d.promedio)),
              textposition: "outside" as const,
              marker: {
                color: [...dimensiones].sort((a, b) => a.promedio - b.promedio).map((d) =>
                  d.promedio < 3 ? "#DC2626" : d.promedio < 4 ? "#D97706" : "#059669"
                ),
              },
            }]}
            layout={{
              xaxis: { range: [0, 5.5], dtick: 1 },
              margin: { t: 16, r: 80, b: 36, l: 220 },
            }}
            height={Math.max(280, dimensiones.length * 40)}
          />
        </ChartCard>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top 5 motivos de salida */}
        {top5Motivos.length > 0 && (
          <ChartCard title="Top 10 motivos de salida">
            <PlotChart
              light
              data={[{
                type: "bar",
                orientation: "h",
                x: [...top5Motivos].reverse().map((r) => r.cantidad),
                y: [...top5Motivos].reverse().map((r) => r.motivo),
                text: [...top5Motivos].reverse().map((r) => String(r.cantidad)),
                textposition: "outside" as const,
                marker: { color: LIGHT_COLOR_SEQ.slice(0, top5Motivos.length) },
              }]}
              layout={{ margin: { t: 16, r: 50, b: 36, l: 240 }, xaxis: { zeroline: false } }}
              height={300}
            />
          </ChartCard>
        )}

        {/* Top 5 cargos con más renuncias */}
        {top5Cargos.length > 0 && (
          <ChartCard title="Top 5 cargos con más renuncias">
            <PlotChart
              light
              data={[{
                type: "bar",
                orientation: "h",
                x: [...top5Cargos].reverse().map((r) => r.cantidad),
                y: [...top5Cargos].reverse().map((r) => r.cargo),
                text: [...top5Cargos].reverse().map((r) => String(r.cantidad)),
                textposition: "outside" as const,
                marker: { color: [...top5Cargos].reverse().map((_, i) => LIGHT_COLOR_SEQ[i % LIGHT_COLOR_SEQ.length]) },
              }]}
              layout={{ margin: { t: 16, r: 50, b: 36, l: 200 }, xaxis: { zeroline: false, dtick: 1 } }}
              height={300}
            />
          </ChartCard>
        )}
      </div>

      {/* Promedio general por empresa */}
      {porEmpresa.length > 0 && (
        <ChartCard title="Satisfacción promedio por empresa">
          <PlotChart
            light
            data={[{
              type: "bar",
              x: [...porEmpresa].sort((a, b) => a.promedio_general - b.promedio_general).map((r) => r.EMPRESA),
              y: [...porEmpresa].sort((a, b) => a.promedio_general - b.promedio_general).map((r) => r.promedio_general),
              text: [...porEmpresa].sort((a, b) => a.promedio_general - b.promedio_general).map((r) => String(r.promedio_general)),
              textposition: "outside" as const,
              marker: { color: LIGHT_COLOR_SEQ[0] },
            }]}
            layout={{ yaxis: { range: [0, 5.5] }, margin: { t: 30, r: 16, b: 80, l: 50 } }}
            height={300}
          />
        </ChartCard>
      )}

      {/* Heatmap empresa × dimensión */}
      {empresasUniq.length > 0 && dimsUniq.length > 0 && (
        <ChartCard title="Mapa de satisfacción: empresa × dimensión">
          <PlotChart
            light
            data={[{
              type: "heatmap" as const,
              x: empresasUniq,
              y: dimsUniq,
              z: heatZ,
              colorscale: [[0, "#b30000"], [0.6, "#fc8d59"], [1, "#f9c4a0"]],
              zmin: 1,
              zmax: 5,
              text: heatZ.map((row) => row.map((v) => v != null ? String(v) : "")),
              texttemplate: "%{text}",
              showscale: true,
            } as AnyObj]}
            layout={{ margin: { t: 16, r: 60, b: 80, l: 230 } }}
            height={Math.max(300, dimsUniq.length * 45)}
          />
        </ChartCard>
      )}

      {/* % Volvería por empresa */}
      {volveriaEmp.length > 0 && (
        <ChartCard title="¿Volvería a trabajar? — por empresa">
          <PlotChart
            light
            data={[
              {
                type: "bar",
                name: "Sí",
                x: volveriaEmp.map((r) => r.EMPRESA),
                y: volveriaEmp.map((r) => r.si),
                marker: { color: "#059669" },
                text: volveriaEmp.map((r) => String(r.si)),
                textposition: "inside" as const,
              },
              {
                type: "bar",
                name: "No",
                x: volveriaEmp.map((r) => r.EMPRESA),
                y: volveriaEmp.map((r) => r.total - r.si),
                marker: { color: "#94a3b8" },
                text: volveriaEmp.map((r) => String(r.total - r.si)),
                textposition: "inside" as const,
              },
              {
                type: "scatter" as const,
                mode: "text+lines+markers" as const,
                name: "% Sí",
                x: volveriaEmp.map((r) => r.EMPRESA),
                y: volveriaEmp.map((r) => r.pct),
                yaxis: "y2",
                line: { color: "#7C3AED", width: 2 },
                marker: { color: "#7C3AED", size: 7 },
                text: volveriaEmp.map((r) => `${r.pct}%`),
                textposition: "top center" as const,
              },
            ] as AnyObj[]}
            layout={{
              barmode: "stack",
              yaxis2: { overlaying: "y", side: "right", ticksuffix: "%", showgrid: false, range: [0, 120] },
              margin: { t: 30, r: 60, b: 80, l: 50 },
              legend: { orientation: "h", y: -0.22 },
            }}
            height={320}
          />
        </ChartCard>
      )}

      {/* ── Voz de los empleados: respuestas abiertas ── */}
      {(analisisMejorar.temas.length > 0 || analisisGusto.temas.length > 0) && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Barras: qué mejorarían (= por qué se van) */}
            {analisisMejorar.temas.length > 0 && (
              <ChartCard title={`¿Qué mejorarían? — ${analisisMejorar.total} personas`}>
                <PlotChart
                  light
                  data={[{
                    type: "bar",
                    orientation: "h",
                    x: [...analisisMejorar.temas].sort((a, b) => a.pct - b.pct).map((t) => t.pct),
                    y: [...analisisMejorar.temas].sort((a, b) => a.pct - b.pct).map((t) => t.tema),
                    text: [...analisisMejorar.temas].sort((a, b) => a.pct - b.pct).map((t) => `${t.pct}% · ${t.personas}/${analisisMejorar.total}`),
                    textposition: "outside" as const,
                    marker: { color: "#DC2626" },
                    hovertemplate: "<b>%{y}</b><br>%{text}<extra></extra>",
                  } as AnyObj]}
                  layout={{
                    xaxis: { range: [0, 110], ticksuffix: "%", showgrid: true },
                    margin: { t: 16, r: 120, b: 36, l: 220 },
                  }}
                  height={Math.max(320, analisisMejorar.temas.length * 50)}
                />
                {analisisMejorar.narrativa && (
                  <div className="mt-3 rounded-lg px-4 py-3 text-sm leading-relaxed"
                    style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)", color: "var(--text)" }}>
                    <span className="font-semibold text-xs uppercase tracking-wide" style={{ color: "#DC2626" }}>IA · </span>
                    {analisisMejorar.narrativa}
                  </div>
                )}
              </ChartCard>
            )}

            {/* Barras: qué valoraron */}
            {analisisGusto.temas.length > 0 && (
              <ChartCard title={`¿Qué fue lo que más valoraron? — ${analisisGusto.total} personas`}>
                <PlotChart
                  light
                  data={[{
                    type: "bar",
                    orientation: "h",
                    x: [...analisisGusto.temas].sort((a, b) => a.pct - b.pct).map((t) => t.pct),
                    y: [...analisisGusto.temas].sort((a, b) => a.pct - b.pct).map((t) => t.tema),
                    text: [...analisisGusto.temas].sort((a, b) => a.pct - b.pct).map((t) => `${t.pct}% · ${t.personas}/${analisisGusto.total}`),
                    textposition: "outside" as const,
                    marker: { color: "#059669" },
                    hovertemplate: "<b>%{y}</b><br>%{text}<extra></extra>",
                  } as AnyObj]}
                  layout={{
                    xaxis: { range: [0, 110], ticksuffix: "%", showgrid: true },
                    margin: { t: 16, r: 120, b: 36, l: 220 },
                  }}
                  height={Math.max(320, analisisGusto.temas.length * 50)}
                />
                {analisisGusto.narrativa && (
                  <div className="mt-3 rounded-lg px-4 py-3 text-sm leading-relaxed"
                    style={{ background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.2)", color: "var(--text)" }}>
                    <span className="font-semibold text-xs uppercase tracking-wide" style={{ color: "#059669" }}>IA · </span>
                    {analisisGusto.narrativa}
                  </div>
                )}
              </ChartCard>
            )}
          </div>
        </div>
      )}

      </>)}

      {/* ── Sub-tab: Detalle ── */}
      {subTab === "detalle" && tabla.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title mb-4">Respuestas individuales</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Nombre", "Empresa", "Cargo", "Motivo principal", ...pCols.map((p) => RESP_LABEL[p] ?? p), "¿Volvería?", "¿Recomienda?"].map((h) => (
                    <th key={h} className="text-left py-2 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--text2)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tabla.map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}
                    className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap">{row.NOMBRE ?? "—"}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{row.EMPRESA ?? "—"}</td>
                    <td className="py-2 px-3 whitespace-nowrap max-w-[140px] truncate">{row.CARGO ?? "—"}</td>
                    <td className="py-2 px-3 max-w-[180px] truncate">{row.MOTIVO_PRINCIPAL ?? "—"}</td>
                    {pCols.map((p) => {
                      const v = row[p];
                      const color = v == null ? "var(--text3)" : Number(v) < 3 ? "#DC2626" : Number(v) < 4 ? "#D97706" : "#059669";
                      return (
                        <td key={p} className="py-2 px-3 text-center font-semibold" style={{ color }}>{v ?? "—"}</td>
                      );
                    })}
                    <td className="py-2 px-3 text-center">{row.VOLVERIA ?? "—"}</td>
                    <td className="py-2 px-3 text-center">{row.RECOMIENDA ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
