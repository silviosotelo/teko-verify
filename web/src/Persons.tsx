import { useCallback, useEffect, useState } from "react"
import { api, type Person } from "./api"
import { Button, C, Card, Spinner } from "./ui"

export function Persons({ active }: { active: boolean }) {
  const [persons, setPersons] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.persons()
      setPersons(r.persons)
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) void load()
  }, [active, load])

  const remove = async (ci: string) => {
    if (!confirm(`¿Borrar a CI ${ci} y todos sus embeddings?`)) return
    setDeleting(ci)
    try {
      await api.deletePerson(ci)
      setPersons((p) => p.filter((x) => x.ci !== ci))
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setDeleting(null)
    }
  }

  const shown = persons.filter(
    (p) =>
      p.ci.toLowerCase().includes(filter.toLowerCase()) ||
      (p.name || "").toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          placeholder="Buscar CI o nombre…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg-tertiary)",
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "10px 13px",
            color: C.text,
            fontSize: 15,
            outline: "none",
          }}
        />
        <Button variant="ghost" onClick={load} style={{ width: 54, flex: "none" }}>
          ⟳
        </Button>
      </div>

      <div style={{ color: C.text3, fontSize: 13 }}>
        {persons.length} persona(s) · {persons.reduce((a, p) => a + p.embeddings, 0)}{" "}
        embedding(s)
      </div>

      {loading && (
        <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
          <Spinner size={26} />
        </div>
      )}
      {err && (
        <Card style={{ borderColor: "rgba(239,68,68,0.3)", color: C.error }}>{err}</Card>
      )}

      {!loading &&
        shown.map((p) => (
          <Card
            key={p.ci}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: 14,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "var(--accent-subtle)",
                color: C.accent,
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                flex: "none",
              }}
            >
              {(p.name || p.ci).trim().charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  color: C.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.name || "(sin nombre)"}
              </div>
              <div style={{ color: C.text3, fontSize: 13 }}>
                CI {p.ci} · {p.embeddings} emb.
              </div>
            </div>
            <Button
              variant="danger"
              onClick={() => remove(p.ci)}
              disabled={deleting === p.ci}
              style={{ width: "auto", flex: "none", padding: "8px 14px" }}
            >
              {deleting === p.ci ? <Spinner size={16} /> : "Borrar"}
            </Button>
          </Card>
        ))}

      {!loading && shown.length === 0 && !err && (
        <Card style={{ textAlign: "center", color: C.muted }}>
          {persons.length === 0 ? "Galería vacía." : "Sin resultados."}
        </Card>
      )}
    </div>
  )
}
