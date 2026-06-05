import { Button, Card } from "../ui"
import { IconCheck } from "../Icons"

/**
 * Pantalla 7 — "Documento subido" (estilo Didit). Confirmación breve con los
 * dos lados marcados ✓. Sólo UX: las imágenes ya se subieron (POST /document).
 */
export function DocSubmitted({ onDone }: { onDone: () => void }) {
  return (
    <Card>
      <div className="teko-slide-in flex flex-col items-center text-center">
        <div className="teko-pop mt-2 flex size-20 items-center justify-center rounded-full bg-success-subtle text-primary">
          <IconCheck className="size-10" />
        </div>
        <h1 className="mt-4 text-xl font-bold text-gray-900">
          Documento subido
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-gray-500">
          Recibimos las dos fotos de tu cédula. Ahora vamos con la selfie.
        </p>

        <ul className="mt-6 w-full max-w-xs space-y-2.5 text-left">
          <SubmittedRow label="Frente del documento" />
          <SubmittedRow label="Dorso del documento" />
        </ul>

        <div className="mt-7 w-full">
          <Button onClick={onDone}>Continuar</Button>
        </div>
      </div>
    </Card>
  )
}

function SubmittedRow({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-gray-50 px-4 py-3 ring-1 ring-gray-100">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-white">
        <IconCheck className="size-3.5" />
      </span>
      <span className="text-sm font-medium text-gray-700">{label}</span>
    </li>
  )
}
