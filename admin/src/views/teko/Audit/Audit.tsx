import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Table from '@/components/ui/Table'
import Dialog from '@/components/ui/Dialog'
import Timeline from '@/components/ui/Timeline'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { AuditEntry } from '@/teko/types'
import { motion } from 'framer-motion'
import {
    PiMagnifyingGlass,
    PiDownload,
    PiClockClockwise,
    PiShieldCheck,
    PiUserCircle,
    PiGear,
    PiListChecks,
    PiTrash,
    PiEye,
    PiArrowsClockwise,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const EVENT_ICONS: Record<string, React.ReactNode> = {
    'operator.login': <PiUserCircle />,
    'operator.logout': <PiUserCircle />,
    'operator.created': <PiShieldCheck />,
    'operator.role_changed': <PiGear />,
    'tenant.created': <PiShieldCheck />,
    'tenant.updated': <PiGear />,
    'api_key.created': <PiListChecks />,
    'api_key.revoked': <PiTrash />,
    'webhook.created': <PiListChecks />,
    'webhook.updated': <PiGear />,
    'webhook.deleted': <PiTrash />,
    'workflow.created': <PiListChecks />,
    'workflow.updated': <PiGear />,
    'session.created': <PiClockClockwise />,
    'session.approved': <PiShieldCheck />,
    'session.declined': <PiTrash />,
    'session.reviewed': <PiEye />,
}

const EVENT_COLORS: Record<string, string> = {
    'operator.login': 'success',
    'operator.logout': 'gray',
    'operator.created': 'primary',
    'operator.role_changed': 'warning',
    'tenant.created': 'success',
    'tenant.updated': 'primary',
    'api_key.created': 'primary',
    'api_key.revoked': 'danger',
    'webhook.created': 'primary',
    'webhook.updated': 'warning',
    'webhook.deleted': 'danger',
    'workflow.created': 'success',
    'workflow.updated': 'warning',
    'session.created': 'primary',
    'session.approved': 'success',
    'session.declined': 'danger',
    'session.reviewed': 'warning',
}

function actorClass(actor: string): string {
    if (actor.startsWith('admin:'))
        return 'bg-primary-subtle text-primary'
    if (actor.startsWith('tenant:'))
        return 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100'
    if (actor.startsWith('subject'))
        return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100'
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200'
}

const AuditView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [entries, setEntries] = useState<AuditEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [eventFilter, setEventFilter] = useState('')
    const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null)
    const [detailDialogOpen, setDetailDialogOpen] = useState(false)

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .audit(currentId, { limit: 1000 })
            .then((r) => setEntries(r.entries ?? []))
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId])

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        tekoApi
            .audit(currentId, { limit: 1000 })
            .then((r) => {
                let items = [...(r.entries ?? [])].reverse()

                if (searchQuery) {
                    const q = searchQuery.toLowerCase()
                    items = items.filter(
                        (e) =>
                            e.actor.toLowerCase().includes(q) ||
                            e.event.toLowerCase().includes(q) ||
                            (e.ip && e.ip.includes(q)) ||
                            (e.sessionId && e.sessionId.includes(q)),
                    )
                }

                if (eventFilter) {
                    items = items.filter((e) => e.event === eventFilter)
                }

                setEntries(items)
            })
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId, searchQuery, eventFilter])

    const eventTypes = [...new Set(entries.map((e) => e.event))].sort()

    const handleExport = () => {
        const csvHeader = 'ID,Actor,Event,Session ID,IP,Created\n'
        const csvRows = entries
            .map(
                (e) =>
                    `${e.id},"${e.actor}",${e.event},"${e.sessionId || ''}","${e.ip || ''}",${e.createdAt}`,
            )
            .join('\n')
        const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleViewDetail = (entry: AuditEntry) => {
        setSelectedEntry(entry)
        setDetailDialogOpen(true)
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
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Auditoría</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Registro de eventos de ${current.name}`
                            : 'Audit log completo'}
                    </p>
                </div>
                <Button variant="ghost" size="sm" onClick={handleExport} className="gap-1">
                    <PiDownload />
                    Exportar CSV
                </Button>
            </div>

            {/* Event Type Summary */}
            <div className="flex flex-wrap gap-2 mb-4">
                {eventTypes.map((eventType) => {
                    const count = entries.filter((e) => e.event === eventType).length
                    return (
                        <Badge
                            key={eventType}
                            variant={eventFilter === eventType ? 'solid' : 'outline'}
                            color={EVENT_COLORS[eventType] || 'gray'}
                            className="cursor-pointer"
                            onClick={() =>
                                setEventFilter(
                                    eventFilter === eventType ? '' : eventType,
                                )
                            }
                        >
                            {eventType} ({count})
                        </Badge>
                    )
                })}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex-1 min-w-[200px]">
                    <Input
                        size="sm"
                        placeholder="Buscar por actor, evento, IP, session ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        prefix={<PiMagnifyingGlass />}
                    />
                </div>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            <Card bodyClass="px-0 py-0">
                {loading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size={40} />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay eventos registrados.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Fecha</Th>
                                <Th>Actor</Th>
                                <Th>Evento</Th>
                                <Th>Session ID</Th>
                                <Th>IP</Th>
                                <Th>Acciones</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {entries.map((e, i) => (
                                <motion.tr
                                    key={e.id}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: i * 0.01 }}
                                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                >
                                    <Td className="whitespace-nowrap text-sm text-gray-500">
                                        {fmtDate(e.createdAt)}
                                    </Td>
                                    <Td>
                                        <span
                                            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${actorClass(
                                                e.actor,
                                            )}`}
                                        >
                                            {e.actor}
                                        </span>
                                    </Td>
                                    <Td>
                                        <div className="flex items-center gap-2">
                                            <span className={
                                                EVENT_COLORS[e.event] === 'success' ? 'text-success' :
                                                EVENT_COLORS[e.event] === 'danger' ? 'text-danger' :
                                                EVENT_COLORS[e.event] === 'warning' ? 'text-warning' :
                                                'text-primary'
                                            }>
                                                {EVENT_ICONS[e.event] || <PiListChecks />}
                                            </span>
                                            <span className="font-mono text-xs font-medium">
                                                {e.event}
                                            </span>
                                        </div>
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-400">
                                        {e.sessionId ? e.sessionId.slice(0, 8) + '…' : '—'}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-400">
                                        {e.ip ?? '—'}
                                    </Td>
                                    <Td>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleViewDetail(e)}
                                            className="h-8 gap-1"
                                        >
                                            <PiEye />
                                            Detalle
                                        </Button>
                                    </Td>
                                </motion.tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>
            {!loading && entries.length > 0 && (
                <div className="mt-3 text-xs text-gray-400">
                    {entries.length} eventos.
                </div>
            )}

            {/* Detail Dialog */}
            <Dialog
                open={detailDialogOpen}
                onClose={() => setDetailDialogOpen(false)}
                title="Detalle del Evento"
                footer={
                    <Button
                        variant="ghost"
                        onClick={() => setDetailDialogOpen(false)}
                    >
                        Cerrar
                    </Button>
                }
            >
                {selectedEntry && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-gray-400">ID</label>
                                <div className="font-mono text-sm">{selectedEntry.id}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Fecha</label>
                                <div className="text-sm">{fmtDate(selectedEntry.createdAt)}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Actor</label>
                                <div className="text-sm">{selectedEntry.actor}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Evento</label>
                                <div className="text-sm font-mono">{selectedEntry.event}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Session ID</label>
                                <div className="font-mono text-sm">{selectedEntry.sessionId || '—'}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">IP</label>
                                <div className="font-mono text-sm">{selectedEntry.ip || '—'}</div>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-gray-400">Detalle</label>
                            <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">
                                {JSON.stringify(selectedEntry.detail, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}
            </Dialog>
        </div>
    )
}

export default AuditView
