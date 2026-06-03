import { useEffect } from "react"
import type { StatusResult } from "../api"
import { QUALITY_MSG, QUALITY_NON_ACTIONABLE } from "../messages"
import { Button, Card } from "../ui"
import { IconCheck, IconShield } from "../Icons"

/**
 * Pantalla de resultado. PORTA el mapa de estados del HTML vanilla:
 *  verified → éxito verde; rejected/error/expired → mensajes amables;
 *  needs_recapture → tip + botón "Volver a intentar".
 * Redirige a redirectUrl tras 2.5s si viene.
 */
type Tone = "ok" | "bad" | "neutral"
interface Meta {
  tone: Tone
  title: string
  desc: string
}

const MAP: Record<string, Meta> = {
  verified: {
    tone: "ok",
    title: "¡Identidad verificada!",
    desc: "Listo, confirmamos que sos vos. Gracias.",
  },
  rejected: {
    tone: "bad",
    title: "No pudimos verificarte",
    desc: "Tus datos no pasaron los controles. Si creés que es un error, contactá a quien te envió el enlace.",
  },
  needs_recapture: {
    tone: "neutral",
    title: "Repitamos las fotos",
    desc: "Necesitamos imágenes un poco más nítidas para confirmar tu identidad.",
  },
  error: {
    tone: "bad",
    title: "Ocurrió un problema",
    desc: "Algo falló de nuestro lado. Probá de nuevo en unos minutos.",
  },
  expired: {
    tone: "bad",
    title: "El enlace expiró",
    desc: "Por seguridad este enlace caducó. Pedí uno nuevo para volver a intentar.",
  },
}

export function Result({
  status,
  onRetry,
}: {
  status: StatusResult
  onRetry: () => void
}) {
  const m = MAP[status.state] ?? MAP.error

  // Traducimos reasons a tips amables (mismo mapa que el pre-check), sin duplicar.
  const tips = Array.from(
    new Set(
      (status.reasons ?? [])
        .filter((r) => !QUALITY_NON_ACTIONABLE.includes(r))
        .map(
          (r) => QUALITY_MSG[r] || "Repetí la foto con buena luz y de frente.",
        ),
    ),
  )

  useEffect(() => {
    if (status.redirectUrl) {
      const url = status.redirectUrl
      const t = setTimeout(() => {
        location.href = url
      }, 2500)
      return () => clearTimeout(t)
    }
  }, [status.redirectUrl])

  const badge =
    m.tone === "ok" ? (
      <div className="flex size-20 items-center justify-center rounded-full bg-success-subtle text-primary">
        <IconCheck className="size-10" />
      </div>
    ) : m.tone === "bad" ? (
      <div className="flex size-20 items-center justify-center rounded-full bg-error-subtle text-error">
        <span className="text-4xl font-bold">!</span>
      </div>
    ) : (
      <div className="flex size-20 items-center justify-center rounded-full bg-primary-subtle text-primary">
        <IconShield className="size-10" />
      </div>
    )

  return (
    <Card>
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="teko-pop">{badge}</div>
        <h1 className="text-2xl font-bold text-gray-900">{m.title}</h1>
        <p className="max-w-xs text-sm leading-relaxed text-gray-500">
          {m.desc}
        </p>

        {tips.length > 0 && (
          <ul className="mt-1 w-full max-w-xs divide-y divide-gray-100 text-left text-sm text-gray-500">
            {tips.map((t) => (
              <li key={t} className="py-2.5">
                {t}
              </li>
            ))}
          </ul>
        )}

        {status.state === "needs_recapture" && (
          <div className="mt-2 w-full">
            <Button onClick={onRetry}>Volver a intentar</Button>
          </div>
        )}
      </div>
    </Card>
  )
}
