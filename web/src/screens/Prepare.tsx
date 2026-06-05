import type { ReactNode } from "react"
import { Button, Card, ChecklistItem, BackBar } from "../ui"

export interface PrepareTip {
  icon: ReactNode
  title: string
  desc?: string
}

/**
 * Pantalla genérica de "preparación" (estilo Didit) — reusada para:
 *  - Pantalla 3: "Preparar el documento" (frente · buena luz · que entre completo).
 *  - Pantalla 8: "Preparate para la cámara" (buena luz · despejá tu cara · sin reflejos).
 * Hero ilustrado + checklist de tips + un único CTA grande abajo.
 */
export function Prepare({
  hero,
  title,
  subtitle,
  tips,
  cta = "Continuar",
  onDone,
  onBack,
}: {
  hero: ReactNode
  title: string
  subtitle?: string
  tips: PrepareTip[]
  cta?: string
  onDone: () => void
  onBack?: () => void
}) {
  return (
    <Card>
      <div className="teko-slide-in flex flex-col">
        <BackBar onBack={onBack} />
        <div className="teko-pop mx-auto mb-2 text-primary">{hero}</div>
        <h1 className="text-center text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && (
          <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-gray-500">
            {subtitle}
          </p>
        )}

        <ul className="mt-7 flex flex-col gap-5">
          {tips.map((t) => (
            <ChecklistItem
              key={t.title}
              icon={t.icon}
              title={t.title}
              desc={t.desc}
            />
          ))}
        </ul>

        <div className="mt-7">
          <Button onClick={onDone}>{cta}</Button>
        </div>
      </div>
    </Card>
  )
}
