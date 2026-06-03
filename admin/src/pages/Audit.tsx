import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { AuditEntry } from '../api/types'
import { useTenant } from '../context/TenantContext'
import { EmptyState, ErrorBox, Loading, PageHeader } from '../components/ui'
import { fmtDate } from '../lib/format'

function actorTone(actor: string): string {
  if (actor.startsWith('admin:')) return 'bg-primary-subtle text-primary-deep'
  if (actor.startsWith('tenant:')) return 'bg-blue-100 text-blue-700'
  if (actor.startsWith('subject')) return 'bg-amber-100 text-amber-700'
  return 'bg-gray-100 text-gray-600'
}

export default function AuditPage() {
  const { current, currentId, loading: tLoading } = useTenant()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentId) return
    setLoading(true)
    setError(null)
    api
      .audit(currentId, { limit: 500 })
      .then((r) => setEntries(r.entries))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [currentId])

  if (tLoading) return <Loading />

  return (
    <div>
      <PageHeader
        title="Auditoría"
        subtitle={current ? `Registro de eventos de ${current.name}` : 'Audit log'}
      />
      {error && <ErrorBox message={error} />}
      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : entries.length === 0 ? (
          <EmptyState message="No hay eventos registrados." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Fecha</th>
                  <th className="px-5 py-3 font-semibold">Actor</th>
                  <th className="px-5 py-3 font-semibold">Evento</th>
                  <th className="px-5 py-3 font-semibold">Detalle</th>
                  <th className="px-5 py-3 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                      {fmtDate(e.createdAt)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${actorTone(
                          e.actor
                        )}`}
                      >
                        {e.actor}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs font-medium text-gray-800">
                      {e.event}
                    </td>
                    <td className="px-5 py-3 max-w-md">
                      {e.detail && Object.keys(e.detail).length > 0 ? (
                        <code className="block overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-gray-500">
                          {JSON.stringify(e.detail)}
                        </code>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">
                      {e.ip ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!loading && entries.length > 0 && (
        <div className="mt-3 text-xs text-gray-400">{entries.length} eventos.</div>
      )}
    </div>
  )
}
