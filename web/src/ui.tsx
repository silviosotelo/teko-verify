import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from "react"
import { DEFAULT_BRANDING, type Branding } from "./branding"

/** Componentes de UI compartidos — radios redondeados + verde Teko (estilo ecme/Behance). */

/**
 * Branding del tenant (white-label P1 #5) propagado a los componentes de marca.
 * Default = branding Teko (verde + wordmark) hasta que /status resuelve el real.
 */
const BrandingContext = createContext<Branding>(DEFAULT_BRANDING)

export function BrandingProvider({
  value,
  children,
}: {
  value: Branding
  children: ReactNode
}) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding(): Branding {
  return useContext(BrandingContext)
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost"
}) {
  const base =
    "w-full rounded-2xl px-5 py-4 text-base font-semibold transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
  const styles =
    variant === "primary"
      ? "bg-primary text-white shadow-lg shadow-primary/25 hover:bg-primary-deep"
      : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  )
}

/** Tarjeta blanca flotante centrada — el lienzo del wizard (mobile-first). */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-md rounded-3xl bg-white/90 p-6 shadow-xl shadow-gray-900/5 ring-1 ring-gray-100 backdrop-blur-sm sm:p-7">
      {children}
    </div>
  )
}

/** Punto de confianza (ícono + texto) — "Toma ~60s", "Encriptado", etc. */
export function TrustPoint({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <li className="flex items-center gap-3 text-sm text-gray-600">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  )
}

/** Aviso amable (tip de recaptura). */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="my-3 rounded-2xl bg-warning-subtle px-4 py-3 text-sm leading-snug text-amber-800">
      {children}
    </div>
  )
}

// Fases macro del flujo, estilo Didit (barra sutil, SIN micro-labels por paso).
// 0 Inicio · 1 Documento · 2 Selfie · 3 Verificación.
export const PHASE_COUNT = 4

/**
 * Barra de progreso sutil (estilo Didit): N segmentos finos, los <= activos en
 * verde. Sin texto por paso — sólo una pista visual de avance arriba.
 */
export function Stepper({ active }: { active: number }) {
  return (
    <div className="mb-4 w-full max-w-md">
      <div className="flex gap-1.5">
        {Array.from({ length: PHASE_COUNT }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i <= active ? "bg-primary" : "bg-gray-200"
            }`}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Botón "atrás" sutil (chevron + "Volver"), alineado a la izquierda. Estilo
 * Didit: discreto, arriba del contenido. Oculto si no hay onBack.
 */
export function BackBar({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null
  return (
    <button
      type="button"
      onClick={onBack}
      className="-ml-1 mb-1 flex items-center gap-1 self-start rounded-lg px-1 py-1 text-sm font-medium text-gray-400 transition hover:text-gray-600 active:scale-95"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 18l-6-6 6-6" />
      </svg>
      Volver
    </button>
  )
}

/**
 * Ítem de checklist Didit: ícono en círculo suave + texto (título + opcional
 * subtítulo). Usado en intro y en las pantallas de "preparar".
 */
export function ChecklistItem({
  icon,
  title,
  desc,
}: {
  icon: ReactNode
  title: string
  desc?: string
}) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
        {icon}
      </span>
      <div className="pt-0.5">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {desc && <p className="mt-0.5 text-[13px] leading-snug text-gray-500">{desc}</p>}
      </div>
    </li>
  )
}

/**
 * Fila de opción seleccionable (elegir tipo de documento / país). Radio a la
 * derecha. Soporta estado deshabilitado ("próximamente").
 */
export function OptionRow({
  icon,
  label,
  hint,
  selected,
  disabled,
  badge,
  onClick,
}: {
  icon?: ReactNode
  label: string
  hint?: string
  selected?: boolean
  disabled?: boolean
  badge?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition ${
        disabled
          ? "cursor-not-allowed border-gray-100 bg-gray-50/60 opacity-70"
          : selected
            ? "border-primary bg-primary-subtle/50 ring-1 ring-primary"
            : "border-gray-200 bg-white hover:border-gray-300 active:scale-[0.99]"
      }`}
    >
      {icon && (
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${selected && !disabled ? "bg-primary text-white" : "bg-gray-100 text-gray-500"}`}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-gray-900">{label}</span>
        {hint && <span className="block truncate text-xs text-gray-400">{hint}</span>}
      </span>
      {badge && (
        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {badge}
        </span>
      )}
      {!disabled && !badge && (
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
            selected ? "border-primary bg-primary" : "border-gray-300"
          }`}
        >
          {selected && (
            <svg viewBox="0 0 24 24" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      )}
    </button>
  )
}

/**
 * Marca del header. White-label (P1 #5):
 *   - Con logo propio del tenant → muestra el logo + el displayName.
 *   - Con displayName propio (sin logo) → inicial en chip primario + nombre.
 *   - Sin branding (default Teko) → wordmark "TEKO" con la E en el color primario,
 *     idéntico a hoy.
 */
export function Brand() {
  const b = useBranding()
  const isTeko =
    !b.logoUrl && (!b.displayName || b.displayName === DEFAULT_BRANDING.displayName)

  if (isTeko) {
    return (
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-lg font-black tracking-wider text-white shadow-md shadow-primary/30">
          T
        </span>
        <div className="leading-tight">
          <div className="text-lg font-extrabold tracking-[0.2em] text-gray-900">
            T<span className="text-primary">E</span>KO
          </div>
          <div className="-mt-0.5 text-[11px] text-gray-400">
            identidad verificada
          </div>
        </div>
      </div>
    )
  }

  const initial = (b.displayName || "?").trim().charAt(0).toUpperCase()
  return (
    <div className="mb-5 flex items-center gap-2.5">
      {b.logoUrl ? (
        <img
          src={b.logoUrl}
          alt={b.displayName}
          className="size-10 rounded-2xl object-contain shadow-md shadow-gray-900/10"
        />
      ) : (
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-lg font-black text-white shadow-md shadow-primary/30">
          {initial}
        </span>
      )}
      <div className="leading-tight">
        <div className="text-lg font-extrabold tracking-tight text-gray-900">
          {b.displayName}
        </div>
        <div className="-mt-0.5 text-[11px] text-gray-400">
          identidad verificada
        </div>
      </div>
    </div>
  )
}
