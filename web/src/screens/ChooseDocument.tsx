import { useState } from "react"
import { Button, Card, OptionRow, BackBar } from "../ui"
import { IconIdCard } from "../Icons"

import type { DocumentType } from "../api"

/**
 * Pantalla 2 — Elegir documento (estilo Didit).
 * Cédula de Identidad (default, cédula PY) y Pasaporte (ICAO, cualquier país
 * emisor) funcionales: el `documentType` elegido viaja al backend, que rutea la
 * extracción por él (multi-documento P1 #3). Licencia / Carnet de residente
 * siguen como "Próximamente" (sin extractor todavía). Selector de país: Paraguay
 * por default (para pasaporte el país sale del MRZ, no de este selector).
 */
const DOC_TYPES: Array<{
  id: string
  label: string
  hint: string
  enabled: boolean
  /** Mapeo al literal que entiende el backend (DocumentType). */
  documentType?: DocumentType
}> = [
  { id: "cedula", label: "Cédula de Identidad", hint: "Documento nacional", enabled: true, documentType: "ci_py" },
  { id: "pasaporte", label: "Pasaporte", hint: "Internacional", enabled: true, documentType: "passport" },
  { id: "licencia", label: "Licencia de conducir", hint: "", enabled: false },
  { id: "residente", label: "Carnet de residente", hint: "", enabled: false },
]

export function ChooseDocument({
  onDone,
  onBack,
}: {
  /** Recibe el tipo de documento elegido para que el sub-flujo de captura rutee. */
  onDone: (documentType: DocumentType) => void
  onBack?: () => void
}) {
  const [docType, setDocType] = useState("cedula")

  return (
    <Card>
      <div className="teko-slide-in flex flex-col">
        <BackBar onBack={onBack} />
        <h1 className="text-xl font-bold text-gray-900">Elegí tu documento</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          Seleccioná el documento con el que querés verificarte.
        </p>

        {/* Selector de país (Paraguay por default) */}
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            País emisor
          </p>
          <div className="flex items-center gap-3 rounded-2xl border border-primary bg-primary-subtle/50 px-4 py-3.5 ring-1 ring-primary">
            <span className="text-2xl leading-none">🇵🇾</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">
                Paraguay
              </span>
              <span className="block text-xs text-gray-400">
                Otros países, próximamente
              </span>
            </span>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary">
              <svg viewBox="0 0 24 24" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </div>
        </div>

        {/* Tipo de documento */}
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Tipo de documento
          </p>
          <div className="flex flex-col gap-2.5">
            {DOC_TYPES.map((d) => (
              <OptionRow
                key={d.id}
                icon={<IconIdCard className="size-5" />}
                label={d.label}
                hint={d.enabled ? d.hint || undefined : undefined}
                selected={d.enabled && docType === d.id}
                disabled={!d.enabled}
                badge={d.enabled ? undefined : "Próximamente"}
                onClick={d.enabled ? () => setDocType(d.id) : undefined}
              />
            ))}
          </div>
        </div>

        <div className="mt-7">
          <Button
            onClick={() => {
              const chosen = DOC_TYPES.find((d) => d.id === docType)
              onDone(chosen?.documentType ?? "ci_py")
            }}
          >
            Continuar
          </Button>
        </div>
      </div>
    </Card>
  )
}
