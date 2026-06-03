// v9 API client. Same-origin by default (served from the v9 service under
// /v9app), so baseUrl is "" and fetch hits /v9/* directly — no CORS, no proxy.
// The Ajustes screen can override baseUrl for dev (e.g. http://192.168.41.34:4380).

const LS_BASE = "v9.baseUrl"

export function getBaseUrl(): string {
  return localStorage.getItem(LS_BASE) ?? ""
}
export function setBaseUrl(v: string): void {
  localStorage.setItem(LS_BASE, v.replace(/\/+$/, ""))
}

function url(path: string): string {
  return `${getBaseUrl()}${path}`
}

export interface RecognizeResult {
  success: boolean
  ci: string | null
  name: string | null
  similarity: number
  processing_time: number
  error: string | null
}

export interface EnrollResult {
  success: boolean
  ci: string
  name: string
  total: number
}

export interface DetectFace {
  bbox: { x: number; y: number; width: number; height: number }
  landmarks_5: number[][]
  confidence: number
}

export interface Person {
  ci: string
  name: string
  embeddings: number
}

export interface Health {
  status: string
  engine: boolean
  gallery_embeddings: number
  sim_threshold: number
  port: number
}

export interface Stats {
  total_embeddings: number
  distinct_ci: number
  sim_threshold: number
  embedding_dim: number
  detector: string
  recognizer: string
  matching: string
}

export interface EventRow {
  id: number
  ts: string
  kind: string
  ci: string | null
  name: string | null
  similarity: number | null
  success: boolean | null
  source: string | null
  error: string | null
  has_image: boolean
}

export interface EventsPage {
  total: number
  limit: number
  offset: number
  rows: EventRow[]
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data && (data.detail || data.error)) || `HTTP ${res.status}`)
  }
  return data as T
}

export const api = {
  recognize: (image: string) =>
    jsonPost<RecognizeResult>("/v9/recognize", { image }),
  enroll: (ci: string, name: string, image: string) =>
    jsonPost<EnrollResult>("/v9/enroll", { ci, name, image }),
  detect: (image: string) => jsonPost<{ faces: DetectFace[] }>("/v9/detect", { image }),
  async persons(): Promise<{ total: number; persons: Person[] }> {
    const res = await fetch(url("/v9/persons"))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  async deletePerson(ci: string): Promise<{ success: boolean; ci: string; deleted: number }> {
    const res = await fetch(url(`/v9/person/${encodeURIComponent(ci)}`), {
      method: "DELETE",
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  async health(): Promise<Health> {
    const res = await fetch(url("/v9/health"))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  async stats(): Promise<Stats> {
    const res = await fetch(url("/v9/stats"))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  async events(params: {
    kind?: string
    ci?: string
    success?: string
    limit?: number
    offset?: number
  }): Promise<EventsPage> {
    const q = new URLSearchParams()
    if (params.kind) q.set("kind", params.kind)
    if (params.ci) q.set("ci", params.ci)
    if (params.success) q.set("success", params.success)
    q.set("limit", String(params.limit ?? 30))
    q.set("offset", String(params.offset ?? 0))
    const res = await fetch(url(`/v9/events?${q.toString()}`))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  },
  eventImageUrl(id: number): string {
    return url(`/v9/events/${id}/image`)
  },
  eventsStreamUrl(): string {
    return url(`/v9/events/stream`)
  },
}
