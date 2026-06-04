import { useState } from "react"
import { TOKEN, type StatusResult } from "./api"
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
  | "consent"
  | "selfie"
  | "doc"
  | "review"
  | "processing"
  | "result"

// Índice de paso para el Stepper. Labels: Consentimiento·Selfie·Cédula·Revisión·Listo.
// review = paso 3 (Revisión); processing/result = paso 4 (Listo).
const STEP_INDEX: Record<Step, number> = {
  consent: 0,
  selfie: 1,
  doc: 2,
  review: 3,
  processing: 4,
  result: 4,
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

export function App() {
  const [step, setStep] = useState<Step>("consent")
  const [status, setStatus] = useState<StatusResult | null>(null)

  if (!TOKEN) {
    return (
      <div className="teko-bg flex min-h-full flex-col items-center px-4 py-6">
        <div className="flex w-full max-w-md flex-col items-center">
          <Brand />
          <Card>
            <h1 className="text-xl font-bold text-gray-900">Enlace inválido</h1>
            <p className="mt-1 text-sm text-gray-500">
              Falta el token de verificación.
            </p>
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
          onConfirmed={() => setStep("processing")}
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
