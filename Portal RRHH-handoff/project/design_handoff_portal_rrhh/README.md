# Handoff: Portal RRHH — TEXO

## Overview
Dashboard de Recursos Humanos para el Grupo TEXO. Permite visualizar métricas de personal, reclutamiento, rotación y costos con gráficos interactivos, pestañas por sub-módulo, modo oscuro/claro y vista de presentación para directorio.

## Sobre los archivos de diseño
Los archivos en este bundle son **referencias de diseño creadas en HTML** — prototipos de alta fidelidad que muestran el aspecto y comportamiento final. La tarea es **recrear estos diseños en el entorno real del proyecto** (React, Next.js, Vue, etc.) usando sus patrones y librerías existentes. No copiar el HTML directamente a producción.

## Fidelidad
**Alta fidelidad (hifi)**: Colores exactos, tipografía, espaciado e interacciones están definidos. Recrear pixel-perfect usando el sistema de diseño del codebase.

---

## Módulos / Vistas

### 1. Nómina — `Análisis de Colaboradores`
- **Propósito**: Vista principal del personal activo con distribución de género, salarios y demografía.
- **Tabs**: Distribución / Salarios / Demografía / Liderazgo
- **Tab Distribución**: Fila con íconos pictograma mujer+hombre (SVG), donut de género, barras por empresa
- **Tab Salarios**: Barras horizontales por nivel (Anillos 1-6), tabla con brecha de género
- **Tab Demografía**: Barras de generaciones, barras de extranjeros por nacionalidad
- **Tab Liderazgo**: Barras horizontales H/M, distribución por anillos jerárquicos

### 2. Reclutamiento
- **Propósito**: Pipeline y métricas de contratación
- **Tabs**: General / Fuentes / Vacantes / Tiempos
- **Tab General**: Línea de contratados vs desvinculados 12 meses
- **Tab Fuentes**: Pie chart de fuentes + embudo de reclutamiento con progress bars
- **Tab Vacantes**: Barras por empresa
- **Tab Tiempos**: Barras de días promedio por empresa

### 3. Rotación
- **Propósito**: Análisis de altas y bajas
- **Tabs**: Rotación General / Por Empresa / Por Cargo-Área / Tendencia / Entrevistas de Salida / Detalle
- **Tab General**: Donut voluntaria/involuntaria + barras horizontales de motivos
- **Tab Por Empresa**: Barras agrupadas ingresos/egresos + tasa % por empresa
- **Tab Por Cargo**: Barras por nivel jerárquico y por área
- **Tab Tendencia**: Línea dual con eje Y secundario (tasa % + personas)
- **Tab Entrevistas**: Barras de satisfacción + donut ¿recomendarías?
- **Tab Detalle**: Tabla completa de desvinculaciones con badge por tipo

### 4. Costos
- **Propósito**: Análisis de nómina y presupuesto
- **Tabs**: Tendencia / Composición / Por Empresa / Presupuesto
- **Tab Tendencia**: Línea de evolución mensual M₲
- **Tab Composición**: Pie de categorías + lista con %
- **Tab Por Empresa**: Barras por empresa en M₲
- **Tab Presupuesto**: Barras de progreso comparando presupuesto vs real por categoría

### 5. Resumen Ejecutivo
- **Propósito**: Vista de alto nivel para directorio
- **Layout**: 4 KPIs gigantes (72px) + semáforos de indicadores + alertas con border-left de color

---

## Componentes UI

### KPICard
- Fondo: `var(--card)`, borde: `var(--border)`, border-radius: `12px`
- Label: 10px, 600, uppercase, letter-spacing 1.5px, color `var(--text2)`
- Valor: **38px** normal / **56px** en modo presentación, weight 800, letter-spacing -1px
- Sub: 12px, `var(--text2)`
- Hover: border-color → accent, translateY(-2px), sombra sutil
- **Animación**: contador numérico de 0 al valor final (900ms, cubic-bezier ease-out cúbico)

### ChartCard
- Fondo: `var(--card)`, borde: `var(--border)`, border-radius: `12px`, padding: `22px`
- Título: 11px, 600, uppercase, letter-spacing 1.5px, color `var(--text2)`
- Leyenda: dots de 10px + label 12px

### TabBar
- Borde inferior: `1px solid var(--border)` en el contenedor
- Tab activa: color accent, border-bottom 2px solid accent
- Tab inactiva: color text2, border-bottom 2px solid transparent
- Font: 13px, weight 600
- **Animación de contenido**: `@keyframes tabIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }` — duración 0.22s, easing `cubic-bezier(.4,0,.2,1)`

### Sidebar
- Ancho: **270px**
- Logo: imagen PNG con filter `brightness(0) invert(1)` en dark mode, normal en light
- Subtítulo: "Portal de RRHH" — 10px, 600, uppercase, letter-spacing 2px
- Línea acento: 2px height, gradiente accent → transparent
- Nav items: 14px, weight 500, padding `10px 20px`, border-left 3px solid transparent
- Nav activo: background card, color accent, border-left accent
- Filtros: secciones colapsables con chips seleccionables (toggle active class)

### Sidebar Filters (Chips)
- Chip base: padding `3px 9px`, border-radius 20px, 10px, weight 600, uppercase
- Chip inactivo: background card2, border var(--border), color text2
- Chip activo: background accent, border accent, color #fff

### Topbar
- Height: **60px**
- Botón primario: background accent, color #fff, border-radius 8px, 13px, weight 600
- Botón presentación: ghost style → active: background rgba(accent, .15), border accent

---

## Tokens de Diseño

