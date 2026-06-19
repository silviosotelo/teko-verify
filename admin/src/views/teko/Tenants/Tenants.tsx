import { useEffect, useMemo, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import DataTable from '@/components/shared/DataTable'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { Tenant, TenantStatus } from '@/teko/types'
import type { ColumnDef } from '@/components/shared/DataTable'
import { PiPlus, PiPencilSimpleLine, PiEye } from 'react-icons/pi'

const LOA_OPTS = ['L1', 'L2', 'L3', 'L4'].map((l) => ({ value: l, label: l }))
const STATUS_OPTS: { value: TenantStatus; label: string }[] = [
    { value: 'active', label: 'Activo' },
    { value: 'suspended', label: 'Suspendido' },
    { value: 'disabled', label: 'Deshabilitado' },
]

function statusBadge(s: TenantStatus) {
    const color = s === 'active' ? 'success' : s === 'suspended' ? 'warning' : 'danger'
    return <Badge variant="solid" color={color}>{s}</Badge>
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
        <label className="mb-1 block text-sm font-medium text-gray-600">{label}</label>
        {children}
    </div>
)

const TenantsView = () => {
    const { currentId, tenants, reload, loading } = useTenant()
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [editing, setEditing] = useState<Tenant | null>(null)
    const [busy, setBusy] = useState(false)
    const [detailTenant, setDetailTenant] = useState<Tenant | null>(null)
    const [showAll, setShowAll] = useState(false)

    const [tableData, setTableData] = useState({
        pageIndex: 1,
        pageSize: 10,
        total: 0,
        sort: { order: '' as 'asc' | 'desc' | '', key: '' as string | number },
    })

    const [name, setName] = useState('')
    const [slug, setSlug] = useState('')
    const [assurance, setAssurance] = useState('L2')
    const [retention, setRetention] = useState('90')

    const resetCreate = () => { setName(''); setSlug(''); setAssurance('L2'); setRetention('90') }

    const submitCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
            await tekoApi.createTenant({
                name, slug,
                policies: { assuranceRequired: assurance as Tenant['policies']['assuranceRequired'], retentionDays: parseInt(retention, 10) || 90 },
            })
            setCreating(false)
            resetCreate()
            await reload()
        } catch (e) {
            setError((e as Error).message)
        } finally { setBusy(false) }
    }

    const [eName, setEName] = useState('')
    const [eStatus, setEStatus] = useState<TenantStatus>('active')
    const [eAssurance, setEAssurance] = useState('L2')
    const [eRetention, setERetention] = useState('90')

    useEffect(() => {
        if (editing) {
            setEName(editing.name); setEStatus(editing.status)
            setEAssurance(editing.policies?.assuranceRequired ?? 'L2')
            setERetention(String(editing.policies?.retentionDays ?? 90))
        }
    }, [editing])

    const submitEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editing) return
        setBusy(true)
        setError(null)
        try {
            await tekoApi.updateTenant(editing.id, {
                name: eName, status: eStatus,
                policies: { assuranceRequired: eAssurance as Tenant['policies']['assuranceRequired'], retentionDays: parseInt(eRetention, 10) || 90 },
            })
            setEditing(null)
            await reload()
        } catch (e) {
            setError((e as Error).message)
        } finally { setBusy(false) }
    }

    const sortedData = useMemo(() => {
        const sorted = [...tenants]
        const { key, order } = tableData.sort
        if (key && order) {
            sorted.sort((a, b) => {
                const va = String((a as Record<string, unknown>)[key as string] ?? '')
                const vb = String((b as Record<string, unknown>)[key as string] ?? '')
                return order === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
            })
        }
        return sorted
    }, [tenants, tableData.sort])

    const paginatedData = useMemo(() => {
        const { pageIndex, pageSize } = tableData
        const start = (pageIndex - 1) * pageSize
        return sortedData.slice(start, start + pageSize)
    }, [sortedData, tableData.pageIndex, tableData.pageSize])

    useEffect(() => {
        setTableData(prev => ({ ...prev, total: tenants.length }))
    }, [tenants.length])

    const columns: ColumnDef<Tenant>[] = [
        { header: 'Nombre', accessorKey: 'name', cell: (c) => <span className="font-medium heading-text">{c.getValue() as string}</span> },
        { header: 'Slug', accessorKey: 'slug', cell: (c) => <span className="font-mono text-xs text-gray-500">{c.getValue() as string}</span> },
        { header: 'Estado', accessorKey: 'status', cell: (c) => statusBadge(c.getValue() as TenantStatus) },
        { header: 'LoA', accessorKey: 'policies.assuranceRequired', id: 'loa', cell: (c) => <Badge variant="solid" color="primary">{(c.row.original.policies?.assuranceRequired ?? '—')}</Badge> },
        { header: 'Retención', accessorKey: 'policies.retentionDays', id: 'retention', cell: (c) => `${c.row.original.policies?.retentionDays ?? 90} días` },
        { header: 'Creado', accessorKey: 'createdAt', cell: (c) => <span className="text-gray-500 whitespace-nowrap">{fmtDate(c.getValue() as string)}</span> },
        {
            header: '', id: 'action',
            cell: (c) => (
                <div className="flex gap-1">
                    <Button size="xs" variant="ghost" className="h-7 w-7 p-0" title="Ver detalle"
                        onClick={() => setDetailTenant(c.row.original)}><PiEye /></Button>
                    <Button size="xs" variant="ghost" className="h-7 w-7 p-0" title="Editar"
                        onClick={() => setEditing(c.row.original)}><PiPencilSimpleLine /></Button>
                </div>
            ),
        },
    ]

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div><h3 className="mb-1">Tenants</h3><p className="text-gray-500">Organizaciones consumidoras de Teko Verify</p></div>
                <Button variant="solid" icon={<PiPlus />} onClick={() => setCreating(true)}>Nuevo tenant</Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card><span className="text-sm text-gray-500">Total</span><div className="text-3xl font-bold">{tenants.length}</div></Card>
                <Card><span className="text-sm text-gray-500">Activos</span><div className="text-3xl font-bold text-success">{tenants.filter(t => t.status === 'active').length}</div></Card>
                <Card><span className="text-sm text-gray-500">Suspendidos</span><div className="text-3xl font-bold text-danger">{tenants.filter(t => t.status === 'suspended').length}</div></Card>
                <Card><span className="text-sm text-gray-500">LoA mín.</span><div className="text-3xl font-bold">{Math.min(...tenants.map(t => parseInt(t.policies?.assuranceRequired?.replace('L', '') || '1'))) || '—'}</div></Card>
            </div>

            {error && <Alert showIcon className="mb-4" type="danger">{error}</Alert>}

            <Card bodyClass="p-0">
                <DataTable
                    columns={columns}
                    data={paginatedData}
                    loading={loading}
                    pagingData={{
                        total: tableData.total,
                        pageIndex: tableData.pageIndex,
                        pageSize: tableData.pageSize,
                    }}
                    onPaginationChange={(page) => setTableData(prev => ({ ...prev, pageIndex: page }))}
                    onSelectChange={(size) => setTableData(prev => ({ ...prev, pageSize: size, pageIndex: 1 }))}
                    onSort={({ order, key }) => setTableData(prev => ({ ...prev, sort: { order, key }, pageIndex: 1 }))}
                />
            </Card>

            <Dialog isOpen={creating} onClose={() => setCreating(false)} title="Nuevo tenant">
                <form onSubmit={submitCreate} className="space-y-4">
                    <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
                    <Field label="Slug"><Input value={slug} placeholder="mi-empresa" onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} required /></Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="LoA requerido"><Select options={LOA_OPTS} value={LOA_OPTS.find(o => o.value === assurance)} onChange={(o) => setAssurance(o?.value ?? 'L2')} /></Field>
                        <Field label="Retención (días)"><Input type="number" value={retention} onChange={(e) => setRetention(e.target.value)} /></Field>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="default" onClick={() => setCreating(false)}>Cancelar</Button>
                        <Button type="submit" variant="solid" loading={busy}>Crear</Button>
                    </div>
                </form>
            </Dialog>

            <Dialog isOpen={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `Editar ${editing.name}` : ''}>
                <form onSubmit={submitEdit} className="space-y-4">
                    <Field label="Nombre"><Input value={eName} onChange={(e) => setEName(e.target.value)} required /></Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Estado"><Select options={STATUS_OPTS} value={STATUS_OPTS.find(o => o.value === eStatus)} onChange={(o) => setEStatus((o?.value as TenantStatus) ?? 'active')} /></Field>
                        <Field label="LoA"><Select options={LOA_OPTS} value={LOA_OPTS.find(o => o.value === eAssurance)} onChange={(o) => setEAssurance(o?.value ?? 'L2')} /></Field>
                    </div>
                    <Field label="Retención"><Input type="number" value={eRetention} onChange={(e) => setERetention(e.target.value)} /></Field>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="default" onClick={() => setEditing(null)}>Cancelar</Button>
                        <Button type="submit" variant="solid" loading={busy}>Guardar</Button>
                    </div>
                </form>
            </Dialog>

            <Dialog isOpen={Boolean(detailTenant)} onClose={() => setDetailTenant(null)} width={520}
                footer={<div className="flex justify-end gap-2">
                    <Button variant="default" onClick={() => setDetailTenant(null)}>Cerrar</Button>
                    {detailTenant && <Button variant="solid" onClick={() => { setEditing(detailTenant); setDetailTenant(null) }}>Editar</Button>}
                </div>}
            >
                {detailTenant && <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        {[
                            ['Slug', detailTenant.slug, 'font-mono text-sm'],
                            ['Estado', statusBadge(detailTenant.status), ''],
                            ['LoA', <Badge variant="solid" color="primary">{detailTenant.policies?.assuranceRequired ?? '—'}</Badge>, ''],
                            ['Retención', `${detailTenant.policies?.retentionDays ?? 90} días`, ''],
                            ['Creado', fmtDate(detailTenant.createdAt), ''],
                            ['ID', detailTenant.id, 'font-mono text-xs'],
                        ].map(([label, value, cls]) => (
                            <div key={label as string}>
                                <div className="text-xs text-gray-400">{label as string}</div>
                                <div className={cls as string}>{value as React.ReactNode}</div>
                            </div>
                        ))}
                    </div>
                    <div>
                        <div className="text-xs text-gray-400">Branding</div>
                        <pre className="mt-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs">{JSON.stringify(detailTenant.branding || {}, null, 2)}</pre>
                    </div>
                </div>}
            </Dialog>
        </div>
    )
}

export default TenantsView