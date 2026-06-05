/**
 * Íconos ilustrados inline (SVG) — estilo amigable de la referencia Behance:
 * documento/ID con check + destellos (sparkles). Inline para evitar problemas
 * de rutas de assets y mantenerlos nítidos a cualquier escala.
 */

export function VerifyHero({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={className} fill="none" aria-hidden>
      {/* destellos */}
      <g className="text-mint" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M30 36l0 12M24 42l12 0" />
        <path d="M132 30l0 10M127 35l10 0" />
        <path d="M134 104l0 10M129 109l10 0" />
      </g>
      <circle cx="44" cy="112" r="4" className="text-primary-mild" fill="currentColor" />
      <circle cx="120" cy="64" r="3.5" className="text-mint" fill="currentColor" />
      {/* burbuja documento */}
      <rect x="40" y="40" width="80" height="64" rx="14" className="text-primary" fill="currentColor" />
      <path d="M64 104l-10 16 22-8z" className="text-primary" fill="currentColor" />
      {/* foto + líneas */}
      <circle cx="64" cy="64" r="9" fill="#fff" />
      <rect x="80" y="58" width="26" height="6" rx="3" fill="#fff" opacity="0.95" />
      <rect x="80" y="70" width="20" height="6" rx="3" fill="#fff" opacity="0.7" />
      <rect x="54" y="84" width="52" height="6" rx="3" fill="#fff" opacity="0.55" />
      {/* check */}
      <circle cx="116" cy="100" r="18" fill="#fff" />
      <circle cx="116" cy="100" r="18" className="text-primary" stroke="currentColor" strokeWidth="3" fill="none" />
      <path d="M108 100l6 6 11-12" className="text-primary" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

export function IconClock({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function IconLock({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconEye({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function IconCheck({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function IconShield({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

/** Documento de identidad (línea). Para checklist "documento + selfie". */
export function IconIdCard({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M6 16c.6-1.4 1.6-2 2.5-2s1.9.6 2.5 2" />
      <path d="M14 10h4M14 13.5h4" />
    </svg>
  )
}

/** Cara/selfie (línea). */
export function IconFace({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="11" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11" r="0.6" fill="currentColor" stroke="none" />
      <path d="M9 15c.8.7 1.8 1 3 1s2.2-.3 3-1" />
    </svg>
  )
}

/** Sol / buena luz. */
export function IconSun({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </svg>
  )
}

/** Marco / encuadre completo (que entre todo). */
export function IconFrame({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    </svg>
  )
}

/** Sin reflejos / sin destello (ojo tachado-ish, usamos un "sin brillo"). */
export function IconNoGlare({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

/** Anteojos (con la barra de prohibido) — para "sin anteojos". */
export function IconNoGlasses({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6.5" cy="13" r="3" />
      <circle cx="17.5" cy="13" r="3" />
      <path d="M9.5 12.5c.8-.6 1.7-.6 2.5 0M3.5 12l1-2M20.5 12l-1-2" />
      <path d="M4 4l16 16" />
    </svg>
  )
}

/** Hero de cédula (frente) — ilustración para "Preparar el documento". */
export function DocHero({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} fill="none" aria-hidden>
      <g className="text-mint" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M22 22l0 10M17 27l10 0" />
        <path d="M140 30l0 9M135.5 34.5l9 0" />
      </g>
      <rect x="26" y="34" width="108" height="68" rx="12" className="text-primary" fill="currentColor" opacity="0.12" />
      <rect x="26" y="34" width="108" height="68" rx="12" className="text-primary" stroke="currentColor" strokeWidth="3" />
      <rect x="40" y="50" width="28" height="36" rx="5" className="text-primary" fill="currentColor" opacity="0.55" />
      <rect x="78" y="52" width="42" height="7" rx="3.5" className="text-primary" fill="currentColor" opacity="0.55" />
      <rect x="78" y="66" width="34" height="7" rx="3.5" className="text-primary" fill="currentColor" opacity="0.4" />
      <rect x="78" y="80" width="28" height="6" rx="3" className="text-primary" fill="currentColor" opacity="0.3" />
    </svg>
  )
}

/** Hero de selfie/cámara — ilustración para "Preparate para la cámara". */
export function CameraHero({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} fill="none" aria-hidden>
      <g className="text-mint" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M30 26l0 10M25 31l10 0" />
        <path d="M134 34l0 9M129.5 38.5l9 0" />
      </g>
      {/* teléfono */}
      <rect x="50" y="14" width="60" height="92" rx="14" className="text-primary" fill="currentColor" opacity="0.12" />
      <rect x="50" y="14" width="60" height="92" rx="14" className="text-primary" stroke="currentColor" strokeWidth="3" />
      {/* círculo de rostro */}
      <circle cx="80" cy="56" r="20" className="text-primary" stroke="currentColor" strokeWidth="3" fill="none" />
      <circle cx="80" cy="52" r="7" className="text-primary" fill="currentColor" opacity="0.5" />
      <path d="M68 70c2.5-4 7-6 12-6s9.5 2 12 6" className="text-primary" fill="currentColor" opacity="0.5" />
      <rect x="68" y="92" width="24" height="5" rx="2.5" className="text-primary" fill="currentColor" opacity="0.4" />
    </svg>
  )
}

/** Spinner reutilizable (mismo look del que estaba inline). */
export function Spinner({ className = "size-12" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-full border-4 border-gray-200 border-t-primary`}
      style={{ animation: "teko-spin 1s linear infinite" }}
    />
  )
}