### Tipografía
| Token | Valor |
|-------|-------|
| Font family | `'DM Sans', sans-serif` |
| Base | 13px / 400 |
| Label (uppercase) | 10px / 600 |
| KPI value | 38px / 800 |
| KPI presentación | 56px / 800 |
| Page title | 22px / 700 |
| Chart title | 11px / 600 |
| Letter-spacing KPI | -1px |
| Letter-spacing labels | 1.5px |

### Colores — Dark Mode
| Token | Hex |
|-------|-----|
| `--bg` | `#080d18` |
| `--bg2` | `#0e1525` |
| `--card` | `#131e30` |
| `--card2` | `#1a2840` |
| `--border` | `#1e2e47` |
| `--text` | `#e2e8f5` |
| `--text2` | `#6b7a99` |
| `--text3` | `#4a5568` |

### Colores — Light Mode
| Token | Hex |
|-------|-----|
| `--bg` | `#f0f4fa` |
| `--bg2` | `#e4ecf7` |
| `--card` | `#ffffff` |
| `--card2` | `#f8fafd` |
| `--border` | `#dde6f5` |
| `--text` | `#0f172a` |
| `--text2` | `#475569` |
| `--text3` | `#94a3b8` |

### Colores de Acento
| Token | Hex | Uso |
|-------|-----|-----|
| accent | `#7c5af6` | Violeta — principal, nav activo, CTA |
| pink | `#d946ef` | Mujeres / género femenino |
| indigo | `#818cf8` | Hombres / género masculino |
| green | `#10b981` | Positivo / ingresos |
| red | `#ef4444` | Negativo / alertas / egresos |
| orange | `#f59e0b` | Advertencia |
| cyan | `#06b6d4` | Informativo |

### Espaciado
| Escala | px |
|--------|-----|
| xs | 4 |
| sm | 8 |
| md | 16 |
| lg | 24 |
| xl | 32 |
| xxl | 48 |
| contentPadding | 28 |

### Border Radius
| Token | px | Uso |
|-------|----|-----|
| sm | 6 | chips, badges |
| md | 8 | botones, inputs |
| lg | 12 | tarjetas |
| xl | 14 | panel tweaks |
| full | 9999 | píldoras |

### Layout
| Token | Valor |
|-------|-------|
| Sidebar width | 270px |
| Topbar height | 60px |
| Content padding | 28px H / 24px V |

---

## Interacciones y Comportamiento

### Dark / Light Mode
- Toggle en topbar (ícono ☀️/🌙) y en sidebar
- CSS Custom Properties (`--bg`, `--card`, etc.) se actualizan via clase `.dark` / `.light` en `.app`
- Transición global: `background 0.25s, color 0.25s`

### Modo Presentación
- Botón "📺 Presentación" en topbar
- Al activar: sidebar se oculta (width → 0), KPIs escalan a 56px, título a 28px, padding aumenta
- Entra en `document.requestFullscreen()`
- `Esc` desactiva el modo

### Persistencia
- `localStorage` guarda `{ dark: boolean, activeId: string }` en cada cambio

### Animación KPIs (count-up)
- Al montar KPICard extrae parte numérica del valor (ej: "₲ 1.6B" → no anima; "243" → cuenta 0→243)
- Easing: `1 - (1 - progress)³` (ease-out cúbico)
- Duración: 900ms

### Tabs
- Estado local `useState` por módulo
- Al cambiar tab: contenedor tiene `key={tab}` que fuerza remount + clase `tab-content` que dispara CSS animation

---

## Librería de Gráficos
- **Chart.js 4.4.0** — `cdn.jsdelivr.net/npm/chart.js@4.4.0`
- **chartjs-plugin-datalabels 2.2.0** — para labels dentro/sobre los gráficos
- Registrar globalmente: `Chart.register(ChartDataLabels)`
- Cada instancia de Chart se destruye en cleanup de `useEffect`

### Configuración base de charts (getChartDefaults)
```js
{
  plugins: {
    legend: { display: false },
    tooltip: { titleFont: { family: 'DM Sans', size: 13 } },
    datalabels: { display: false }  // desactivado por defecto, activar por chart
  },
  scales: {
    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b7a99' } },
    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b7a99' } }
  }
}
```

### Helpers de datalabels
- `dlBar(dark, fmt?)` — label sobre barra (anchor end, align end)
- `dlBarInside(fmt?)` — label dentro de barra (anchor center, align center, color #fff)
- `dlPie()` — label dentro de segmento pie/doughnut (`v + '%'`)
- `dlLine(dark)` — label sobre punto de línea (anchor end, align top)

---

## Assets
| Archivo | Descripción |
|---------|-------------|
| `assets/logo-texo.png` | Logo oficial TEXO — PNG con fondo transparente |

---

## Archivos de Diseño
| Archivo | Descripción |
|---------|-------------|
| `Portal RRHH.html` | Prototipo principal — React + Chart.js inline |

---

## Notas para el desarrollador
1. El objeto `TOKENS` al inicio del script JS consolida todos los valores de diseño — cualquier cambio ahí se propaga.
2. El `TWEAK_DEFAULTS` al final permite cambios en vivo vía el panel Tweaks (integrado con el host).
3. Los filtros del sidebar son actualmente visuales — conectarlos a estado global para filtrar datos reales es la mejora pendiente más importante.
4. Los datos están hardcodeados en el objeto `DATA` — reemplazar con llamadas a API manteniendo la misma estructura.
5. El modo presentación usa `document.requestFullscreen()` — verificar permisos en el browser de producción.
