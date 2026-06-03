import { useEffect, useRef } from "react"
import { apiPost, getStatus, type StatusResult } from "../api"
import { Card } from "../ui"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TERMINAL = ["verified", "rejected", "needs_recapture", "error", "expired"]

/**
 * Pantalla "Verificando tu identidad…". Lógica PORTADA:
 *  - POST /submit (puede ya estar processing → ignoramos el error).
 *  - Polling GET /status cada 2s, hasta 60 intentos (fallback robusto al SSE).
 *  - Al llegar a un estado terminal → onResult(status).
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
      try {
        await apiPost("/submit", {})
      } catch {
        /* puede ya estar processing */
      }
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
      <div className="flex flex-col items-center gap-5 py-10 text-center">
        <div
          className="size-14 rounded-full border-4 border-gray-200 border-t-primary"
          style={{ animation: "teko-spin 1s linear infinite" }}
        />
        <h1 className="text-xl font-bold text-gray-900">
          Verificando tu identidad…
        </h1>
        <p className="max-w-xs text-sm leading-relaxed text-gray-500">
          Estamos comprobando tus fotos. Esto tarda unos segundos, no cierres
          esta pantalla.
        </p>
      </div>
    </Card>
  )
}
