import { useEffect, useRef } from "react"
import { apiPost, getStatus, ApiError, type StatusResult } from "../api"
import { Card } from "../ui"
import { Spinner } from "../Icons"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TERMINAL = ["verified", "rejected", "needs_recapture", "error", "expired"]

/**
 * Pantalla "Procesando…" (estilo Didit) — ahora ORQUESTA el pipeline completo,
 * sin pantalla intermedia de datos (como Didit: selfie → procesando → resultado):
 *
 *   1) POST /preview  — corre el pipeline SIN finalizar (review). Es idempotente,
 *      así que también sirve para rehidratar desde el estado 'review' del backend.
 *      Si /preview diverge (409 preview_not_review con needs_recapture/rejected),
 *      mapeamos a un resultado con los `reasons` accionables → Result los humaniza.
 *   2) POST /confirm  — finaliza desde 'review' y devuelve el estado terminal.
 *   3) Si el terminal aún no vino (caso raro), hacemos polling de /status.
 *
 * Fail-closed: cualquier error → resultado 'error' (nunca cuelga). Los `reasons`
 * de recaptura se preservan para que Result muestre los motivos (#11).
 */
export function Processing({
  onResult,
}: {
  onResult: (s: StatusResult) => void
}) {
  const done = useRef(false)

  useEffect(() => {
    done.current = false

    async function run() {
      // --- 1) Preview (idempotente; también rehidrata desde 'review') --------
      try {
        await apiPost("/preview", {})
      } catch (e) {
        if (done.current) return
        // preview_not_review trae el estado real (needs_recapture/rejected) y los
        // `reasons` accionables. Los pasamos a Result para que muestre los motivos.
        if (e instanceof ApiError) {
          const st = e.state
          if (st && TERMINAL.includes(st)) {
            onResult({ state: st, reasons: e.reasons })
            return
          }
          // preview_not_review con reasons accionables → needs_recapture (motivos).
          if (e.reasons && e.reasons.length) {
            onResult({ state: "needs_recapture", reasons: e.reasons })
            return
          }
          // Estado NO terminal y sin reasons (p.ej. invalid_state_for_preview si la
          // sesión ya está en 'processing' por una carrera de rehidratación): NO es
          // un error real — caemos al polling de /status, que verá el terminal
          // cuando el pipeline (síncrono) finalice. Fail-closed pero sin pantalla
          // de error espuria.
        } else {
          onResult({ state: "error" })
          return
        }
      }

      if (done.current) return

      // --- 2) Confirm (finaliza desde 'review') ------------------------------
      try {
        const r = await apiPost<{
          state?: string
          reasons?: string[]
          redirectUrl?: string | null
        }>("/confirm", {})
        if (done.current) return
        if (r?.state && TERMINAL.includes(r.state)) {
          onResult({
            state: r.state,
            reasons: r.reasons,
            redirectUrl: r.redirectUrl ?? undefined,
          })
          return
        }
        // confirm no devolvió terminal → caemos al polling de status.
      } catch (e) {
        if (done.current) return
        if (e instanceof ApiError && e.state && TERMINAL.includes(e.state)) {
          onResult({ state: e.state, reasons: e.reasons })
          return
        }
        // Seguimos al polling: el pipeline puede haber finalizado igual.
      }

      // --- 3) Polling de respaldo (SSE/estado final) -------------------------
      for (let i = 0; i < 60; i++) {
        await sleep(2000)
        if (done.current) return
        try {
          const s = await getStatus()
          if (TERMINAL.includes(s.state)) {
            if (!done.current) onResult(s)
            return
          }
        } catch {
          continue
        }
      }
      if (!done.current) onResult({ state: "error" })
    }

    void run()
    return () => {
      done.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card>
      <div className="flex flex-col items-center gap-5 py-12 text-center">
        <Spinner className="size-14" />
        <h1 className="text-xl font-bold text-gray-900">
          Estamos verificando tu identidad…
        </h1>
        <p className="max-w-xs text-sm leading-relaxed text-gray-500">
          Comprobamos tu documento y tu selfie. Tarda unos segundos, no cierres
          esta pantalla.
        </p>
      </div>
    </Card>
  )
}
