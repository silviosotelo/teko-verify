import { useState } from "react"
import { apiPost, CONSENT_VERSION } from "../api"
import { errorMessage } from "../messages"
import { Button, Card, TrustPoint } from "../ui"
import { VerifyHero, IconClock, IconLock, IconEye } from "../Icons"

/**
 * Pantalla de consentimiento — look "Let's verify your identity" de la
 * referencia Behance: hero ilustrado, copy humano, puntos de confianza y CTA.
 * Lógica: POST /consent {accepted:true, consentVersion:"1.0"} → avanza a selfie.
 */
export function Consent({ onDone }: { onDone: () => void }) {
  const [agree, setAgree] = useState(false)
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
      <div className="teko-pop mx-auto mb-2 size-32 text-primary">
        <VerifyHero className="size-32" />
      </div>
      <h1 className="text-center text-2xl font-bold text-gray-900">
        Verifiquemos tu identidad
      </h1>
      <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-gray-500">
        Vamos a sacarte una selfie y una foto de tu cédula para confirmar que
        sos vos. Es rápido y seguro.
      </p>

      <ul className="mx-auto mt-6 flex max-w-xs flex-col gap-3">
        <TrustPoint icon={<IconClock className="size-5" />}>
          Toma alrededor de 60 segundos
        </TrustPoint>
        <TrustPoint icon={<IconLock className="size-5" />}>
          Tus datos están encriptados
        </TrustPoint>
        <TrustPoint icon={<IconEye className="size-5" />}>
          Solo se usan para verificar tu identidad
        </TrustPoint>
      </ul>

      <div className="mt-6 rounded-2xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500 ring-1 ring-gray-100">
        Autorizo el tratamiento de mis datos biométricos (rostro) y de mi
        documento con la única finalidad de verificar mi identidad, conforme a
        la Ley N° 7593/2025 de Protección de Datos Personales de la República
        del Paraguay.
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <span>Leí y acepto el tratamiento de mis datos para verificar mi identidad.</span>
      </label>

      {err && (
        <p className="mt-3 text-sm text-error" role="alert">
          {err}
        </p>
      )}

      <div className="mt-5">
        <Button disabled={!agree || busy} onClick={go}>
          {busy ? "Un momento…" : "Continuar"}
        </Button>
      </div>
    </Card>
  )
}
