import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Table from '@/components/ui/Table'
import Tag from '@/components/ui/Tag'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { Tenant, TenantStatus } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

const LOA_OPTS = ['L1', 'L2', 'L3'].map((l) => ({ value: l, label: l }))
const STATUS_OPTS: { value: TenantStatus; label: string }[] = [
    { value: 'active', label: 'active' },
    { value: 'suspended', label: 'suspended' },
    { value: 'disabled', label: 'disabled' },
]

function statusTag(s: TenantStatus) {
    const cls =
        s === 'active'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
            : s === 'suspended'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100'
              : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100'
    return <Tag className={`border-0 ${cls}`}>{s}</Tag>
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
    const { tenants, reload, loading } = useTenant()
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [editing, setEditing] = useState<Tenant | null>(null)
    const [busy, setBusy] = useState(false)

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

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Tenants</h3>
                    <p className="text-gray-500">
                        Organizaciones consumidoras de Teko Verify
                    </p>
                </div>
                <Button variant="solid" onClick={() => setCreating(true)}>
                    Nuevo tenant
                </Button>
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
                        No hay tenants.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Nombre</Th>
                                <Th>Slug</Th>
                                <Th>Estado</Th>
                                <Th>LoA</Th>
                                <Th>Creado</Th>
                                <Th />
                            </Tr>
                        </THead>
                        <TBody>
                            {tenants.map((t) => (
                                <Tr key={t.id}>
                                    <Td className="font-medium heading-text">
                                        {t.name}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-500">
                                        {t.slug}
                                    </Td>
                                    <Td>{statusTag(t.status)}</Td>
                                    <Td className="font-mono">
                                        {t.policies?.assuranceRequired ?? '—'}
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(t.createdAt)}
                                    </Td>
                                    <Td className="text-right">
                                        <Button
                                            size="xs"
                                            variant="default"
                                            onClick={() => setEditing(t)}
                                        >
                                            Editar
                                        </Button>
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
            >
                <h5 className="mb-4">Nuevo tenant</h5>
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
            >
                <h5 className="mb-4">
                    {editing ? `Editar ${editing.name}` : 'Editar tenant'}
                </h5>
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
        </div>
    )
}

export default TenantsView
