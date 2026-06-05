import { useState } from "react"
import { apiPost, CONSENT_VERSION } from "../api"
import { errorMessage } from "../messages"
import { Button, Card, ChecklistItem } from "../ui"
import { VerifyHero, IconIdCard, IconFace, IconLock } from "../Icons"

/**
 * Pantalla 1 — Intro "Verificá tu identidad" (estilo Didit).
 * Branding Teko + checklist de lo que se necesita + CTA "Continuar".
 *
 * IMPORTANTE: al tocar "Continuar" registramos el consentimiento REAL
 * (POST /consent → created→capturing). Esta pantalla PRECEDE/reemplaza al
 * consentimiento, pero NO saltea el registro: el aviso de Ley 7593 y el
 * registro server-side se mantienen (guard de consentimiento intacto).
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setErr(null)
    try {
      await apiPost("/consent", {
        accepted: true,
        consentVersion: CONSENT_VERSION,
      })
      onDone()
    } catch (e) {
      setBusy(false)
      setErr(errorMessage(e))
    }
  }

  return (
    <Card>
      <div className="teko-slide-in flex flex-col">
        <div className="teko-pop mx-auto mb-1 size-28 text-primary">
          <VerifyHero className="size-28" />
        </div>
        <h1 className="text-center text-2xl font-bold text-gray-900">
          Verificá tu identidad
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-gray-500">
          Para confirmar que sos vos vamos a necesitar tu documento y una selfie.
          Toma 2 a 3 minutos.
        </p>

        <ul className="mt-7 flex flex-col gap-5">
          <ChecklistItem
            icon={<IconIdCard className="size-6" />}
            title="Tu documento de identidad"
            desc="Cédula paraguaya, frente y dorso."
          />
          <ChecklistItem
            icon={<IconFace className="size-6" />}
            title="Una selfie"
            desc="Para comparar tu rostro con el documento."
          />
          <ChecklistItem
            icon={<IconLock className="size-6" />}
            title="Tus datos protegidos"
            desc="Encriptados y usados solo para verificarte (Ley 7593)."
          />
        </ul>

        {err && (
          <p className="mt-4 text-sm text-error" role="alert">
            {err}
          </p>
        )}

        <div className="mt-7">
          <Button disabled={busy} onClick={go}>
            {busy ? "Un momento…" : "Continuar"}
          </Button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-gray-400">
            Al continuar autorizás el tratamiento de tu rostro y documento con la
            única finalidad de verificar tu identidad, conforme a la Ley N°
            7593/2025.
          </p>
        </div>
      </div>
    </Card>
  )
}
