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
