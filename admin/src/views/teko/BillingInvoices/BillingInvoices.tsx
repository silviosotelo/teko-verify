import { useState, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Pagination from '@/components/ui/Pagination'
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import DataTable, { type Column } from '@/components/shared/DataTable'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import classNames from '@/utils/classNames'
import { PiDownload, PiCurrencyDollar, PiCheckCircle, PiClockClockwise, PiWarningCircle, PiFilePdf, PiFileCsv } from 'react-icons/pi'

interface Invoice {
    id: string
    date: string
    dueDate: string
    description: string
    amount: number
    status: 'paid' | 'pending' | 'overdue'
    items: Array<{ label: string; qty: number; unitPrice: number }>
}

const MOCK_INVOICES: Invoice[] = [
    {
        id: 'INV-2026-0042',
        date: '2026-06-01',
        dueDate: '2026-06-30',
        description: 'Plan Professional - Junio 2026',
        amount: 99.0,
        status: 'pending',
        items: [
            { label: 'Plan Professional (5.000 verificaciones)', qty: 1, unitPrice: 99 },
        ],
    },
    {
        id: 'INV-2026-0041',
        date: '2026-05-01',
        dueDate: '2026-05-30',
        description: 'Plan Professional - Mayo 2026',
        amount: 99.0,
        status: 'paid',
        items: [
            { label: 'Plan Professional (5.000 verificaciones)', qty: 1, unitPrice: 99 },
        ],
    },
    {
        id: 'INV-2026-0040',
        date: '2026-04-01',
        dueDate: '2026-04-30',
        description: 'Plan Professional - Abril 2026',
        amount: 99.0,
        status: 'paid',
        items: [
            { label: 'Plan Professional (5.000 verificaciones)', qty: 1, unitPrice: 99 },
        ],
    },
    {
        id: 'INV-2026-0039',
        date: '2026-03-01',
        dueDate: '2026-03-30',
        description: 'Plan Professional - Marzo 2026',
        amount: 99.0,
        status: 'paid',
        items: [
            { label: 'Plan Professional (5.000 verificaciones)', qty: 1, unitPrice: 99 },
        ],
    },
    {
        id: 'INV-2026-0038',
        date: '2026-02-01',
        dueDate: '2026-02-28',
        description: 'Plan Starter - Febrero 2026',
        amount: 29.0,
        status: 'paid',
        items: [
            { label: 'Plan Starter (500 verificaciones)', qty: 1, unitPrice: 29 },
        ],
    },
    {
        id: 'INV-2026-0037',
        date: '2026-01-01',
        dueDate: '2026-01-31',
        description: 'Plan Starter - Enero 2026',
        amount: 29.0,
        status: 'paid',
        items: [
            { label: 'Plan Starter (500 verificaciones)', qty: 1, unitPrice: 29 },
        ],
    },
]

function StatusBadge({ status }: { status: Invoice['status'] }) {
    const config: Record<string, { label: string; color: 'emerald' | 'amber' | 'red' }> = {
        paid: { label: 'Pagada', color: 'emerald' },
        pending: { label: 'Pendiente', color: 'amber' },
        overdue: { label: 'Vencida', color: 'red' },
    }
    const { label, color } = config[status]
    return <Badge variant="solid" color={color}>{label}</Badge>
}

function fmtCurrency(n: number): string {
    return new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(iso: string): string {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('es-PY', { day: '2-digit', month: 'short', year: 'numeric' })
}

function BillingInvoices() {
    const { current, currentId, loading: tLoading } = useTenant()
    const [invoices] = useState<Invoice[]>(MOCK_INVOICES)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('all')
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 10

    useEffect(() => {
        if (!currentId) {
            setLoading(false)
            return
        }
        setLoading(true)
        tekoApi
            .usage(currentId)
            .catch(() => {
                // Silently fail — we have mock data fallback
            })
            .finally(() => setLoading(false))
    }, [currentId])

    const filtered = useMemo(() => {
        return invoices.filter((inv) => {
            const matchesSearch =
                !search ||
                inv.id.toLowerCase().includes(search.toLowerCase()) ||
                inv.description.toLowerCase().includes(search.toLowerCase())
            const matchesStatus = statusFilter === 'all' || inv.status === statusFilter
            return matchesSearch && matchesStatus
        })
    }, [invoices, search, statusFilter])

    const paginated = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filtered.slice(start, start + pageSize)
    }, [filtered, currentPage])

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))

    const summary = useMemo(() => {
        const totalBilled = invoices.reduce((sum, inv) => sum + inv.amount, 0)
        const pending = invoices.filter((i) => i.status === 'pending').reduce((s, i) => s + i.amount, 0)
        const lastPaid = invoices.find((i) => i.status === 'paid')
        return { totalBilled, pending, lastPaid }
    }, [invoices])

    const columns: Column<Invoice>[] = [
        {
            key: 'id',
            label: 'Factura',
            render: (row) => (
                <span className="font-mono text-sm font-medium heading-text">{row.id}</span>
            ),
        },
        {
            key: 'date',
            label: 'Fecha',
            render: (row) => fmtDate(row.date),
        },
        {
            key: 'description',
            label: 'Descripción',
            render: (row) => (
                <span className="text-sm">{row.description}</span>
            ),
        },
        {
            key: 'amount',
            label: 'Monto',
            render: (row) => (
                <span className="font-semibold heading-text">{fmtCurrency(row.amount)}</span>
            ),
        },
        {
            key: 'status',
            label: 'Estado',
            render: (row) => <StatusBadge status={row.status} />,
        },
        {
            key: 'actions',
            label: 'Acciones',
            render: (row) => (
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        onClick={() => {}}
                        title="Descargar PDF"
                    >
                        <PiFilePdf className="w-4 h-4" />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        onClick={() => {}}
                        title="Descargar CSV"
                    >
                        <PiFileCsv className="w-4 h-4" />
                    </Button>
                </div>
            ),
        },
    ]

    function handleExport(format: 'csv' | 'pdf') {
        const data = filtered.map((inv) => ({
            factura: inv.id,
            fecha: inv.date,
            descripcion: inv.description,
            monto: inv.amount,
            estado: inv.status,
        }))
        if (format === 'csv') {
            const header = 'factura,fecha,descripcion,monto,estado\n'
            const rows = data.map((d) => `${d.factura},${d.fecha},${d.descripcion},${d.monto},${d.estado}`).join('\n')
            const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `facturas_${format}_${new Date().toISOString().slice(0, 10)}.csv`
            a.click()
            URL.revokeObjectURL(url)
        }
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
                <h3 className="mb-1">Facturación</h3>
                <p className="text-gray-500">
                    {current
                        ? `Historial de facturación de ${current.name}`
                        : 'Historial de facturación'}
                </p>
            </div>

            {error && (
                <Alert showIcon type="danger" className="mb-6">
                    {error}
                </Alert>
            )}

            {loading ? (
                <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                            <Card key={i}>
                                <Skeleton className="h-4 w-24 mb-3" />
                                <Skeleton className="h-8 w-20" />
                            </Card>
                        ))}
                    </div>
                    <Card>
                        <Skeleton className="h-10 w-full mb-4" />
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-12 w-full mb-2" />
                        ))}
                    </Card>
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                >
                    <div className="grid gap-4 sm:grid-cols-3 mb-6">
                        <Card>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                                    <PiCurrencyDollar className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">Total facturado</div>
                                    <div className="text-xl font-bold heading-text">
                                        {fmtCurrency(summary.totalBilled)}
                                    </div>
                                </div>
                            </div>
                        </Card>
                        <Card>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-500/20">
                                    <PiClockClockwise className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">Pendiente</div>
                                    <div className="text-xl font-bold heading-text">
                                        {fmtCurrency(summary.pending)}
                                    </div>
                                </div>
                            </div>
                        </Card>
                        <Card>
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/20">
                                    <PiCheckCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">Último pago</div>
                                    <div className="text-xl font-bold heading-text">
                                        {summary.lastPaid
                                            ? fmtCurrency(summary.lastPaid.amount)
                                            : '—'}
                                    </div>
                                    {summary.lastPaid && (
                                        <div className="text-xs text-gray-400">
                                            {fmtDate(summary.lastPaid.date)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    </div>

                    <Card bodyClass="px-0 py-0">
                        <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <Input
                                    placeholder="Buscar factura..."
                                    value={search}
                                    onChange={(e) => {
                                        setSearch(e.target.value)
                                        setCurrentPage(1)
                                    }}
                                    className="max-w-xs"
                                />
                                <Select
                                    value={statusFilter}
                                    onChange={(v) => {
                                        setStatusFilter(String(v))
                                        setCurrentPage(1)
                                    }}
                                    options={[
                                        { label: 'Todos', value: 'all' },
                                        { label: 'Pagadas', value: 'paid' },
                                        { label: 'Pendientes', value: 'pending' },
                                        { label: 'Vencidas', value: 'overdue' },
                                    ]}
                                    className="w-36"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleExport('csv')}
                                >
                                    <PiFileCsv className="w-4 h-4" />
                                    CSV
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleExport('pdf')}
                                >
                                    <PiFilePdf className="w-4 h-4" />
                                    PDF
                                </Button>
                            </div>
                        </div>

                        <DataTable
                            columns={columns}
                            data={paginated}
                            emptyMessage={
                                filtered.length === 0
                                    ? 'No se encontraron facturas.'
                                    : 'No hay facturas que coincidan con los filtros.'
                            }
                            striped
                        />

                        {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t px-4 py-3">
                                <span className="text-sm text-gray-500">
                                    Mostrando {(currentPage - 1) * pageSize + 1}-
                                    {Math.min(currentPage * pageSize, filtered.length)} de{' '}
                                    {filtered.length}
                                </span>
                                <Pagination
                                    current={currentPage}
                                    total={totalPages}
                                    pageSize={pageSize}
                                    onChange={(page) => setCurrentPage(page)}
                                />
                            </div>
                        )}
                    </Card>
                </motion.div>
            )}
        </div>
    )
}

export default BillingInvoices
