import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Table from '@/components/ui/Table'
import Pagination from '@/components/ui/Pagination'
import Dialog from '@/components/ui/Dialog'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { StateBadge, LoaBadge } from '@/teko/badges'
import { fmtDate } from '@/teko/format'
import type { SessionRow, SessionState, LoA } from '@/teko/types'
import { motion } from 'framer-motion'
import { PiMagnifyingGlass,
    PiPlus,
    PiDownload,
    PiEye,
    PiUsers,
    PiCheckCircle,
    PiXCircle,
    PiClockClockwise,
    PiWarningCircle,
    PiLink,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const STATE_OPTIONS: { value: SessionState | ''; label: string }[] = [
    { value: '', label: 'Todos los estados' },
    { value: 'created', label: 'Creada' },
    { value: 'capturing', label: 'Capturando' },
    { value: 'processing', label: 'Procesando' },
    { value: 'in_review', label: 'En revisión' },
    { value: 'verified', label: 'Verificada' },
    { value: 'rejected', label: 'Rechazada' },
    { value: 'needs_recapture', label: 'Recaptura' },
    { value: 'expired', label: 'Expirada' },
    { value: 'error', label: 'Error' },
]

const SessionsView = () => {
    const navigate = useNavigate()
    const { current, currentId, loading: tLoading } = useTenant()
    const [rows, setRows] = useState<SessionRow[]>([])
    const [total, setTotal] = useState(0)
    const [stateFilter, setStateFilter] = useState<SessionState | ''>('')
    const [searchQuery, setSearchQuery] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [sortField, setSortField] = useState<'createdAt' | 'id'>('createdAt')
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
    const [page, setPage] = useState(1)
    const limit = 20
    const [createOpen, setCreateOpen] = useState(false)
    const [createEmail, setCreateEmail] = useState('')
    const [createLoa, setCreateLoa] = useState('L2')
    const [creating, setCreating] = useState(false)
    const [createResult, setCreateResult] = useState<{ link: string; emailSent: boolean } | null>(null)

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .listSessions(currentId, {
                state: stateFilter || undefined,
                limit,
                offset: (page - 1) * limit,
            })
            .then((r) => {
                let sessions = [...(r.sessions ?? [])]

                // Client-side search filter
                if (searchQuery) {
                    const q = searchQuery.toLowerCase()
                    sessions = sessions.filter(
                        (s) =>
                            s.id.toLowerCase().includes(q) ||
                            (s.externalRef &&
                                s.externalRef.toLowerCase().includes(q)),
                    )
                }

                // Sort
                sessions.sort((a, b) => {
                    const aVal = a[sortField]
                    const bVal = b[sortField]
                    const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
                    return sortDir === 'asc' ? cmp : -cmp
                })

                setRows(sessions)
                setTotal(sessions.length)
            })
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId, stateFilter, searchQuery, sortField, sortDir, page])

    const handleSort = (field: 'createdAt' | 'id') => {
        if (sortField === field) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        } else {
            setSortField(field)
            setSortDir('desc')
        }
    }

    const handleExport = () => {
        const csvHeader = 'ID,External Ref,State,LoA,Created,Completed,Decision\n'
        const csvRows = rows
            .map(
                (s) =>
                    `${s.id},"${s.externalRef || ''}",${s.state},${s.result?.loa || ''},${s.createdAt},${s.completedAt || ''},"${s.result?.decision || ''}"`,
            )
            .join('\n')
        const blob = new Blob([csvHeader + csvRows], {
            type: 'text/csv',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `sessions-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
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
                    <h3 className="mb-1">Sesiones</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Verificaciones de ${current.name}`
                            : 'Verificaciones del tenant'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="solid" size="sm" icon={<PiPlus />} onClick={() => { setCreateOpen(true); setCreateResult(null); setCreateEmail(''); setCreateLoa('L2') }}>
                        Nueva sesión
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleExport} className="gap-1">
                        <PiDownload />
                        Exportar CSV
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                {[
                    {
                        label: 'Total',
                        value: total,
                        icon: <PiUsers />,
                        color: 'primary',
                    },
                    {
                        label: 'Verificadas',
                        value: rows.filter((s) => s.state === 'verified').length,
                        icon: <PiCheckCircle />,
                        color: 'success',
                    },
                    {
                        label: 'Rechazadas',
                        value: rows.filter((s) => s.state === 'rejected').length,
                        icon: <PiXCircle />,
                        color: 'danger',
                    },
                    {
                        label: 'Pendientes',
                        value: rows.filter((s) => ['created', 'capturing', 'processing'].includes(s.state)).length,
                        icon: <PiClockClockwise />,
                        color: 'warning',
                    },
                    {
                        label: 'En Revisión',
                        value: rows.filter((s) => s.state === 'in_review').length,
                        icon: <PiWarningCircle />,
                        color: 'orange',
                    },
                ].map((stat) => (
                    <Card key={stat.label} className="text-center">
                        <div className={`text-2xl mb-1 ${
                            stat.color === 'success' ? 'text-success' :
                            stat.color === 'danger' ? 'text-danger' :
                            stat.color === 'warning' ? 'text-warning' :
                            stat.color === 'orange' ? 'text-orange-500' :
                            'text-primary'
                        }`}>{stat.icon}</div>
                        <div className="text-2xl font-bold">{stat.value}</div>
                        <div className="text-xs text-gray-400">{stat.label}</div>
                    </Card>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex-1 min-w-[200px]">
                    <Input
                        size="sm"
                        placeholder="Buscar por ID o referencia externa..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value)
                            setPage(1)
                        }}
                        prefix={<PiMagnifyingGlass />}
                    />
                </div>
                <div className="w-48">
                    <Select
                        size="sm"
                        options={STATE_OPTIONS}
                        value={STATE_OPTIONS.find((o) => o.value === stateFilter)}
                        onChange={(opt) => {
                            setStateFilter((opt?.value as SessionState | '') ?? '')
                            setPage(1)
                        }}
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
                ) : rows.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay sesiones que coincidan con los filtros aplicados.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th className="w-10">
                                    <input type="checkbox" className="rounded" />
                                </Th>
                                <Th
                                    className="cursor-pointer select-none hover:text-primary"
                                    onClick={() => handleSort('createdAt')}
                                >
                                    <span className="flex items-center gap-1">
                                        Creada
                                        {sortField === 'createdAt' && (
                                            <span className="text-xs">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                                        )}
                                    </span>
                                </Th>
                                <Th>Estado</Th>
                                <Th>LoA</Th>
                                <Th>Ref. Externa</Th>
                                <Th>Decisión</Th>
                                <Th
                                    className="cursor-pointer select-none hover:text-primary"
                                    onClick={() => handleSort('id')}
                                >
                                    <span className="flex items-center gap-1">
                                        ID
                                        {sortField === 'id' && (
                                            <span className="text-xs">{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
                                        )}
                                    </span>
                                </Th>
                                <Th>Acciones</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {rows.map((s, i) => (
                                <motion.tr
                                    key={s.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.02 }}
                                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50"
                                >
                                    <Td>
                                        <input type="checkbox" className="rounded" />
                                    </Td>
                                    <Td className="whitespace-nowrap text-sm text-gray-500">
                                        {fmtDate(s.createdAt)}
                                        {s.completedAt && (
                                            <div className="text-xs text-gray-400">
                                                → {fmtDate(s.completedAt)}
                                            </div>
                                        )}
                                    </Td>
                                    <Td>
                                        <StateBadge state={s.state} />
                                    </Td>
                                    <Td>
                                        <LoaBadge
                                            loa={
                                                s.result?.loa ??
                                                s.assuranceRequired
                                            }
                                        />
                                    </Td>
                                    <Td className="text-sm">
                                        {s.externalRef || (
                                            <span className="text-gray-300 dark:text-gray-600">—</span>
                                        )}
                                    </Td>
                                    <Td>
                                        {s.result?.decision ? (
                                            <Badge
                                                variant="solid"
                                                color={
                                                    s.result.decision ===
                                                    'verified'
                                                        ? 'success'
                                                        : s.result.decision ===
                                                          'needs_recapture'
                                                          ? 'warning'
                                                          : 'danger'
                                                }
                                            >
                                                {s.result.decision ===
                                                'verified'
                                                    ? 'Verificada'
                                                    : s.result.decision ===
                                                      'needs_recapture'
                                                      ? 'Recaptura'
                                                      : 'Rechazada'}
                                            </Badge>
                                        ) : (
                                            <span className="text-gray-300 dark:text-gray-600 text-sm">
                                                —
                                            </span>
                                        )}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-400">
                                        {s.id.slice(0, 8)}…
                                    </Td>
                                    <Td>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                navigate(`/sessions/${s.id}`)
                                            }
                                            className="gap-1 h-8"
                                        >
                                            <PiEye />
                                            Ver
                                        </Button>
                                    </Td>
                                </motion.tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>
            {!loading && rows.length > 0 && (
                <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                        Mostrando {rows.length} de {total} sesiones
                    </span>
                    <Pagination
                        current={page}
                        total={total}
                        pageSize={limit}
                        onChange={(p) => setPage(p)}
                        showSizeChanger={false}
                    />
                </div>
            )}

            <Dialog isOpen={createOpen} onClose={() => setCreateOpen(false)} width={500}>
                {createResult ? (
                    <div>
                        <h5 className="font-semibold mb-4">Sesión creada</h5>
                        <Alert showIcon type={createResult.emailSent ? 'success' : 'warning'} className="mb-4">
                            {createResult.emailSent
                                ? 'Link de verificación enviado por email.'
                                : 'Sesión creada pero el email no pudo enviarse (revisá SMTP).'}
                        </Alert>
                        <div className="text-sm space-y-2">
                            <div className="flex justify-between py-2 border-b"><span className="text-gray-500">Link de verificación</span></div>
                            <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg font-mono text-xs break-all select-all">
                                {createResult.link}
                            </div>
                        </div>
                        <Button variant="default" className="mt-4" onClick={() => { setCreateOpen(false); setCreateResult(null) }}>
                            Cerrar
                        </Button>
                    </div>
                ) : (
                    <form onSubmit={async (e) => {
                        e.preventDefault()
                        if (!currentId) return
                        setCreating(true)
                        try {
                            const res = await tekoApi.testSession(currentId, createLoa as LoA, createEmail || undefined)
                            setCreateResult({ link: res.verifyUrl, emailSent: res.emailSent ?? false })
                        } catch (e: unknown) {
                            Alert && Alert({ showIcon: true, type: 'danger' as string, children: (e as Error).message })
                        } finally { setCreating(false) }
                    }}>
                        <h5 className="font-semibold mb-4">Nueva sesión de verificación</h5>
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium">Email del solicitante</label>
                                <Input type="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="solicitante@ejemplo.com" />
                                <p className="text-xs text-gray-400 mt-1">Opcional: si se ingresa, se envía el link por email</p>
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium">Nivel de aseguramiento</label>
                                <select className="w-full border rounded-md px-3 py-2 text-sm" value={createLoa} onChange={(e) => setCreateLoa(e.target.value)}>
                                    <option value="L1">L1 - Solo documento</option>
                                    <option value="L2">L2 - Documento + Match facial</option>
                                    <option value="L3">L3 - Documento + Match + Liveness</option>
                                </select>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end gap-2">
                            <Button variant="default" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                            <Button variant="solid" type="submit" loading={creating} icon={<PiLink />}>Crear sesión</Button>
                        </div>
                    </form>
                )}
            </Dialog>
        </div>
    )
}

export default SessionsView
