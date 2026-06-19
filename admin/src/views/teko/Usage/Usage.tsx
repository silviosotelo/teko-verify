import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Table from '@/components/ui/Table'
import Progress from '@/components/ui/Progress'
import Chart from '@/components/shared/Chart'
import AbbreviateNumber from '@/components/shared/AbbreviateNumber'
import GrowShrinkValue from '@/components/shared/GrowShrinkValue'
import IconText from '@/components/shared/IconText'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { UsageResponse, SessionState } from '@/teko/types'
import { motion } from 'framer-motion'
import {
    PiChartBar,
    PiCheckCircle,
    PiXCircle,
    
    
    
    PiArrowRight,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

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

const QUICK_RANGES = [
    { label: 'Últimos 7 días', from: '7d' },
    { label: 'Últimos 30 días', from: '30d' },
    { label: 'Últimos 90 días', from: '90d' },
    { label: 'Este año', from: '1y' },
    { label: 'Todo el tiempo', from: '' },
]

function parseRange(days: string): { from?: string; to?: string } {
    if (!days) return {}
    const n = parseInt(days)
    if (isNaN(n)) return {}
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - n)
    return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
    }
}

const UsageView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [data, setData] = useState<UsageResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [quickRange, setQuickRange] = useState('')

    async function load() {
        if (!currentId) return
        setLoading(true)
        setError(null)
        try {
            const res = await tekoApi.usage(currentId, {
                from: from || undefined,
                to: to || undefined,
            })
            setData(res)
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

    const applyQuickRange = (range: string) => {
        setQuickRange(range)
        const parsed = parseRange(range)
        setFrom(parsed.from || '')
        setTo(parsed.to || '')
    }

    if (tLoading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Uso y Métricas</h3>
                <p className="text-gray-500">
                    {current
                        ? `Verificaciones por app de ${current.name}`
                        : 'Verificaciones por app'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {/* Quick Range + Custom Date */}
            <Card className="mb-6">
                <div className="mb-4">
                    <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
                        Rápido
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {QUICK_RANGES.map((r) => (
                            <Button
                                key={r.from || 'all'}
                                variant={
                                    quickRange === r.from ? 'solid' : 'outline'
                                }
                                size="sm"
                                onClick={() => applyQuickRange(r.from)}
                            >
                                {r.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[150px]">
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Desde (ISO)
                        </label>
                        <Input
                            type="date"
                            placeholder="2026-01-01"
                            value={from}
                            onChange={(e) => {
                                setFrom(e.target.value)
                                setQuickRange('')
                            }}
                        />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Hasta (ISO)
                        </label>
                        <Input
                            type="date"
                            placeholder="2026-12-31"
                            value={to}
                            onChange={(e) => {
                                setTo(e.target.value)
                                setQuickRange('')
                            }}
                        />
                    </div>
                    <Button variant="solid" onClick={load} disabled={!currentId}>
                        Aplicar
                    </Button>
                </div>
            </Card>

            {loading ? (
                <div className="flex h-40 items-center justify-center">
                    <Spinner size={40} />
                </div>
            ) : data ? (
                <>
                    {/* Summary Cards */}
                    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <Card>
                                <IconText
                                    icon={<PiChartBar />}
                                    text="Total Sesiones"
                                    iconClassName="text-primary"
                                />
                                <div className="mt-2 text-3xl font-bold heading-text">
                                    <AbbreviateNumber value={data.total} />
                                </div>
                            </Card>
                        </motion.div>
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                        >
                            <Card>
                                <IconText
                                    icon={<PiCheckCircle />}
                                    text="Verificadas"
                                    iconClassName="text-success"
                                />
                                <div className="mt-2 text-3xl font-bold text-success">
                                    <AbbreviateNumber value={data.verified} />
                                </div>
                                {data.total > 0 && (
                                    <Progress
                                        value={(data.verified / data.total) * 100}
                                        color="success"
                                        showLabel={false}
                                        className="h-1 mt-2"
                                    />
                                )}
                            </Card>
                        </motion.div>
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                        >
                            <Card>
                                <IconText
                                    icon={<PiXCircle />}
                                    text="Rechazadas"
                                    iconClassName="text-danger"
                                />
                                <div className="mt-2 text-3xl font-bold text-danger">
                                    <AbbreviateNumber value={data.total - data.verified} />
                                </div>
                            </Card>
                        </motion.div>
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                        >
                            <Card>
                                <IconText
                                    icon={<span className="text-warning">📦</span>}
                                    text="Apps Activas"
                                    iconClassName="text-warning"
                                />
                                <div className="mt-2 text-3xl font-bold heading-text">
                                    {data.apps.length}
                                </div>
                            </Card>
                        </motion.div>
                    </div>

                    {/* Apps Bar Chart */}
                    {data.apps.length > 0 && (
                        <Card className="mb-6">
                            <h5 className="font-semibold mb-4">
                                Sesiones por Aplicación
                            </h5>
                            <Chart
                                type="bar"
                                height={280}
                                series={[
                                    {
                                        name: 'Total',
                                        data: data.apps.map((a) => a.total),
                                    },
                                    {
                                        name: 'Verificadas',
                                        data: data.apps.map((a) => a.verified),
                                    },
                                ]}
                                customOptions={{
                                    xaxis: {
                                        categories: data.apps.map(
                                            (a) => a.appName,
                                        ),
                                        labels: {
                                            rotate: -45,
                                            rotateAlways: true,
                                            style: { fontSize: '11px' },
                                        },
                                    },
                                    plotOptions: {
                                        bar: {
                                            borderRadius: 4,
                                            columnWidth: '60%',
                                        },
                                    },
                                    dataLabels: { enabled: false },
                                    colors: ['#3b82f6', '#10b981'],
                                    legend: { position: 'top' },
                                }}
                            />
                        </Card>
                    )}

                    {/* Per-App Table */}
                    <Card bodyClass="px-0 py-0">
                        {data.apps.length === 0 ? (
                            <div className="py-16 text-center text-sm text-gray-400">
                                Sin verificaciones en el período.
                            </div>
                        ) : (
                            <>
                                <Table>
                                    <THead>
                                        <Tr>
                                            <Th>App</Th>
                                            <Th>Total</Th>
                                            <Th>Verificadas</Th>
                                            <Th>Rechazadas</Th>
                                            <Th>Tasa Aprob.</Th>
                                            <Th>Distribución</Th>
                                        </Tr>
                                    </THead>
                                    <TBody>
                                        {data.apps.map((a) => {
                                            const approvalRate =
                                                a.total > 0
                                                    ? (a.verified / a.total) * 100
                                                    : 0
                                            return (
                                                <Tr key={a.appId ?? '_none'}>
                                                    <Td className="font-medium heading-text">
                                                        {a.appName}
                                                    </Td>
                                                    <Td>{a.total}</Td>
                                                    <Td className="text-success font-medium">
                                                        {a.verified}
                                                    </Td>
                                                    <Td className="text-gray-500">
                                                        {a.rejected}
                                                    </Td>
                                                    <Td>
                                                        <div className="flex items-center gap-2">
                                                            <Progress
                                                                value={approvalRate}
                                                                color={
                                                                    approvalRate > 70
                                                                        ? 'success'
                                                                        : approvalRate > 40
                                                                          ? 'warning'
                                                                          : 'danger'
                                                                }
                                                                showLabel={false}
                                                                className="h-1.5 w-16"
                                                            />
                                                            <span className="text-xs font-medium">
                                                                {Math.round(approvalRate)}%
                                                            </span>
                                                        </div>
                                                    </Td>
                                                    <Td>
                                                        <div className="flex flex-wrap gap-1">
                                                            {Object.entries(
                                                                a.byState,
                                                            ).map(([s, n]) => (
                                                                <Badge
                                                                    key={s}
                                                                    variant="outline"
                                                                    color={
                                                                        s === 'verified'
                                                                            ? 'success'
                                                                            : s === 'rejected' || s === 'error'
                                                                              ? 'danger'
                                                                              : s === 'needs_recapture'
                                                                                ? 'warning'
                                                                                : 'gray'
                                                                    }
                                                                    className="text-[10px]"
                                                                >
                                                                    {STATE_LABEL[s] || s}: {n}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    </Td>
                                                </Tr>
                                            )
                                        })}
                                    </TBody>
                                </Table>
                            </>
                        )}
                    </Card>
                </>
            ) : null}
        </div>
    )
}

export default UsageView
