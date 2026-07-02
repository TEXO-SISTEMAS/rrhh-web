"use client";

import dynamic from "next/dynamic";
import type { PlotParams } from "react-plotly.js";

const Plot = dynamic<PlotParams>(
  () => import("react-plotly.js").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 animate-pulse rounded-lg" style={{ background: "var(--card2)" }} />
    ),
  }
);

/* Dark palette (original) */
const COLOR_SEQ = [
  "#7c5af6", "#10b981", "#06b6d4", "#f59e0b",
  "#d946ef", "#818cf8", "#ef4444", "#fb923c",
  "#84cc16", "#14b8a6",
];

/* Light palette — teal/coral base + complementary sequence */
const LIGHT_COLOR_SEQ = [
  "#0d9488", "#f43f5e", "#6366f1", "#f59e0b", "#0ea5e9",
  "#a855f7", "#22c55e", "#e11d48", "#4338ca", "#0284c7",
];

export { COLOR_SEQ, LIGHT_COLOR_SEQ };

const DARK_BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor:  "rgba(0,0,0,0)",
  font:   { color: "#6b7a99", size: 12, family: "DM Sans, system-ui, sans-serif" },
  legend: { bgcolor: "rgba(0,0,0,0)", font: { color: "#6b7a99", size: 11 } },
  colorway: COLOR_SEQ,
};

const DARK_AXIS: Partial<Plotly.LayoutAxis> = {
  gridcolor:     "#1e2e47",
  linecolor:     "#1e2e47",
  tickfont:      { color: "#6b7a99", size: 11 },
  zerolinecolor: "#1e2e47",
};

const LIGHT_BASE: Partial<Plotly.Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor:  "rgba(0,0,0,0)",
  font:   { color: "#1e293b", size: 12, family: "DM Sans, system-ui, sans-serif" },
  legend: { bgcolor: "rgba(0,0,0,0)", font: { color: "#334155", size: 11 } },
  colorway: LIGHT_COLOR_SEQ,
};

const LIGHT_AXIS: Partial<Plotly.LayoutAxis> = {
  gridcolor:     "#e2e8f0",
  linecolor:     "#cbd5e1",
  tickfont:      { color: "#475569", size: 11 },
  zerolinecolor: "#94a3b8",
};

interface PlotChartProps extends Omit<PlotParams, "layout"> {
  layout?: Partial<Plotly.Layout>;
  height?: number;
  light?: boolean;
}

export default function PlotChart({ data, layout, height = 300, light = false, ...rest }: PlotChartProps) {
  const base = light ? LIGHT_BASE : DARK_BASE;
  const axis = light ? LIGHT_AXIS : DARK_AXIS;

  const merged: Partial<Plotly.Layout> = {
    ...base,
    height,
    margin: { t: 24, r: 16, b: 48, l: 64 },
    ...layout,
    xaxis: { ...axis, ...(layout?.xaxis as object) },
    yaxis: { ...axis, ...(layout?.yaxis as object) },
    ...(layout?.yaxis2 ? { yaxis2: { ...axis, ...(layout.yaxis2 as object) } } : {}),
  };

  return (
    <Plot
      data={data}
      layout={merged}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%" }}
      {...rest}
    />
  );
}
