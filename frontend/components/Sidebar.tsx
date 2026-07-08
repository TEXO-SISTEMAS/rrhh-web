"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { clearToken } from "@/lib/auth";
import { useFilter } from "@/context/FilterContext";
import { uniqueValues } from "@/lib/filterUtils";
import { useTheme } from "@/context/ThemeContext";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Inicio",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    ),
  },
  {
    href: "/reclutamiento",
    label: "Reclutamiento",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"
        />
      </svg>
    ),
  },
  {
    href: "/rotacion",
    label: "Rotación",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
        />
      </svg>
    ),
  },
  {
    href: "/costos",
    label: "Costos",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z"
        />
      </svg>
    ),
  },
  {
    href: "/nomina",
    label: "Nómina",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
        />
      </svg>
    ),
  },
  {
    href: "/resumen-ejecutivo",
    label: "Resumen Ejecutivo",
    icon: (
      <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605"
        />
      </svg>
    ),
  },
];

function FilterGroups({ pathname }: { pathname: string }) {
  const { configs, rows, selected, onChange } = useFilter();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (!configs.length || !rows.length) return null;
  if (pathname.startsWith("/resumen-ejecutivo")) return null;

  const hasAny = Object.values(selected).some((v) => v.length > 0);

  return (
    <div className="mt-2 pt-3 px-3" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="label-xs">Filtros</span>
        {hasAny && (
          <button
            onClick={() => configs.forEach((c) => onChange(c.field, []))}
            className="text-[10px] transition"
            style={{ color: "var(--text3)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text3)")}
          >
            Limpiar todo
          </button>
        )}
      </div>

      <div className="space-y-3">
        {configs.map((cfg) => {
          const opts = uniqueValues(rows, cfg.field);
          const sel  = selected[cfg.field] ?? [];
          const open = !collapsed[cfg.field];

          function toggle(val: string) {
            onChange(cfg.field, sel.includes(val) ? sel.filter((v) => v !== val) : [...sel, val]);
          }

          return (
            <div key={cfg.field}>
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="label-xs">{cfg.label}</span>
                <div className="flex items-center gap-1">
                  {sel.length > 0 && (
                    <button onClick={() => onChange(cfg.field, [])} style={{ color: "var(--text3)" }}>
                      <svg viewBox="0 0 12 12" fill="currentColor" className="w-2.5 h-2.5">
                        <path d="M2.293 2.293a1 1 0 0 1 1.414 0L6 4.586l2.293-2.293a1 1 0 1 1 1.414 1.414L7.414 6l2.293 2.293a1 1 0 0 1-1.414 1.414L6 7.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L4.586 6 2.293 3.707a1 1 0 0 1 0-1.414Z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => setCollapsed((p) => ({ ...p, [cfg.field]: open }))}
                    style={{ color: "var(--text3)" }}
                  >
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8}
                      className={`w-2.5 h-2.5 transition-transform ${open ? "" : "-rotate-90"}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 4l4 4 4-4" />
                    </svg>
                  </button>
                </div>
              </div>

              {open && (
                <div className="flex flex-wrap gap-1 px-1">
                  {opts.map((opt) => {
                    const active = sel.includes(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => toggle(opt)}
                        style={active ? {
                          background: "rgba(124,90,246,0.12)",
                          color: "var(--accent)",
                          border: "1px solid rgba(124,90,246,0.35)",
                          borderRadius: "9999px",
                          fontSize: "10px",
                          fontWeight: 500,
                          padding: "2px 8px",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          transition: "all 0.15s",
                        } : {
                          background: "rgba(255,255,255,0.03)",
                          color: "var(--text3)",
                          border: "1px solid var(--border)",
                          borderRadius: "9999px",
                          fontSize: "10px",
                          fontWeight: 500,
                          padding: "2px 8px",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          transition: "all 0.15s",
                        }}
                      >
                        <span className="max-w-[120px] truncate">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Sidebar({ open = true }: { open?: boolean }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [imgError, setImgError] = useState(false);
  const { theme, toggle } = useTheme();

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <aside
      className="fixed left-0 top-0 h-screen flex flex-col z-40"
      style={{
        width: 270,
        background: "var(--bg2)",
        borderRight: "1px solid var(--border)",
        transform: open ? "translateX(0)" : "translateX(-270px)",
        transition: "transform 0.25s ease",
      }}
    >
      {/* Logo */}
      <div
        className="flex flex-col items-center px-5 py-5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="relative mb-2.5">
          {!imgError ? (
            <Image
              src="/logo.png"
              alt="Texo"
              width={180}
              height={48}
              style={{
                width: "100%",
                height: "auto",
                maxWidth: 180,
                filter: theme === "dark" ? "brightness(0) invert(1)" : "none",
                opacity: theme === "dark" ? 0.88 : 1,
              }}
              priority
              onError={() => setImgError(true)}
            />
          ) : (
            <span
              className="text-base font-bold tracking-widest uppercase"
              style={{ color: "var(--text)", opacity: 1 }}
            >
              Texo
            </span>
          )}
        </div>
        <span
          className="text-[10px] font-bold tracking-[0.2em] uppercase"
          style={{ color: "var(--text3)" }}
        >
          Portal de RRHH
        </span>
        <div
          className="w-full h-[2px] mt-2 rounded-sm"
          style={{ background: "linear-gradient(90deg, var(--accent), transparent)" }}
        />
      </div>

      {/* Nav label */}
      <div className="px-5 pt-4 pb-1">
        <span className="label-xs">Módulos</span>
      </div>

      {/* Navigation */}
      <nav className="space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 transition-all"
              style={{
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--accent)" : "var(--text2)",
                background: active ? "rgba(124,90,246,0.12)" : "transparent",
                borderLeft: active ? "3px solid var(--accent)" : "3px solid transparent",
              }}
              onMouseEnter={e => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.04)";
              }}
              onMouseLeave={e => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
              }}
            >
              <span style={{ color: active ? "var(--accent)" : "var(--text3)" }}>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Filters (contextual, scrollable) */}
      <div className="flex-1 overflow-y-auto mt-2">
        <FilterGroups pathname={pathname} />
      </div>

      {/* Footer */}
      <div className="px-3 py-3" style={{ borderTop: "1px solid var(--border)" }}>
        {/* Fila: tema + logout */}
        <div className="flex items-center gap-2 mb-1">
          {/* Toggle tema */}
          <button
            onClick={toggle}
            title={theme === "dark" ? "Cambiar a modo día" : "Cambiar a modo noche"}
            className="flex items-center justify-center rounded-lg transition-all"
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              color: "var(--text3)",
              border: "1px solid var(--border)",
              background: "var(--card)",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.color = "var(--accent)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text3)";
            }}
          >
            {theme === "dark" ? (
              /* Sol */
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                />
              </svg>
            ) : (
              /* Luna */
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                />
              </svg>
            )}
          </button>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex-1 flex items-center gap-2 rounded-lg px-3 py-2 transition-all text-sm"
            style={{ color: "var(--text3)" }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "#ef4444";
              e.currentTarget.style.background = "rgba(239,68,68,0.08)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = "var(--text3)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
              />
            </svg>
            Cerrar sesión
          </button>
        </div>

        <p className="text-center mt-1" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text3)" }}>
          Danilo Sosa | Texo Sistemas
        </p>
      </div>
    </aside>
  );
}
