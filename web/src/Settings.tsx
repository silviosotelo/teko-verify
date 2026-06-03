import { useEffect, useState } from "react"
import { api, getBaseUrl, setBaseUrl, type Health, type Stats } from "./api"
import { Button, C, Card, Field, Spinner } from "./ui"

export function Settings({ active }: { active: boolean }) {
  const [base, setBase] = useState(getBaseUrl())
  const [saved, setSaved] = useState(false)
  const [health, setHealth] = useState<Health | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setErr(null)
    try {
      const [h, s] = await Promise.all([api.health(), api.stats()])
      setHealth(h)
      setStats(s)
    } catch (e) {
      setErr(String((e as Error).message || e))
      setHealth(null)
      setStats(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (active) void refresh()
  }, [active])

  const save = () => {
    setBaseUrl(base)
    setBase(getBaseUrl())
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
    void refresh()
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={{ fontWeight: 700, marginBottom: 12, color: C.text }}>
          Conexión
        </div>
        <Field
          label="Base URL del API (vacío = mismo origen)"
          value={base}
          placeholder="(mismo origen)"
          onChange={(e) => setBase(e.target.value)}
        />
        <Button onClick={save}>{saved ? "Guardado ✓" : "Guardar"}</Button>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 10 }}>
          El umbral de similitud lo fija el servicio v9 (variable{" "}
          <code>V9_SIM_THRESHOLD</code>). Se muestra abajo como solo lectura.
        </div>
      </Card>

      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 700, color: C.text }}>Estado del motor</span>
          <Button
            variant="ghost"
            onClick={refresh}
            style={{ width: "auto", padding: "6px 12px" }}
          >
            {loading ? <Spinner size={16} /> : "Actualizar"}
          </Button>
        </div>

        {err && <div style={{ color: C.error, fontSize: 14 }}>{err}</div>}

        {health && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row k="Estado" v={health.status} ok={health.status === "ok"} />
            <Row k="Motor ONNX" v={health.engine ? "cargado" : "no"} ok={health.engine} />
            <Row k="Puerto" v={String(health.port)} />
            <Row k="Umbral similitud" v={health.sim_threshold.toFixed(2)} />
            <Row
              k="Embeddings en galería"
              v={String(health.gallery_embeddings)}
            />
          </div>
        )}
        {stats && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: `1px solid ${C.border}`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Row k="Personas (CI únicos)" v={String(stats.distinct_ci)} />
            <Row k="Dim. embedding" v={String(stats.embedding_dim)} />
            <Row k="Detector" v={stats.detector} small />
            <Row k="Reconocedor" v={stats.recognizer} small />
            <Row k="Matching" v={stats.matching} small />
          </div>
        )}
      </Card>
    </div>
  )
}

function Row({
  k,
  v,
  ok,
  small,
}: {
  k: string
  v: string
  ok?: boolean
  small?: boolean
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: C.text3, fontSize: 14, flex: "none" }}>{k}</span>
      <span
        style={{
          color: ok === undefined ? C.text2 : ok ? C.accent : C.error,
          fontSize: small ? 12 : 14,
          textAlign: "right",
          fontWeight: 500,
        }}
      >
        {v}
      </span>
    </div>
  )
}
