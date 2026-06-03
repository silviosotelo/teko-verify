import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ApiKey, CreateApiKeyResponse } from '../api/types'
import { useTenant } from '../context/TenantContext'
import {
  Badge,
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
} from '../components/ui'
import { fmtDate } from '../lib/format'

export default function ApiKeysPage() {
  const { current, currentId, loading: tLoading } = useTenant()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreateApiKeyResponse | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    if (!currentId) return
    setLoading(true)
    setError(null)
    try {
      const { apiKeys } = await api.listApiKeys(currentId)
      setKeys(apiKeys)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  async function createKey(e: React.FormEvent) {
    e.preventDefault()
    if (!currentId) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.createApiKey(currentId, { label: label || 'default' })
      setCreated(res)
      setLabel('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(keyId: string) {
    if (!currentId) return
    if (!confirm('¿Revocar esta API key? La acción es irreversible.')) return
    try {
      await api.revokeApiKey(currentId, keyId)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (tLoading) return <Loading />

  return (
    <div>
      <PageHeader
        title="API Keys"
        subtitle={current ? `Claves de acceso de ${current.name}` : 'Claves del tenant'}
      />
      {error && <ErrorBox message={error} />}

      {/* Secreto recién creado — visible UNA sola vez */}
      {created && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-green-800">
                API key creada — copiala ahora
              </div>
              <div className="mt-1 text-xs text-green-700">
                Este secreto NO se vuelve a mostrar. Guardalo en un lugar seguro.
              </div>
            </div>
            <button
              onClick={() => setCreated(null)}
              className="text-green-600 hover:text-green-800"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-green-300 bg-white px-3 py-2 font-mono text-sm text-gray-800">
              {created.apiKey}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(created.apiKey)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="btn-primary text-sm"
            >
              {copied ? 'Copiado ✓' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {/* Crear */}
      <Card className="mb-6">
        <form onSubmit={createKey} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Etiqueta de la nueva key</label>
            <input
              className="input"
              placeholder="ej: backend-produccion"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy || !currentId} className="btn-primary text-sm">
            {busy ? 'Generando…' : 'Generar API key'}
          </button>
        </form>
      </Card>

      {/* Listado */}
      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : keys.length === 0 ? (
          <EmptyState message="No hay API keys para este tenant." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Etiqueta</th>
                  <th className="px-5 py-3 font-semibold">Prefijo</th>
                  <th className="px-5 py-3 font-semibold">Scopes</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">Último uso</th>
                  <th className="px-5 py-3 font-semibold">Creada</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{k.label}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      {k.prefix}…
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <span
                            key={s}
                            className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={k.status === 'active' ? 'green' : 'red'}>
                        {k.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(k.lastUsedAt)}</td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(k.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      {k.status === 'active' && (
                        <button
                          onClick={() => revoke(k.id)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700"
                        >
                          Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
