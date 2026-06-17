import { useEffect, useState } from "react"
import { TOKEN, getStatus, ApiError, type StatusResult, type DocumentType } from "./api"
import { errorMessage } from "./messages"
import { Brand, Card, Stepper } from "./ui"
import { Spinner, CameraHero, IconSun, IconFace, IconNoGlasses } from "./Icons"
import { Intro } from "./screens/Intro"
import { ChooseDocument } from "./screens/ChooseDocument"
import { DocCapture } from "./screens/DocCapture"
import { Prepare } from "./screens/Prepare"
import { Selfie } from "./screens/Selfie"
import { Processing } from "./screens/Processing"
import { Result } from "./screens/Result"
import { warmupFaceLandmarker } from "./useFaceLandmarker"

/**
 * Wizard de captura Teko Verify — flujo estilo Didit (marca Teko), DOCUMENTO
 * PRIMERO, luego selfie:
 *
 *   intro → choose-doc → [DocCapture: prep·frente·revisar·dorso·revisar·subido]
 *         → prep-selfie → selfie → processing → result
 *
 * DocCapture es un sub-flujo (orquesta sus propias pantallas de preparación,
 * captura, revisión por lado y "documento subido"). Processing orquesta
 * preview→confirm (sin pantalla de datos, como Didit).
 *
 * El token sale de location.pathname (último segmento de /verify/:token).
 */
type Step =
  | "loading"
  | "intro"
  | "choose-doc"
  | "doc"
  | "prep-selfie"
  | "selfie"
  | "processing"
  | "result"
  | "error"

// Fase macro (0..3) para la barra de progreso sutil (Stepper).
// 0 Inicio · 1 Documento · 2 Selfie · 3 Verificación.
const STEP_PHASE: Record<Step, number> = {
  loading: 0,
  intro: 0,
  "choose-doc": 1,
  doc: 1,
  "prep-selfie": 2,
  selfie: 2,
  processing: 3,
  result: 3,
  error: 3,
}

/**
 * Mapea el estado del backend (GET /status) a la pantalla del wizard al
 * rehidratar (#3). El backend sólo tiene ~4 estados; no sabe en qué sub-paso de
 * captura quedó el front, así que reentramos al INICIO de cada fase (todas las
 * subidas son idempotentes — /selfie y /document sobrescriben):
 *
 *  - created → intro. El consentimiento AÚN no se registró: la transición
 *    created→capturing la dispara "Continuar" en intro (Ley 7593). NO saltearlo.
 *  - capturing → choose-doc (inicio de la fase de captura). Reentrar acá es
 *    seguro aunque ya hubiera un lado subido: el flujo vuelve a subir todo.
 *  - review → processing (re-corre /preview, idempotente, y confirma).
 *  - processing → processing (polling).
 *  - verified/rejected/needs_recapture/error/expired → resultado (terminal/tip).
 */
function stepForState(state: string): Step {
  switch (state) {
    case "created":
      return "intro"
    case "capturing":
      return "choose-doc"
    case "review":
      return "processing"
    case "processing":
      return "processing"
    case "verified":
    case "rejected":
    case "needs_recapture":
    case "error":
    case "expired":
      return "result"
    default:
      return "intro"
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
        <Stepper active={STEP_PHASE[step]} />
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
  // inválido/expirado (#6), sin pasar por el flujo.
  const [step, setStep] = useState<Step>("loading")
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  // Tipo de documento elegido en "Elegir documento" (multi-documento P1 #3). Rige
  // el sub-flujo de captura (pasaporte = una sola página) y viaja en POST /document.
  // Default "ci_py" (cédula PY) → comportamiento idéntico al previo.
  const [documentType, setDocumentType] = useState<DocumentType>("ci_py")

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
        // directa, NO el flujo (#6). Otros errores: arrancamos en intro
        // (fail-open hacia el flujo normal; el backend re-valida).
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
          setLinkError(errorMessage(e))
          setStep("error")
        } else {
          setStep("intro")
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Precarga del FaceLandmarker del liveness activo EN PARALELO mientras el usuario
  // está en "Preparate para la cámara" (o ya capturando el documento), para que la
  // selfie arranque sin la espera fría del wasm/modelo. Idempotente (singleton de sesión).
  useEffect(() => {
    if (step === "prep-selfie" || step === "doc") warmupFaceLandmarker()
  }, [step])

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
              <Spinner />
              <p className="text-sm text-gray-500">Cargando tu verificación…</p>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <Shell step={step}>
      {step === "intro" && <Intro onDone={() => setStep("choose-doc")} />}
      {step === "choose-doc" && (
        <ChooseDocument
          onDone={(dt) => {
            setDocumentType(dt)
            setStep("doc")
          }}
        />
      )}
      {step === "doc" && (
        <DocCapture
          documentType={documentType}
          onDone={() => setStep("prep-selfie")}
          onBack={() => setStep("choose-doc")}
        />
      )}
      {step === "prep-selfie" && (
        <Prepare
          hero={<CameraHero className="h-28 w-32" />}
          title="Preparate para la cámara"
          subtitle="Última parte: una selfie para confirmar que sos vos."
          tips={[
            { icon: <IconSun className="size-6" />, title: "Buena luz", desc: "Ubicate frente a una fuente de luz, no a contraluz." },
            { icon: <IconFace className="size-6" />, title: "Despejá tu cara", desc: "Sin gorro ni nada que tape tu rostro." },
            { icon: <IconNoGlasses className="size-6" />, title: "Sin anteojos ni reflejos", desc: "Quitate los anteojos para que se vean tus ojos." },
          ]}
          cta="Estoy listo"
          onDone={() => setStep("selfie")}
          onBack={() => setStep("doc")}
        />
      )}
      {step === "selfie" && (
        <Selfie
          onDone={() => setStep("processing")}
          onBack={() => setStep("prep-selfie")}
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
        <Result status={status} onRetry={() => setStep("choose-doc")} />
      )}
    </Shell>
  )
}
