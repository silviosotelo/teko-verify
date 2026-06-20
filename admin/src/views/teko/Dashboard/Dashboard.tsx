import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Tag from '@/components/ui/Tag'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Progress from '@/components/ui/Progress'
import Chart from '@/components/shared/Chart'
import IconText from '@/components/shared/IconText'
import AbbreviateNumber from '@/components/shared/AbbreviateNumber'
import GrowShrinkValue from '@/components/shared/GrowShrinkValue'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtPct } from '@/teko/format'
import type { MetricsResponse, SessionState, SessionRow } from '@/teko/types'
import { motion } from 'framer-motion'
import {
    PiCheckCircle,
    PiXCircle,
    PiClockClockwise,
    PiUserCircle,
    
    
    PiWarningCircle,
    PiFlashlight,
    PiHourglassHigh,
    PiEye,
    PiArrowRight,
} from 'react-icons/pi'
import { Link } from 'react-router'

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

const STATE_COLORS: Record<string, string> = {
    created: 'blue',
    capturing: 'cyan',
    processing: 'yellow',
    verified: 'success',
    rejected: 'danger',
    needs_recapture: 'orange',
    expired: 'gray',
    error: 'danger',
}

const STATE_ICONS: Record<string, React.ReactNode> = {
    created: <PiUserCircle />,
    capturing: <PiFlashlight />,
    processing: <PiHourglassHigh />,
    verified: <PiCheckCircle />,
    rejected: <PiXCircle />,
    needs_recapture: <PiArrowRight />,
    expired: <PiClockClockwise />,
    error: <PiWarningCircle />,
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

function StatCard({
    icon,
    label,
    value,
    hint,
    accent,
    trend,
    color,
}: {
    icon: React.ReactNode
    label: string
    value: string
    hint?: string
    accent?: boolean
    trend?: { value: number; positive: boolean }
    color?: string
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <Card className="h-full">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            {icon}
                            <span>{label}</span>
                        </div>
                        <div
                            className={`mt-2 text-3xl font-bold ${
                                accent ? 'text-primary' : 'heading-text'
                            }`}
                        >
                            {value}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                            {hint && (
                                <span className="text-xs text-gray-400">
                                    {hint}
                                </span>
                            )}
                            {trend && (
                                <GrowShrinkValue
                                    value={trend.value}
                                    positive={trend.positive}
                                    compact
                                />
                            )}
                        </div>
                    </div>
                    {color && (
                        <div
                            className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${
                                color === 'success'
                                    ? 'bg-success/10 text-success'
                                    : color === 'danger'
                                      ? 'bg-danger/10 text-danger'
                                      : color === 'warning'
                                        ? 'bg-warning/10 text-warning'
                                        : 'bg-primary/10 text-primary'
                            }`}
                        >
                            {icon}
                        </div>
                    )}
                </div>
            </Card>
        </motion.div>
    )
}

const DashboardView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
    const [recentSessions, setRecentSessions] = useState<SessionRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        Promise.all([
            tekoApi.metrics(currentId),
            tekoApi.listSessions(currentId, { limit: 5 }),
        ])
            .then(([m, s]) => {
                setMetrics(m)
                setRecentSessions(s.sessions ?? [])
            })
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
    const totalSeries = series.reduce((a, b) => a + b, 0)

    const verified = byState.verified ?? 0
    const rejected = byState.rejected ?? 0
    const pending =
        (byState.created ?? 0) +
        (byState.capturing ?? 0) +
        (byState.processing ?? 0) +
        (byState.needs_recapture ?? 0)
    const approvalRate = metrics?.approvalRate ?? 0

    const latencyModules = metrics?.latencyByModule ?? {}
    const latencyEntries = Object.entries(latencyModules).sort(
        (a, b) => b[1] - a[1],
    )

    return (
        <div>
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h3 className="mb-1">Dashboard</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Métricas en tiempo real de ${current.name}`
                            : 'Resumen general del sistema'}
                    </p>
                </div>
                {current && (
                    <Link to="/sessions">
                        <Button variant="ghost" size="sm" className="gap-1">
                            Ver todas las sesiones
                            <PiArrowRight />
                        </Button>
                    </Link>
                )}
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
                    {/* Stat Cards */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                        <StatCard
                            icon={<PiUserCircle />}
                            label="Sesiones Totales"
                            value={String(
                                metrics?.sessionsTotal ?? 0,
                            )}
                            hint="Histórico completo"
                            color="primary"
                        />
                        <StatCard
                            
                            label="Tasa de Aprobación"
                            value={fmtPct(approvalRate)}
                            hint={`${verified} verificadas`}
                            trend={{
                                value: Math.round(
                                    approvalRate * 100,
                                ),
                                positive: approvalRate > 0.5,
                            }}
                            accent
                            color="success"
                        />
                        <StatCard
                            icon={<PiCheckCircle />}
                            label="Verificadas"
                            value={String(verified)}
                            hint="LoA acreditado"
                            trend={{
                                value: verified,
                                positive: true,
                            }}
                            color="success"
                        />
                        <StatCard
                            icon={<PiClockClockwise />}
                            label="Pendientes"
                            value={String(pending)}
                            hint={`${rejected} rechazadas`}
                            trend={{
                                value: pending,
                                positive: pending === 0,
                            }}
                            color="warning"
                        />
                    </div>

                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                        {/* Sessions by State */}
                        <Card className="lg:col-span-2">
                            <div className="mb-4 flex items-center justify-between">
                                <h5 className="font-semibold">
                                    Sesiones por Estado
                                </h5>
                                <span className="text-xs text-gray-400">
                                    {totalSeries} sesiones en total
                                </span>
                            </div>
                            <Chart
                                type="bar"
                                height={300}
                                series={[
                                    {
                                        name: 'Sesiones',
                                        data: series,
                                    },
                                ]}
                                customOptions={{
                                    xaxis: {
                                        categories,
                                        labels: {
                                            style: {
                                                fontSize: '11px',
                                            },
                                        },
                                    },
                                    colors: STATE_ORDER.map(
                                        () => 'var(--color-primary)',
                                    ),
                                    plotOptions: {
                                        bar: {
                                            borderRadius: 6,
                                            columnWidth: '50%',
                                        },
                                    },
                                    dataLabels: { enabled: false },
                                    tooltip: {
                                        y: {
                                            formatter: (val: number) =>
                                                `${val} sesiones`,
                                        },
                                    },
                                }}
                            />
                        </Card>

                        {/* State Distribution */}
                        <Card>
                            <h5 className="font-semibold mb-4">
                                Distribución
                            </h5>
                            <div className="space-y-3">
                                {STATE_ORDER.map((st) => {
                                    const count = byState[st] ?? 0
                                    const pct =
                                        totalSeries > 0
                                            ? (count / totalSeries) * 100
                                            : 0
                                    return (
                                        <div key={st}>
                                            <div className="flex items-center justify-between text-sm mb-1">
                                                <IconText
                                                    icon={STATE_ICONS[st]}
                                                    text={STATE_LABEL[st]}
                                                    iconClassName={`w-5 h-5 ${
                                                        STATE_COLORS[st] ===
                                                        'success'
                                                            ? 'text-success'
                                                            : STATE_COLORS[st] ===
                                                                'danger'
                                                              ? 'text-danger'
                                                              : STATE_COLORS[st] ===
                                                                  'warning' ||
                                                                STATE_COLORS[st] ===
                                                                    'orange'
                                                                ? 'text-warning'
                                                                : 'text-primary'
                                                    }`}
                                                />
                                                <span className="text-xs text-gray-400">
                                                    {count} ({fmtPct(pct / 100)})
                                                </span>
                                            </div>
                                            <Progress
                                                value={pct}
                                                color={
                                                    STATE_COLORS[st] ===
                                                    'success'
                                                        ? 'success'
                                                        : STATE_COLORS[st] ===
                                                            'danger'
                                                          ? 'danger'
                                                          : STATE_COLORS[
                                                                st
                                                            ] ===
                                                              'warning' ||
                                                            STATE_COLORS[st] ===
                                                                'orange'
                                                          ? 'warning'
                                                          : 'primary'
                                                }
                                                showLabel={false}
                                                className="h-1.5"
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                        </Card>
                    </div>

                    {/* Latency + Recent */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Latency */}
                        <Card>
                            <h5 className="font-semibold mb-4">
                                Latencia por Módulo
                            </h5>
                            {latencyEntries.length > 0 ? (
                                <div className="space-y-3">
                                    {latencyEntries.map(
                                        ([module, ms]) => (
                                            <div
                                                key={module}
                                                className="flex items-center justify-between"
                                            >
                                                <span className="text-sm font-medium capitalize">
                                                    {module.replace(/_/g, ' ')}
                                                </span>
                                                <div className="flex items-center gap-3 flex-1 mx-4">
                                                    <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                                                        <div
                                                            className="bg-primary h-2 rounded-full transition-all"
                                                            style={{
                                                                width: `${Math.min(
                                                                    (ms / 3000) *
                                                                        100,
                                                                    100,
                                                                )}%`,
                                                            }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-sm text-gray-500 w-20 text-right">
                                                        {Math.round(ms)}ms
                                                    </span>
                                                </div>
                                            </div>
                                        ),
                                    )}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400 text-center py-4">
                                    Sin datos de latencia disponibles
                                </p>
                            )}
                        </Card>

                        {/* Recent Sessions */}
                        <Card>
                            <div className="flex items-center justify-between mb-4">
                                <h5 className="font-semibold">
                                    Sesiones Recientes
                                </h5>
                                <Link to="/sessions">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="gap-1 text-xs"
                                    >
                                        Ver todas
                                        <PiArrowRight />
                                    </Button>
                                </Link>
                            </div>
                            {recentSessions.length > 0 ? (
                                <div className="space-y-2">
                                    {recentSessions.map((session) => (
                                        <Link
                                            key={session.id}
                                            to={`/sessions/${session.id}`}
                                            className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                                        >
                                            <div className="flex items-center gap-3">
                                                <Badge
                                                    variant="solid"
                                                    color={
                                                        session.state ===
                                                        'verified'
                                                            ? 'success'
                                                            : session.state ===
                                                              'rejected'
                                                              ? 'danger'
                                                              : session.state ===
                                                                'needs_recapture'
                                                                ? 'warning'
                                                                : 'gray'
                                                    }
                                                >
                                                    {STATE_LABEL[session.state] || session.state}
                                                </Badge>
                                                <div>
                                                    <div className="text-sm font-medium">
                                                        {session.externalRef || session.id.slice(0, 8)}
                                                    </div>
                                                    <div className="text-xs text-gray-400">
                                                        {new Date(
                                                            session.createdAt,
                                                        ).toLocaleDateString(
                                                            'es-PY',
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                {session.result?.loa && (
                                                    <Tag className="border-0 bg-primary/10 text-xs font-bold text-primary">
                                                        {session.result.loa}
                                                    </Tag>
                                                )}
                                                <div className="text-xs text-gray-400 mt-1">
                                                    {session.result?.decision || '—'}
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-400 text-center py-4">
                                    No hay sesiones recientes
                                </p>
                            )}
                        </Card>
                    </div>
                </>
            )}
        </div>
    )
}

export default DashboardView
