import { useEffect, useState, useCallback, useRef } from "react"
import { api, type EventRow } from "./api"
import { C, Card, Spinner } from "./ui"

const KIND_LABEL: Record<string, string> = {
  recognize: "Reconocimiento",
  enroll: "Enrolamiento",
  update: "Actualización",
  delete: "Baja",
}

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString("es-PY", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch {
    return ts
  }
}

function resultChip(e: EventRow): { text: string; color: string; bg: string } {
  if (e.success) return { text: "✓ Reconocido", color: "#22c55e", bg: "rgba(34,197,94,0.12)" }
  if (e.error && /no face|rostro/i.test(e.error))
    return { text: "Sin rostro", color: C.muted, bg: "rgba(148,163,184,0.12)" }
  if (e.kind === "recognize") return { text: "Sin match", color: C.warning, bg: "rgba(245,158,11,0.12)" }
  return { text: "Falló", color: C.error, bg: "rgba(239,68,68,0.12)" }
}

export function History({ active }: { active: boolean }) {
  const [rows, setRows] = useState<EventRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState("")
  const [result, setResult] = useState("")
  const [ci, setCi] = useState("")
  const [zoom, setZoom] = useState<EventRow | null>(null)
  const [live, setLive] = useState(false)
  const [pending, setPending] = useState(0)
  const limit = 30

  // Keep refs current so the long-lived SSE handler reads latest filters/page.
  const f = useRef({ kind, result, ci, offset })
  f.current = { kind, result, ci, offset }

  const matches = (e: EventRow): boolean => {
    const { kind: k, result: r, ci: c } = f.current
    if (k && e.kind !== k) return false
    if (r === "true" && e.success !== true) return false
    if (r === "false" && e.success !== false) return false
    if (c && !(e.ci || "").toLowerCase().includes(c.toLowerCase())) return false
    return true
  }

  const load = useCallback(
    async (off: number) => {
      setLoading(true)
      setPending(0)
      try {
        const page = await api.events({ kind, ci, success: result, limit, offset: off })
        setRows(page.rows)
        setTotal(page.total)
        setOffset(off)
      } catch {
        setRows([])
        setTotal(0)
      } finally {
        setLoading(false)
      }
    },
    [kind, ci, result]
  )

  useEffect(() => {
    if (active) load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, kind, result])

  // SSE live stream — open while the tab is active.
  useEffect(() => {
    if (!active) return
    const es = new EventSource(api.eventsStreamUrl())
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    es.onmessage = (m) => {
      let ev: EventRow
      try {
        ev = JSON.parse(m.data)
      } catch {
        return
      }
      if (f.current.offset === 0 && matches(ev)) {
        setRows((prev) => [ev, ...prev].slice(0, limit))
        setTotal((t) => t + 1)
      } else {
        setPending((p) => p + 1)
      }
    }
    return () => {
      es.close()
      setLive(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Polling fallback every 4s on the first page — works through proxies that
  // buffer SSE (e.g. the Cloudflare quick tunnel). Harmless on LAN where SSE
  // already delivers instantly: it just reconciles the first page.
  useEffect(() => {
    if (!active) return
    const iv = setInterval(async () => {
      if (f.current.offset !== 0) return
      try {
        const page = await api.events({
          kind: f.current.kind,
          ci: f.current.ci,
          success: f.current.result,
          limit,
          offset: 0,
        })
        setRows((prev) =>
          prev[0]?.id === page.rows[0]?.id && prev.length === page.rows.length
            ? prev
            : page.rows
        )
        setTotal(page.total)
      } catch {
        /* ignore */
      }
    }, 4000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const selStyle = {
    background: "var(--bg-tertiary)",
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: "9px 11px",
    color: C.text,
    fontSize: 13,
    outline: "none",
  } as const

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Filtros */}
      <Card style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...selStyle, flex: 1 }}>
            <option value="">Todos los tipos</option>
            <option value="recognize">Reconocimientos</option>
            <option value="enroll">Enrolamientos</option>
          </select>
          <select value={result} onChange={(e) => setResult(e.target.value)} style={{ ...selStyle, flex: 1 }}>
            <option value="">Todos</option>
            <option value="true">Exitosos</option>
            <option value="false">Fallidos</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={ci}
            onChange={(e) => setCi(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(0)}
            placeholder="Buscar por CI…"
            style={{ ...selStyle, flex: 1 }}
          />
          <button onClick={() => load(0)} style={{ ...selStyle, cursor: "pointer", background: C.accentSub, color: C.accent, fontWeight: 600 }}>
            Buscar
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8, height: 8, borderRadius: "50%",
              background: live ? "#22c55e" : C.muted,
              boxShadow: live ? "0 0 6px #22c55e" : "none",
            }}
          />
          <span>{live ? "En vivo" : "Desconectado"}</span>
          <span style={{ marginLeft: "auto" }}>{total} evento{total === 1 ? "" : "s"}</span>
        </div>
      </Card>

      {/* Pill de nuevos eventos (cuando hay filtros/paginación que impiden prepend) */}
      {pending > 0 && (
        <button
          onClick={() => load(0)}
          style={{ ...selStyle, cursor: "pointer", background: C.accent, color: "#04161a", fontWeight: 700, padding: "10px" }}
        >
          ▲ {pending} evento{pending === 1 ? "" : "s"} nuevo{pending === 1 ? "" : "s"} — actualizar
        </button>
      )}

      {loading && (
        <div style={{ display: "grid", placeItems: "center", padding: 30 }}>
          <Spinner />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div style={{ textAlign: "center", color: C.muted, padding: 30, fontSize: 14 }}>
          Sin eventos para estos filtros.
        </div>
      )}

      {!loading &&
        rows.map((e) => {
          const chip = resultChip(e)
          return (
            <div
              key={e.id}
              style={{
                display: "flex",
                gap: 12,
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 10,
                alignItems: "center",
              }}
            >
              {e.has_image ? (
                <img
                  src={api.eventImageUrl(e.id)}
                  onClick={() => setZoom(e)}
                  style={{
                    width: 58, height: 58, borderRadius: 10, objectFit: "cover",
                    cursor: "pointer", border: `1px solid ${C.border}`, flexShrink: 0,
                  }}
                />
              ) : (
                <div style={{ width: 58, height: 58, borderRadius: 10, background: "var(--bg-tertiary)", display: "grid", placeItems: "center", color: C.muted, flexShrink: 0 }}>—</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>{KIND_LABEL[e.kind] || e.kind}</span>
                  <span style={{ fontSize: 10, color: C.muted, padding: "1px 6px", borderRadius: 6, background: "var(--bg-tertiary)" }}>{e.source || "—"}</span>
                  <span style={{ fontSize: 11, color: chip.color, background: chip.bg, padding: "2px 7px", borderRadius: 7, fontWeight: 600 }}>{chip.text}</span>
                </div>
                <div style={{ fontSize: 14, color: C.text, fontWeight: 600, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {e.name || e.ci || "—"}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  {fmtTs(e.ts)}
                  {e.similarity != null && (
                    <span style={{ marginLeft: 8, color: C.text3 }}>sim {(e.similarity * 100).toFixed(1)}%</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}

      {/* Paginación */}
      {!loading && total > limit && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 2px" }}>
          <button disabled={offset === 0} onClick={() => load(Math.max(0, offset - limit))} style={{ ...selStyle, cursor: offset === 0 ? "default" : "pointer", opacity: offset === 0 ? 0.4 : 1 }}>
            ← Anterior
          </button>
          <span style={{ fontSize: 12, color: C.muted }}>
            {offset + 1}–{Math.min(offset + limit, total)} de {total}
          </span>
          <button disabled={offset + limit >= total} onClick={() => load(offset + limit)} style={{ ...selStyle, cursor: offset + limit >= total ? "default" : "pointer", opacity: offset + limit >= total ? 0.4 : 1 }}>
            Siguiente →
          </button>
        </div>
      )}

      {/* Modal foto */}
      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000,
            display: "grid", placeItems: "center", padding: 20,
          }}
        >
          <div onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
            <img src={api.eventImageUrl(zoom.id)} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 14, border: `1px solid ${C.border}` }} />
            <div style={{ marginTop: 12, color: C.text }}>
              <div style={{ fontWeight: 700 }}>{zoom.name || zoom.ci || "—"}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                {KIND_LABEL[zoom.kind] || zoom.kind} · {fmtTs(zoom.ts)}
                {zoom.similarity != null && ` · sim ${(zoom.similarity * 100).toFixed(1)}%`}
              </div>
            </div>
            <button onClick={() => setZoom(null)} style={{ marginTop: 14, ...selStyle, cursor: "pointer", background: C.accent, color: "#04161a", fontWeight: 700, padding: "10px 24px" }}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
