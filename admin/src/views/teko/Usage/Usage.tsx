import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Input from '@/components/ui/Input'
import Table from '@/components/ui/Table'
import Progress from '@/components/ui/Progress'
import Chart from '@/components/shared/Chart'
import AbbreviateNumber from '@/components/shared/AbbreviateNumber'
import IconText from '@/components/shared/IconText'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtPct } from '@/teko/format'
import type { UsageResponse } from '@/teko/types'
import { motion } from 'framer-motion'
import { PiChartBar, PiCheckCircle, PiXCircle, PiClock, PiTrendDown, PiTrendUp, PiTimer } from 'react-icons/pi'

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
    { label: 'Todo', from: '' },
]

function parseRange(days: string): { from?: string; to?: string } {
    if (!days) return {}
    const n = parseInt(days)
    if (isNaN(n)) return {}
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - n)
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

const UsageView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [data, setData] = useState<UsageResponse | null>(null)
    const [analytics, setAnalytics] = useState<{
        daily: Array<{ date: string; created: number; completed: number; approved: number; declined: number; avgDuration: number }>
        latencyByModule: Record<string, { avg: number; p50: number; p95: number }>
        approvalRate: number
        totalSessions: number
    } | null>(null)
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
            const params = {
                from: from || undefined,
                to: to || undefined,
            }
            const [res, anal] = await Promise.all([
                tekoApi.usage(currentId, params),
                tekoApi.analytics(currentId, params).catch(() => null),
            ])
            setData(res)
            setAnalytics(anal)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [currentId])

    const applyQuickRange = (range: string) => {
        setQuickRange(range)
        const parsed = parseRange(range)
        setFrom(parsed.from || '')
        setTo(parsed.to || '')
    }

    if (tLoading) return <div className="flex h-40 items-center justify-center"><Spinner size={40} /></div>

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Uso y Métricas</h3>
                <p className="text-gray-500">
                    {current ? `Verificaciones y analíticas de ${current.name}` : 'Métricas del sistema'}
                </p>
            </div>

            {error && <Alert showIcon className="mb-4" type="danger">{error}</Alert>}

            <Card className="mb-6">
                <div className="mb-4">
                    <label className="mb-2 block text-sm font-medium">Rango rápido</label>
                    <div className="flex flex-wrap gap-2">
                        {QUICK_RANGES.map((r) => (
                            <Button key={r.from || 'all'} variant={quickRange === r.from ? 'solid' : 'outline'} size="sm" onClick={() => applyQuickRange(r.from)}>
                                {r.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[150px]">
                        <label className="mb-1 block text-sm font-medium">Desde</label>
                        <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setQuickRange('') }} />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                        <label className="mb-1 block text-sm font-medium">Hasta</label>
                        <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setQuickRange('') }} />
                    </div>
                    <Button variant="solid" onClick={load} disabled={!currentId}>Aplicar</Button>
                </div>
            </Card>

            {loading ? (
                <div className="flex h-40 items-center justify-center"><Spinner size={40} /></div>
            ) : data ? (
                <>
                    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                            <Card><IconText icon={<PiChartBar />} text="Total Sesiones" iconClassName="text-primary" /><div className="mt-2 text-3xl font-bold"><AbbreviateNumber value={analytics?.totalSessions ?? data.total} /></div></Card>
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                            <Card><IconText icon={<PiCheckCircle />} text="Verificadas" iconClassName="text-success" /><div className="mt-2 text-3xl font-bold text-success"><AbbreviateNumber value={data.verified} /></div>{data.total > 0 && <Progress value={(data.verified / data.total) * 100} color="success" showLabel={false} className="h-1 mt-2" />}</Card>
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                            <Card><IconText icon={<PiXCircle />} text="Rechazadas" iconClassName="text-danger" /><div className="mt-2 text-3xl font-bold text-danger"><AbbreviateNumber value={data.total - data.verified} /></div></Card>
                        </motion.div>
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                            <Card><IconText icon={<PiTimer />} text="Tasa Aprobación" iconClassName="text-primary" /><div className="mt-2 text-3xl font-bold">{fmtPct(analytics?.approvalRate ?? (data.total > 0 ? data.verified / data.total : 0))}</div></Card>
                        </motion.div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                        {analytics?.daily && analytics.daily.length > 0 && (
                            <Card>
                                <h5 className="font-semibold mb-4">Tendencia Diaria</h5>
                                <Chart
                                    type="line"
                                    height={280}
                                    series={[
                                        { name: 'Creadas', data: analytics.daily.map(d => d.created) },
                                        { name: 'Aprobadas', data: analytics.daily.map(d => d.approved) },
                                        { name: 'Rechazadas', data: analytics.daily.map(d => d.declined) },
                                    ]}
                                    customOptions={{
                                        xaxis: { categories: analytics.daily.map(d => d.date.slice(5)), labels: { style: { fontSize: '10px' }, rotate: -45 } },
                                        colors: ['#3b82f6', '#10b981', '#ef4444'],
                                        stroke: { curve: 'smooth', width: 2 },
                                        dataLabels: { enabled: false },
                                        legend: { position: 'top' },
                                    }}
                                />
                            </Card>
                        )}

                        {data.apps.length > 0 && (
                            <Card>
                                <h5 className="font-semibold mb-4">Sesiones por App</h5>
                                <Chart
                                    type="bar"
                                    height={280}
                                    series={[
                                        { name: 'Total', data: data.apps.map(a => a.total) },
                                        { name: 'Verificadas', data: data.apps.map(a => a.verified) },
                                    ]}
                                    customOptions={{
                                        xaxis: { categories: data.apps.map(a => a.appName), labels: { rotate: -45, style: { fontSize: '11px' } } },
                                        plotOptions: { bar: { borderRadius: 4, columnWidth: '60%' } },
                                        dataLabels: { enabled: false },
                                        colors: ['#3b82f6', '#10b981'],
                                        legend: { position: 'top' },
                                    }}
                                />
                            </Card>
                        )}
                    </div>

                    {analytics?.latencyByModule && Object.keys(analytics.latencyByModule).length > 0 && (
                        <Card className="mb-6">
                            <h5 className="font-semibold mb-4">Latencia por Módulo</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                {Object.entries(analytics.latencyByModule).map(([module, lat]) => (
                                    <div key={module} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                                        <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{module.replace(/_/g, ' ')}</div>
                                        <div className="flex items-center gap-3">
                                            <PiClock className="text-primary" />
                                            <div>
                                                <div className="text-lg font-bold">{Math.round(lat.avg)}ms</div>
                                                <div className="text-xs text-gray-400">P50: {Math.round(lat.p50)}ms / P95: {Math.round(lat.p95)}ms</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}

                    <Card bodyClass="px-0 py-0">
                        {data.apps.length === 0 ? (
                            <div className="py-16 text-center text-sm text-gray-400">Sin verificaciones en el período.</div>
                        ) : (
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
                                        const rate = a.total > 0 ? (a.verified / a.total) * 100 : 0
                                        return (
                                            <Tr key={a.appId ?? '_none'}>
                                                <Td className="font-medium">{a.appName}</Td>
                                                <Td>{a.total}</Td>
                                                <Td className="text-success font-medium">{a.verified}</Td>
                                                <Td className="text-gray-500">{a.rejected}</Td>
                                                <Td>
                                                    <div className="flex items-center gap-2">
                                                        <Progress value={rate} color={rate > 70 ? 'success' : rate > 40 ? 'warning' : 'danger'} showLabel={false} className="h-1.5 w-16" />
                                                        <span className="text-xs font-medium">{Math.round(rate)}%</span>
                                                    </div>
                                                </Td>
                                                <Td>
                                                    <div className="flex flex-wrap gap-1">
                                                        {Object.entries(a.byState).map(([s, n]) => (
                                                            <Badge key={s} variant="outline" color={s === 'verified' ? 'success' : s === 'rejected' || s === 'error' ? 'danger' : s === 'needs_recapture' ? 'warning' : 'gray'} className="text-[10px]">
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
                        )}
                    </Card>
                </>
            ) : null}
        </div>
    )
}

export default UsageView