import { useEffect, useState } from "react"
import { apiPost, type PreviewResult } from "../api"
import { Button, Card } from "../ui"
import { IconCheck, IconShield } from "../Icons"

/**
 * Pantalla de REVISIÓN — el usuario ve SUS datos antes de confirmar.
 *  - Al montar: POST /preview (corre el pipeline SIN finalizar).
 *  - Muestra los datos extraídos (defensivo: "—" si falta) + el match
 *    (selfie vs. foto de la cédula, lado a lado) + coincidencia ✓/✗.
 *  - "Confirmar mi identidad" → POST /confirm → procesando.
 *  - "Volver a intentar" → reinicia desde la selfie.
 *
 * NADA se finaliza sin que el usuario confirme.
 */

/** Formatea una fecha ISO (YYYY-MM-DD) a DD/MM/AAAA; deja el resto tal cual. */
function fmtDate(v?: string): string {
  if (!v) return "—"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}
const val = (v?: string) => (v && v.trim() ? v : "—")

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </span>
      <span className="text-right text-sm font-semibold text-gray-900">
        {value}
      </span>
    </div>
  )
}

export function Review({
  onConfirmed,
  onRetry,
}: {
  onConfirmed: () => void
  onRetry: () => void
}) {
  const [data, setData] = useState<PreviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let alive = true
    async function run() {
      setLoading(true)
      setErr(null)
      try {
        const r = await apiPost<PreviewResult>("/preview", {})
        if (alive) setData(r)
      } catch (e) {
        if (alive)
          setErr(
            "No pudimos preparar tus datos: " +
              (e instanceof Error ? e.message : String(e)),
          )
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [])

  async function confirm() {
    setConfirming(true)
    setErr(null)
    try {
      await apiPost("/confirm", {})
      onConfirmed()
    } catch (e) {
      setConfirming(false)
      setErr(
        "No pudimos confirmar: " +
          (e instanceof Error ? e.message : String(e)),
      )
    }
  }

  // ---- Cargando ----------------------------------------------------------
  if (loading) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-5 py-10 text-center">
          <div
            className="size-12 rounded-full border-4 border-gray-200 border-t-primary"
            style={{ animation: "teko-spin 1s linear infinite" }}
          />
          <h1 className="text-lg font-bold text-gray-900">
            Preparando tus datos…
          </h1>
          <p className="max-w-xs text-sm text-gray-500">
            Estamos leyendo tu cédula y comparándola con tu selfie.
          </p>
        </div>
      </Card>
    )
  }

  // ---- Error al previsualizar -------------------------------------------
  if (err && !data) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-error-subtle text-error">
            <span className="text-3xl font-bold">!</span>
          </div>
          <h1 className="text-lg font-bold text-gray-900">
            Algo salió mal
          </h1>
          <p className="max-w-xs text-sm text-gray-500">{err}</p>
          <div className="w-full">
            <Button onClick={onRetry}>Volver a intentar</Button>
          </div>
        </div>
      </Card>
    )
  }

  const t = data?.extracted?.titular ?? {}
  const doc = data?.extracted?.documento ?? {}
  const docf = data?.extracted?.documentoFisico ?? {}
  const photos = data?.photos ?? {}
  const matchPassed = data?.match?.passed === true
  const lugar = [t.lugarNacimiento?.ciudad, t.lugarNacimiento?.departamento]
    .filter((s) => s && s.trim())
    .join(", ")

  return (
    <Card>
      <div className="teko-slide-in">
        <h1 className="text-xl font-bold text-gray-900">
          ¿Son correctos tus datos?
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          Revisá lo que leímos de tu cédula. Si está todo bien, confirmá tu
          identidad.
        </p>

        {/* ---- Bloque de coincidencia (selfie vs. cédula) ---- */}
        <div
          className={`mt-5 rounded-2xl p-4 ring-1 ${
            matchPassed
              ? "bg-success-subtle ring-primary/20"
              : "bg-warning-subtle ring-warning/20"
          }`}
        >
          <div className="flex items-center justify-center gap-4">
            <FaceThumb src={photos.selfieCrop} label="Tu selfie" />
            <div
              className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                matchPassed
                  ? "bg-primary text-white"
                  : "bg-warning text-white"
              }`}
            >
              {matchPassed ? (
                <IconCheck className="size-5" />
              ) : (
                <span className="text-lg font-bold">≈</span>
              )}
            </div>
            <FaceThumb src={photos.docFaceCrop} label="Tu cédula" />
          </div>
          <p
            className={`mt-3 text-center text-sm font-semibold ${
              matchPassed ? "text-primary-deep" : "text-amber-800"
            }`}
          >
            {matchPassed
              ? "Coincidencia confirmada ✓"
              : "Revisaremos la coincidencia"}
          </p>
        </div>

        {/* ---- Datos extraídos ---- */}
        <div className="mt-5 divide-y divide-gray-100 rounded-2xl bg-gray-50 px-4 ring-1 ring-gray-100">
          <Row label="Apellidos" value={val(t.apellidos)} />
          <Row label="Nombres" value={val(t.nombres)} />
          <Row label="Cédula" value={val(doc.numeroCedula)} />
          <Row label="Fecha nac." value={fmtDate(t.fechaNacimiento)} />
          <Row label="Sexo" value={val(t.sexo)} />
          <Row label="Vencimiento" value={fmtDate(docf.fechaVencimiento)} />
          <Row label="Nacionalidad" value={val(t.nacionalidad)} />
          <Row label="Estado civil" value={val(t.estadoCivil)} />
          {lugar && <Row label="Lugar nac." value={lugar} />}
        </div>

        {err && (
          <p className="mt-3 text-sm text-error" role="alert">
            {err}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          <Button disabled={confirming} onClick={() => void confirm()}>
            <span className="flex items-center justify-center gap-2">
              <IconShield className="size-5" />
              {confirming ? "Confirmando…" : "Confirmar mi identidad"}
            </span>
          </Button>
          <Button variant="ghost" disabled={confirming} onClick={onRetry}>
            Volver a intentar
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Miniatura de rostro (selfie / cédula). Placeholder si no hay foto. */
function FaceThumb({ src, label }: { src?: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="size-20 overflow-hidden rounded-2xl bg-white ring-1 ring-gray-200">
        {src ? (
          <img
            src={src}
            alt={label}
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-gray-300">
            <IconShield className="size-8" />
          </div>
        )}
      </div>
      <span className="text-[11px] font-medium text-gray-500">{label}</span>
    </div>
  )
}
