import { useRef, useState } from "react"
import { uploadProofOfAddress } from "../api"
import { errorMessage } from "../messages"
import { Button, Card, BackBar, ChecklistItem, Notice } from "../ui"
import { IconSun } from "../Icons"

/**
 * Paso "Comprobante de domicilio" (P1 #4) — estilo Didit (marca Teko).
 *
 * Sólo aparece cuando el workflow lo exige (App lo gatea con
 * `status.requiresProofOfAddress`). El titular sube una FOTO o un ARCHIVO (admite
 * PDF) de una factura de servicio / extracto bancario reciente con su nombre y
 * dirección visibles. El backend OCR-ea y valida (nombre/fecha/domicilio) en el
 * pipeline; acá sólo coacheamos y subimos. Fail-soft: error legible + reintento.
 */
export function ProofOfAddress({
  onDone,
  onBack,
}: {
  onDone: () => void
  onBack?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // Lee el archivo elegido como data-URL base64 y lo sube a /proof-of-address.
  async function onPick(file: File | undefined) {
    if (!file) return
    setErr(null)
    setFileName(file.name)
    setUploading(true)
    try {
      const dataUrl = await fileToDataUrl(file)
      await uploadProofOfAddress(dataUrl)
      onDone()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <div className="teko-slide-in flex flex-col">
        <BackBar onBack={onBack} />
        <h1 className="text-xl font-bold text-gray-900">Comprobante de domicilio</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          Subí una factura reciente (luz, agua, teléfono) o un extracto bancario donde
          se vean tu <span className="font-semibold text-gray-700">nombre</span> y tu{" "}
          <span className="font-semibold text-gray-700">dirección</span>.
        </p>

        <ul className="mt-5 flex flex-col gap-4">
          <ChecklistItem
            icon={<IconSun className="size-6" />}
            title="Reciente"
            desc="Emitido en los últimos meses."
          />
          <ChecklistItem
            icon={<IconSun className="size-6" />}
            title="Con tu nombre"
            desc="El titular del comprobante debe coincidir con tu identidad."
          />
          <ChecklistItem
            icon={<IconSun className="size-6" />}
            title="Dirección visible"
            desc="Que se lea la calle, el número y la ciudad."
          />
        </ul>

        {err && <Notice>{err}</Notice>}
        {fileName && !err && (
          <p className="mt-3 truncate text-xs text-gray-400">Archivo: {fileName}</p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />

        <div className="mt-6">
          <Button
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Subiendo…" : "Subir comprobante"}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** File → data-URL base64 (FileReader). Rechaza si la lectura falla. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}
