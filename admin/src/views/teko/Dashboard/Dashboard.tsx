import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Chart from '@/components/shared/Chart'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtPct } from '@/teko/format'
import type { MetricsResponse, SessionState } from '@/teko/types'

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

const STATE_ORDER: SessionState[] = [
    'created',
    'capturing',
    'processing',
    'verified',
    'rejected',
    'needs_recapture',
    'expired',
    'error',
]

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
                className={`mt-2 text-3xl font-bold ${
                    accent ? 'text-primary' : 'heading-text'
                }`}
            >
                {value}
            </div>
            {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
        </Card>
    )
}

const DashboardView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .metrics(currentId)
            .then(setMetrics)
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId])

    if (tLoading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    const byState = metrics?.byState ?? ({} as Record<string, number>)
    const categories = STATE_ORDER.map((st) => STATE_LABEL[st])
    const series = STATE_ORDER.map((st) => byState[st] ?? 0)

    const verified = byState.verified ?? 0
    const rejected = byState.rejected ?? 0
    const pending =
        (byState.created ?? 0) +
        (byState.capturing ?? 0) +
        (byState.processing ?? 0) +
        (byState.needs_recapture ?? 0)

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Dashboard</h3>
                <p className="text-gray-500">
                    {current
                        ? `Métricas de ${current.name}`
                        : 'Resumen del tenant'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {loading ? (
                <div className="flex h-40 items-center justify-center">
                    <Spinner size={40} />
                </div>
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
                        <Stat
                            label="Verificadas"
                            value={String(verified)}
                            hint="LoA acreditado"
                        />
                        <Stat
                            label="Rechazadas / Pendientes"
                            value={`${rejected} / ${pending}`}
                            hint="rechazos · en curso"
                        />
                    </div>

                    <Card className="mt-6">
                        <div className="mb-4 flex items-center justify-between">
                            <h5>Sesiones por estado</h5>
                            <span className="text-xs text-gray-400">
                                {metrics?.sessionsTotal ?? 0} sesiones
                            </span>
                        </div>
                        <Chart
                            type="bar"
                            height={320}
                            series={[{ name: 'Sesiones', data: series }]}
                            customOptions={{
                                xaxis: { categories },
                                plotOptions: {
                                    bar: {
                                        borderRadius: 6,
                                        columnWidth: '45%',
                                    },
                                },
                                dataLabels: { enabled: false },
                            }}
                        />
                    </Card>
                </>
            )}
        </div>
    )
}

export default DashboardView
