import type { ButtonHTMLAttributes, ReactNode } from "react"

/** Componentes de UI compartidos — radios redondeados + verde Teko (estilo ecme/Behance). */

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

const STEP_LABELS = ["Consentimiento", "Selfie", "Cédula", "Revisión", "Listo"]

/** Stepper de progreso (consentimiento → selfie → cédula → verificación). */
export function Stepper({ active }: { active: number }) {
  return (
    <div className="mb-5 w-full max-w-md">
      <div className="flex gap-1.5">
        {STEP_LABELS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= active ? "bg-primary" : "bg-gray-200"
            }`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between px-0.5">
        {STEP_LABELS.map((l, i) => (
          <span
            key={l}
            className={`text-[11px] font-medium ${
              i <= active ? "text-primary-deep" : "text-gray-400"
            }`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Logo Teko (T·E·KO con la E en verde, como el HTML original). */
export function Brand() {
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
