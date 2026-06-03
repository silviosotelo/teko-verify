import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { SessionRow, SessionState } from '../api/types'
import { useTenant } from '../context/TenantContext'
import {
  EmptyState,
  ErrorBox,
  Loading,
  LoaBadge,
  PageHeader,
  StateBadge,
} from '../components/ui'
import { fmtDate } from '../lib/format'

const STATES: SessionState[] = [
  'created',
  'capturing',
  'processing',
  'verified',
  'rejected',
  'needs_recapture',
  'expired',
  'error',
]

export default function SessionsPage() {
  const navigate = useNavigate()
  const { currentId, loading: tLoading } = useTenant()
  const [rows, setRows] = useState<SessionRow[]>([])
  const [total, setTotal] = useState(0)
  const [stateFilter, setStateFilter] = useState<SessionState | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentId) return
    setLoading(true)
    setError(null)
    api
      .listSessions(currentId, {
        state: stateFilter || undefined,
        limit: 100,
      })
      .then((r) => {
        setRows(r.sessions)
        setTotal(r.total)
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [currentId, stateFilter])

  if (tLoading) return <Loading />

  return (
    <div>
      <PageHeader
        title="Sesiones"
        subtitle="Verificaciones de identidad del tenant"
        actions={
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as SessionState | '')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Todos los estados</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        }
      />
      {error && <ErrorBox message={error} />}
      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState message="No hay sesiones para mostrar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">LoA</th>
                  <th className="px-5 py-3 font-semibold">Ref. externa</th>
                  <th className="px-5 py-3 font-semibold">Creada</th>
                  <th className="px-5 py-3 font-semibold">Completada</th>
                  <th className="px-5 py-3 font-semibold">Sesión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/sessions/${s.id}`)}
                    className="cursor-pointer transition hover:bg-primary-50"
                  >
                    <td className="px-5 py-3">
                      <StateBadge state={s.state} />
                    </td>
                    <td className="px-5 py-3">
                      <LoaBadge loa={s.result?.loa ?? s.assuranceRequired} />
                    </td>
                    <td className="px-5 py-3 text-gray-700">
                      {s.externalRef || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(s.createdAt)}</td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(s.completedAt)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-400">
                      {s.id.slice(0, 8)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!loading && rows.length > 0 && (
        <div className="mt-3 text-xs text-gray-400">
          Mostrando {rows.length} de {total} sesiones.
        </div>
      )}
    </div>
  )
}
