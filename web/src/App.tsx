import { useEffect, useState } from "react"
import { TOKEN, getStatus, ApiError, type StatusResult } from "./api"
import { errorMessage } from "./messages"
import { Brand, Card, Stepper } from "./ui"
import { Consent } from "./screens/Consent"
import { Selfie } from "./screens/Selfie"
import { DocCapture } from "./screens/DocCapture"
import { Review } from "./screens/Review"
import { Processing } from "./screens/Processing"
import { Result } from "./screens/Result"

/**
 * Wizard de captura Teko Verify. Máquina de estados que reproduce el flujo del
 * HTML vanilla original:
 *   consent → selfie → doc (frente/dorso) → review → processing → result
 * El token sale de location.pathname (último segmento de /verify/:token).
 */
type Step =
  | "loading"
  | "consent"
  | "selfie"
  | "doc"
  | "review"
  | "processing"
  | "result"
  | "error"

// Índice de paso para el Stepper. Labels: Consentimiento·Selfie·Cédula·Revisión·Listo.
// review = paso 3 (Revisión); processing/result = paso 4 (Listo).
const STEP_INDEX: Record<Step, number> = {
  loading: 0,
  consent: 0,
  selfie: 1,
  doc: 2,
  review: 3,
  processing: 4,
  result: 4,
  error: 4,
}

/**
 * Mapea el estado del backend (GET /status) a la pantalla del wizard (#3).
 * - created → consentimiento AÚN no registrado (la transición created→capturing
 *   la hace el consent, §4/Ley 7593). NO saltearlo: debe ver la pantalla de
 *   consentimiento (de lo contrario bypassearíamos el registro de consentimiento).
 * - capturing → reanuda la captura desde la selfie (el front no persiste en qué
 *   sub-paso quedó; la selfie es el punto de re-entrada seguro).
 * - review → pantalla de revisión (re-corre /preview, idempotente).
 * - processing → spinner de verificación (polling).
 * - verified/rejected/needs_recapture/error/expired → resultado (terminal/tip).
 */
function stepForState(state: string): Step {
  switch (state) {
    case "created":
      return "consent"
    case "capturing":
      return "selfie"
    case "review":
      return "review"
    case "processing":
      return "processing"
    case "verified":
    case "rejected":
    case "needs_recapture":
    case "error":
    case "expired":
      return "result"
    default:
      return "consent"
  }
}

function Shell({
  step,
  children,
}: {
  step: Step
  children: React.ReactNode
}) {
  return (
    <div className="teko-bg flex min-h-full flex-col items-center px-4 py-6">
      <div className="flex w-full max-w-md flex-col items-center">
        <Brand />
        <Stepper active={STEP_INDEX[step]} />
        {children}
        <footer className="mt-5 max-w-md px-4 text-center text-[11px] leading-relaxed text-gray-400">
          Tus datos se tratan solo para verificar tu identidad · Ley N°
          7593/2025
        </footer>
      </div>
    </div>
  )
}

/** Pantalla de error de enlace (token inválido/expirado/consumido) — sin Stepper. */
function LinkError({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="teko-bg flex min-h-full flex-col items-center px-4 py-6">
      <div className="flex w-full max-w-md flex-col items-center">
        <Brand />
        <Card>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-error-subtle text-error">
              <span className="text-3xl font-bold">!</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            <p className="max-w-xs text-sm leading-relaxed text-gray-500">
              {desc}
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}

export function App() {
  // Arrancamos en 'loading': consultamos /status ANTES de pintar el wizard para
  // rehidratar al estado correcto (#3) y mostrar error directo si el token es
  // inválido/expirado (#6), sin pasar por consentimiento.
  const [step, setStep] = useState<Step>("loading")
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  // Rehidratación al montar (#3/#6).
  useEffect(() => {
    if (!TOKEN) {
      setLinkError("Falta el token de verificación.")
      setStep("error")
      return
    }
    let alive = true
    void (async () => {
      try {
        const s = await getStatus()
        if (!alive) return
        const target = stepForState(s.state)
        // Estados terminales/tip rehidratan directo al resultado con su payload.
        if (target === "result") setStatus(s)
        setStep(target)
      } catch (e) {
        if (!alive) return
        // Token inválido (404) o expirado/consumido (410) → pantalla de error
        // directa, NO consentimiento (#6). Otros errores: dejamos arrancar en
        // consentimiento (fail-open hacia el flujo normal; el backend re-valida).
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
          setLinkError(errorMessage(e))
          setStep("error")
        } else {
          setStep("consent")
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (step === "error") {
    return (
      <LinkError
        title="Enlace no disponible"
        desc={linkError ?? "Este enlace no es válido. Pedí uno nuevo."}
      />
    )
  }

  if (step === "loading") {
    return (
      <div className="teko-bg flex min-h-full flex-col items-center px-4 py-6">
        <div className="flex w-full max-w-md flex-col items-center">
          <Brand />
          <Card>
            <div className="flex flex-col items-center gap-5 py-10 text-center">
              <div
                className="size-12 rounded-full border-4 border-gray-200 border-t-primary"
                style={{ animation: "teko-spin 1s linear infinite" }}
              />
              <p className="text-sm text-gray-500">Cargando tu verificación…</p>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <Shell step={step}>
      {step === "consent" && <Consent onDone={() => setStep("selfie")} />}
      {step === "selfie" && <Selfie onDone={() => setStep("doc")} />}
      {step === "doc" && <DocCapture onDone={() => setStep("review")} />}
      {step === "review" && (
        <Review
          onConfirmed={(s) => {
            // #8: si /confirm ya devolvió un estado terminal, vamos directo al
            // resultado sin esperar el primer poll de Processing.
            if (s) {
              setStatus(s)
              setStep("result")
            } else {
              setStep("processing")
            }
          }}
          onRetry={() => setStep("selfie")}
        />
      )}
      {step === "processing" && (
        <Processing
          onResult={(s) => {
            setStatus(s)
            setStep("result")
          }}
        />
      )}
      {step === "result" && status && (
        <Result status={status} onRetry={() => setStep("selfie")} />
      )}
    </Shell>
  )
}
