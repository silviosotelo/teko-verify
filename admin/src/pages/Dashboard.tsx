import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { MetricsResponse } from '../api/types'
import { useTenant } from '../context/TenantContext'
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui'
import { fmtPct } from '../lib/format'

const STATE_LABEL: Record<string, string> = {
  created: 'Creadas',
  capturing: 'Capturando',
  processing: 'Procesando',
  verified: 'Verificadas',
  rejected: 'Rechazadas',
  needs_recapture: 'Recaptura',
  expired: 'Expiradas',
  error: 'Error',
}

const STATE_COLOR: Record<string, string> = {
  verified: '#16a34a',
  rejected: '#ef4444',
  needs_recapture: '#f59e0b',
  error: '#e11d48',
  expired: '#9ca3af',
  processing: '#3b82f6',
  capturing: '#6366f1',
  created: '#94a3b8',
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <Card>
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div
        className={`mt-2 text-3xl font-bold tracking-tight ${
          accent ? 'text-primary' : 'text-gray-900'
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
    </Card>
  )
}

export default function DashboardPage() {
  const { current, currentId, loading: tLoading } = useTenant()
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentId) return
    setLoading(true)
    setError(null)
    api
      .metrics(currentId)
      .then(setMetrics)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [currentId])

  if (tLoading) return <Loading />

  const byState = metrics?.byState ?? ({} as Record<string, number>)
  const chartData = Object.keys(STATE_LABEL).map((st) => ({
    state: st,
    label: STATE_LABEL[st],
    count: byState[st as keyof typeof byState] ?? 0,
    color: STATE_COLOR[st],
  }))

  const verified = byState.verified ?? 0
  const rejected = byState.rejected ?? 0
  const pending =
    (byState.created ?? 0) +
    (byState.capturing ?? 0) +
    (byState.processing ?? 0) +
    (byState.needs_recapture ?? 0)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={current ? `Métricas de ${current.name}` : 'Resumen del tenant'}
      />
      {error && <ErrorBox message={error} />}
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Sesiones totales"
              value={String(metrics?.sessionsTotal ?? 0)}
              hint="Histórico del tenant"
            />
            <Stat
              label="Tasa de aprobación"
              value={fmtPct(metrics?.approvalRate)}
              hint="verified / (verified + rejected)"
              accent
            />
            <Stat label="Verificadas" value={String(verified)} hint="LoA acreditado" />
            <Stat
              label="Rechazadas / Pendientes"
              value={`${rejected} / ${pending}`}
              hint="rechazo vs en curso"
            />
          </div>

          <Card className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Sesiones por estado
              </h2>
              <span className="text-xs text-gray-400">
                {metrics?.sessionsTotal ?? 0} sesiones
              </span>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f2" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#f0fdf4' }}
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid #e5e7eb',
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
                    {chartData.map((d) => (
                      <Cell key={d.state} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
