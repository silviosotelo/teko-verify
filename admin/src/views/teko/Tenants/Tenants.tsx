import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Table from '@/components/ui/Table'
import Progress from '@/components/ui/Progress'
import Tag from '@/components/ui/Tag'
import Chart from '@/components/shared/Chart'
import IconText from '@/components/shared/IconText'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { Tenant, TenantStatus } from '@/teko/types'
import { motion } from 'framer-motion'
import {
    PiUsers,
    PiShieldCheck,
    PiClockClockwise,
    PiCheckCircle,
    PiXCircle,
    PiGear,
    PiPlus,
    PiPencilSimpleLine,
    PiTrash,
    PiEye,
    
    
    
    PiPlug,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const LOA_OPTS = ['L1', 'L2', 'L3', 'L4'].map((l) => ({ value: l, label: l }))
const STATUS_OPTS: { value: TenantStatus; label: string }[] = [
    { value: 'active', label: 'Activo' },
    { value: 'suspended', label: 'Suspendido' },
    { value: 'disabled', label: 'Deshabilitado' },
]

function statusBadge(s: TenantStatus) {
    const color =
        s === 'active'
            ? 'success'
            : s === 'suspended'
              ? 'warning'
              : 'danger'
    return <Badge variant="solid" color={color}>{s.charAt(0).toUpperCase() + s.slice(1)}</Badge>
}

const Field = ({
    label,
    children,
}: {
    label: string
    children: React.ReactNode
}) => (
    <div>
        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
            {label}
        </label>
        {children}
    </div>
)

const TenantsView = () => {
    const { current, currentId, loading: tLoading, tenants, reload, loading } = useTenant()
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [editing, setEditing] = useState<Tenant | null>(null)
    const [busy, setBusy] = useState(false)
    const [detailTenant, setDetailTenant] = useState<Tenant | null>(null)

    // create form
    const [name, setName] = useState('')
    const [slug, setSlug] = useState('')
    const [assurance, setAssurance] = useState('L2')
    const [retention, setRetention] = useState('90')

    function resetCreate() {
        setName('')
        setSlug('')
        setAssurance('L2')
        setRetention('90')
    }

    async function submitCreate(e: React.FormEvent) {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
            await tekoApi.createTenant({
                name,
                slug,
                policies: {
                    assuranceRequired: assurance as Tenant['policies']['assuranceRequired'],
                    retentionDays: parseInt(retention, 10) || 90,
                },
            })
            setCreating(false)
            resetCreate()
            await reload()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    // edit form
    const [eName, setEName] = useState('')
    const [eStatus, setEStatus] = useState<TenantStatus>('active')
    const [eAssurance, setEAssurance] = useState('L2')
    const [eRetention, setERetention] = useState('90')

    useEffect(() => {
        if (editing) {
            setEName(editing.name)
            setEStatus(editing.status)
            setEAssurance(editing.policies?.assuranceRequired ?? 'L2')
            setERetention(String(editing.policies?.retentionDays ?? 90))
        }
    }, [editing])

    async function submitEdit(e: React.FormEvent) {
        e.preventDefault()
        if (!editing) return
        setBusy(true)
        setError(null)
        try {
            await tekoApi.updateTenant(editing.id, {
                name: eName,
                status: eStatus,
                policies: {
                    assuranceRequired: eAssurance as Tenant['policies']['assuranceRequired'],
                    retentionDays: parseInt(eRetention, 10) || 90,
                },
            })
            setEditing(null)
            await reload()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    // Health check simulation per tenant
    const healthStatus: Record<string, 'healthy' | 'degraded' | 'unknown'> = {}
    tenants.forEach((t) => {
        if (t.status === 'active') healthStatus[t.id] = 'healthy'
        else if (t.status === 'suspended') healthStatus[t.id] = 'degraded'
        else healthStatus[t.id] = 'unknown'
    })

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Tenants</h3>
                    <p className="text-gray-500">
                        Organizaciones consumidoras de Teko Verify
                    </p>
                </div>
                <Button variant="solid" onClick={() => setCreating(true)} className="gap-1">
                    <PiPlus />
                    Nuevo tenant
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                    <Card>
                        <IconText icon={<PiUsers />} text="Total Tenants" iconClassName="text-primary" />
                        <div className="mt-2 text-3xl font-bold heading-text">{tenants.length}</div>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                    <Card>
                        <IconText icon={<PiCheckCircle />} text="Activos" iconClassName="text-success" />
                        <div className="mt-2 text-3xl font-bold text-success">
                            {tenants.filter((t) => t.status === 'active').length}
                        </div>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <Card>
                        <IconText icon={<PiXCircle />} text="Suspendidos" iconClassName="text-danger" />
                        <div className="mt-2 text-3xl font-bold text-danger">
                            {tenants.filter((t) => t.status === 'suspended').length}
                        </div>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                    <Card>
                        <IconText icon={<span className="text-warning text-xl">●</span>} text="Salud" iconClassName="text-warning" />
                        <div className="mt-2 text-3xl font-bold heading-text">
                            {tenants.length > 0
                                ? Math.round(
                                    (tenants.filter((t) => healthStatus[t.id] === 'healthy').length / tenants.length) * 100
                                  )
                                : 0}%
                        </div>
                        <Progress
                            value={tenants.length > 0
                                ? (tenants.filter((t) => healthStatus[t.id] === 'healthy').length / tenants.length) * 100
                                : 0
                            }
                            color="success"
                            showLabel={false}
                            className="h-1 mt-2"
                        />
                    </Card>
                </motion.div>
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
                ) : tenants.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay tenants. Creá el primero para empezar.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Nombre</Th>
                                <Th>Slug</Th>
                                <Th>Estado</Th>
                                <Th>LoA</Th>
                                <Th>Retención</Th>
                                <Th>Salud</Th>
                                <Th>Creado</Th>
                                <Th>Acciones</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {tenants.map((t) => (
                                <Tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                    <Td className="font-medium heading-text">
                                        {t.name}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-500">
                                        {t.slug}
                                    </Td>
                                    <Td>{statusBadge(t.status)}</Td>
                                    <Td className="font-mono">
                                        <Badge variant="solid" color="primary">
                                            {t.policies?.assuranceRequired ?? '—'}
                                        </Badge>
                                    </Td>
                                    <Td>{t.policies?.retentionDays ?? 90} días</Td>
                                    <Td>
                                        <Badge
                                            variant="solid"
                                            color={
                                                healthStatus[t.id] === 'healthy'
                                                    ? 'success'
                                                    : healthStatus[t.id] === 'degraded'
                                                      ? 'warning'
                                                      : 'gray'
                                            }
                                        >
                                            {healthStatus[t.id] === 'healthy' ? 'OK' : healthStatus[t.id] === 'degraded' ? 'Degradado' : '—'}
                                        </Badge>
                                    </Td>
                                    <Td className="text-gray-500 whitespace-nowrap">
                                        {fmtDate(t.createdAt)}
                                    </Td>
                                    <Td>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => setDetailTenant(t)}
                                                className="h-7 w-7 p-0"
                                                title="Ver detalle"
                                            >
                                                <PiEye />
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => setEditing(t)}
                                                className="h-7 w-7 p-0"
                                                title="Editar"
                                            >
                                                <PiPencilSimpleLine />
                                            </Button>
                                        </div>
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>

            {/* Crear */}
            <Dialog
                isOpen={creating}
                onClose={() => setCreating(false)}
                onRequestClose={() => setCreating(false)}
                title="Nuevo tenant"
            >
                <form onSubmit={submitCreate} className="space-y-4">
                    <Field label="Nombre">
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </Field>
                    <Field label="Slug">
                        <Input
                            value={slug}
                            placeholder="mi-empresa"
                            onChange={(e) =>
                                setSlug(
                                    e.target.value
                                        .toLowerCase()
                                        .replace(/[^a-z0-9-]/g, '-'),
                                )
                            }
                            required
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="LoA requerido">
                            <Select
                                options={LOA_OPTS}
                                value={LOA_OPTS.find(
                                    (o) => o.value === assurance,
                                )}
                                onChange={(o) => setAssurance(o?.value ?? 'L2')}
                            />
                        </Field>
                        <Field label="Retención (días)">
                            <Input
                                type="number"
                                value={retention}
                                onChange={(e) => setRetention(e.target.value)}
                            />
                        </Field>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => setCreating(false)}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" variant="solid" loading={busy}>
                            Crear
                        </Button>
                    </div>
                </form>
            </Dialog>

            {/* Editar */}
            <Dialog
                isOpen={Boolean(editing)}
                onClose={() => setEditing(null)}
                onRequestClose={() => setEditing(null)}
                title={editing ? `Editar ${editing.name}` : 'Editar tenant'}
            >
                <form onSubmit={submitEdit} className="space-y-4">
                    <Field label="Nombre">
                        <Input
                            value={eName}
                            onChange={(e) => setEName(e.target.value)}
                            required
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Estado">
                            <Select
                                options={STATUS_OPTS}
                                value={STATUS_OPTS.find(
                                    (o) => o.value === eStatus,
                                )}
                                onChange={(o) =>
                                    setEStatus(
                                        (o?.value as TenantStatus) ?? 'active',
                                    )
                                }
                            />
                        </Field>
                        <Field label="LoA requerido">
                            <Select
                                options={LOA_OPTS}
                                value={LOA_OPTS.find(
                                    (o) => o.value === eAssurance,
                                )}
                                onChange={(o) => setEAssurance(o?.value ?? 'L2')}
                            />
                        </Field>
                    </div>
                    <Field label="Retención (días)">
                        <Input
                            type="number"
                            value={eRetention}
                            onChange={(e) => setERetention(e.target.value)}
                        />
                    </Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => setEditing(null)}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" variant="solid" loading={busy}>
                            Guardar
                        </Button>
                    </div>
                </form>
            </Dialog>

            {/* Detail */}
            <Dialog
                isOpen={Boolean(detailTenant)}
                onClose={() => setDetailTenant(null)}
                onRequestClose={() => setDetailTenant(null)}
                title={detailTenant ? detailTenant.name : ''}
                footer={
                    <div className="flex justify-end gap-2">
                        <Button variant="default" onClick={() => setDetailTenant(null)}>
                            Cerrar
                        </Button>
                        {detailTenant && (
                            <Button variant="solid" onClick={() => { setEditing(detailTenant); setDetailTenant(null); }}>
                                Editar
                            </Button>
                        )}
                    </div>
                }
            >
                {detailTenant && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-gray-400">Slug</label>
                                <div className="font-mono text-sm">{detailTenant.slug}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Estado</label>
                                <div>{statusBadge(detailTenant.status)}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">LoA Requerido</label>
                                <div className="font-mono">
                                    <Badge variant="solid" color="primary">
                                        {detailTenant.policies?.assuranceRequired ?? '—'}
                                    </Badge>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Retención</label>
                                <div>{detailTenant.policies?.retentionDays ?? 90} días</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">Creado</label>
                                <div>{fmtDate(detailTenant.createdAt)}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400">ID</label>
                                <div className="font-mono text-xs">{detailTenant.id}</div>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-gray-400">Branding</label>
                            <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs">
                                {JSON.stringify(detailTenant.branding || {}, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}
            </Dialog>
        </div>
    )
}

export default TenantsView
