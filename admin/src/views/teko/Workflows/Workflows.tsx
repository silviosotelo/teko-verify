import { useEffect, useMemo, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Switcher from '@/components/ui/Switcher'
import Badge from '@/components/ui/Badge'
import Tag from '@/components/ui/Tag'
import Tabs from '@/components/ui/Tabs'
import Notification from '@/components/ui/Notification'
import toast from '@/components/ui/toast'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { LoaBadge } from '@/teko/badges'
import { fmtDate } from '@/teko/format'
import type { Workflow, WorkflowDefinition } from '@/teko/types'
import { PiPlus, PiPencil, PiCheck, PiCopy, PiArrowUp, PiArrowDown } from 'react-icons/pi'

type CheckUIEntry = {
    key: string
    label: string
    enabled: boolean
    order: number
    config: Record<string, unknown>
}

const CHECK_META: Array<{ key: string; label: string }> = [
    { key: 'quality',          label: 'Calidad de imagen' },
    { key: 'liveness',         label: 'Prueba de vida' },
    { key: 'document',         label: 'Documento de identidad' },
    { key: 'match',            label: 'Match 1:1 selfie/doc' },
    { key: 'aml',              label: 'Screening AML/PEP' },
    { key: 'face_search',      label: 'Búsqueda facial 1:N' },
    { key: 'proof_of_address', label: 'Comprobante de domicilio' },
    { key: 'age_estimation',   label: 'Estimación de edad' },
]

const MODE_OPTS = [
    { value: 'auto', label: 'Automática' },
    { value: 'always', label: 'Siempre revisión' },
    { value: 'on_borderline', label: 'En frontera' },
]

const LOA_OPTS = [
    { value: 'L1', label: 'L1 - Solo documento' },
    { value: 'L2', label: 'L2 - Documento + Match' },
    { value: 'L3', label: 'L3 - Documento + Match + Liveness' },
    { value: 'L4', label: 'L4 - Todos los checks' },
]

const LIVENESS_MODE_OPTS = [
    { value: 'passive', label: 'Pasivo (fotos)' },
    { value: 'active', label: 'Activo (video)' },
]

const AML_ONMATCH_OPTS = [
    { value: 'review', label: 'Enviar a revisión' },
    { value: 'flag', label: 'Solo marcar' },
]

function defaultDef(loa: string): WorkflowDefinition {
    const def: WorkflowDefinition = { document: { required: true } }
    if (loa >= 'L2') { def.match = { required: true, threshold: 0.4 } }
    if (loa >= 'L3') { def.liveness = { required: true, mode: 'passive' } }
    def.review = { mode: 'auto' }
    return def
}

function getLoa(def: WorkflowDefinition): string {
    if (def.liveness?.required) return 'L3'
    if (def.match?.required) return 'L2'
    return 'L1'
}

const WorkflowsView = () => {
    const { currentId, current, loading: tLoading } = useTenant()
    const [all, setAll] = useState<Workflow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const [editing, setEditing] = useState<Workflow | null>(null)
    const [editingLoa, setEditingLoa] = useState('L2')
    const [editingDocument, setEditingDocument] = useState(true)
    const [editingMatch, setEditingMatch] = useState(true)
    const [editingMatchThreshold, setEditingMatchThreshold] = useState('0.40')
    const [editingLiveness, setEditingLiveness] = useState(false)
    const [editingLivenessMode, setEditingLivenessMode] = useState('passive')
    const [editingAml, setEditingAml] = useState(false)
    const [editingAmlOnMatch, setEditingAmlOnMatch] = useState('review')
    const [editingReview, setEditingReview] = useState('auto')
    const [pipelineChecks, setPipelineChecks] = useState<CheckUIEntry[]>([])

    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newLoa, setNewLoa] = useState('L2')

    const latestByName = useMemo(() => {
        const map = new Map<string, Workflow>()
        for (const w of all) {
            const prev = map.get(w.name)
            if (!prev || w.version > prev.version) map.set(w.name, w)
        }
        return Array.from(map.values())
    }, [all])

    async function load() {
        if (!currentId) return
        setLoading(true)
        setError(null)
        try {
            const { workflows } = await tekoApi.listWorkflows(currentId)
            setAll(workflows)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [currentId])

    const openEdit = (w: Workflow) => {
        setEditing(w)
        const d = w.definition
        setEditingLoa(getLoa(d))
        setEditingDocument(true)
        setEditingMatch(d.match?.required ?? false)
        setEditingMatchThreshold(String(d.match?.threshold ?? 0.4))
        setEditingLiveness(d.liveness?.required ?? false)
        setEditingLivenessMode(d.liveness?.mode ?? 'passive')
        setEditingAml(d.aml?.required ?? false)
        setEditingAmlOnMatch(d.aml?.onMatch ?? 'review')
        setEditingReview(d.review?.mode ?? 'auto')

        const existingPipeline = d.pipeline?.checks ?? []
        const initialChecks = CHECK_META.map((m, i) => {
            const existing = existingPipeline.find(e => e.key === m.key)
            return {
                key: m.key,
                label: m.label,
                enabled: existing ? existing.enabled : ['quality', 'document'].includes(m.key),
                order: existing?.order ?? i,
                config: existing?.config ?? {},
            }
        }).sort((a, b) => a.order - b.order)
        setPipelineChecks(initialChecks)
    }

    const buildDef = (): WorkflowDefinition => {
        const pipelineField = pipelineChecks.length > 0
            ? { checks: pipelineChecks.map((c, i) => ({ key: c.key, enabled: c.enabled, order: i, config: c.config })) }
            : undefined
        return {
            document: { required: editingDocument },
            match: editingMatch ? { required: true, threshold: parseFloat(editingMatchThreshold) || 0.4 } : undefined,
            liveness: editingLiveness ? { required: true, mode: editingLivenessMode as 'passive' | 'active' } : undefined,
            aml: editingAml ? { required: true, onMatch: editingAmlOnMatch as 'review' | 'flag' } : undefined,
            review: { mode: editingReview as 'auto' | 'always' | 'on_borderline' },
            pipeline: pipelineField,
        }
    }

    const handleSave = async () => {
        if (!currentId || !editing) return
        setBusy(true)
        try {
            const def = buildDef()
            await tekoApi.updateWorkflow(currentId, editing.name, def)
            toast.push(<Notification title="Workflow" type="success">Nueva versión creada</Notification>, { placement: 'top-center' })
            setEditing(null)
            load()
        } catch (e) {
            toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
        } finally {
            setBusy(false)
        }
    }

    const handleCreate = async () => {
        if (!currentId || !newName.trim()) return
        setBusy(true)
        try {
            await tekoApi.createWorkflow(currentId, {
                name: newName.trim(),
                definition: defaultDef(newLoa),
            })
            toast.push(<Notification title="Workflow" type="success">Creado</Notification>, { placement: 'top-center' })
            setCreating(false)
            setNewName('')
            setNewLoa('L2')
            load()
        } catch (e) {
            toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
        } finally {
            setBusy(false)
        }
    }

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold">Workflows</h3>
                    <p className="text-sm text-gray-500 mt-1">Define los flujos de verificación con sus checks y umbrales</p>
                </div>
                <Button variant="solid" icon={<PiPlus />} onClick={() => setCreating(true)}>Nuevo workflow</Button>
            </div>

            {error && <Alert showIcon type="danger">{error}</Alert>}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {loading ? (
                    <div className="col-span-full flex justify-center p-8"><Spinner size={40} /></div>
                ) : latestByName.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-gray-400">
                        <PiCopy className="mx-auto mb-2 text-4xl" />
                        <p>No hay workflows. Creá el primero.</p>
                    </div>
                ) : latestByName.map((w) => {
                    const d = w.definition
                    const checks = []
                    if (d.document?.required) checks.push('Documento')
                    if (d.match?.required) checks.push('Match')
                    if (d.liveness?.required) checks.push('Liveness')
                    if (d.aml?.required) checks.push('AML')
                    return (
                        <Card key={w.name} className="hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <h5 className="font-semibold">{w.name}</h5>
                                    <div className="flex items-center gap-2 mt-1">
                                        <LoaBadge loa={getLoa(d)} />
                                        <span className="text-xs text-gray-400">v{w.version}</span>
                                        {w.isDefault && <Badge variant="solid" color="primary" className="text-[10px]">Default</Badge>}
                                    </div>
                                </div>
                                <Button size="xs" variant="plain" icon={<PiPencil />} onClick={() => openEdit(w)} />
                            </div>
                            <div className="flex flex-wrap gap-1.5 mb-3">
                                {checks.map(c => (
                                    <Tag key={c} className="text-xs bg-primary/10 text-primary font-medium">{c}</Tag>
                                ))}
                            </div>
                            <div className="flex items-center justify-between text-xs text-gray-400">
                                <span>Creado: {fmtDate(w.createdAt)}</span>
                                <span>{d.review?.mode === 'auto' ? 'Revisión automática' : d.review?.mode === 'always' ? 'Revisión manual' : 'Borderline'}</span>
                            </div>
                        </Card>
                    )
                })}
            </div>

            <Dialog isOpen={Boolean(editing)} onClose={() => setEditing(null)} width={640}>
                <h5 className="font-semibold mb-4">Editar: {editing?.name}</h5>
                {(() => {
                    const { TabList, TabNav, TabContent } = Tabs
                    return (
                        <Tabs defaultValue="config">
                            <TabList>
                                <TabNav value="config">Configuración</TabNav>
                                <TabNav value="pipeline">Pipeline</TabNav>
                            </TabList>
                            <div className="mt-4">
                                <TabContent value="config">
                                    <div className="space-y-5">
                                        <div>
                                            <h6 className="text-sm font-medium mb-3">Checks requeridos</h6>
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between py-2 border-b">
                                                    <span className="text-sm">Documento</span>
                                                    <Switcher checked={editingDocument} disabled />
                                                </div>
                                                <div className="flex items-center justify-between py-2 border-b">
                                                    <span className="text-sm">Match facial</span>
                                                    <Switcher checked={editingMatch} onChange={setEditingMatch} />
                                                </div>
                                                {editingMatch && (
                                                    <div className="pl-4">
                                                        <label className="text-xs text-gray-400 block mb-1">Umbral de similitud</label>
                                                        <Input type="number" step="0.01" min="0" max="1" value={editingMatchThreshold} onChange={(e) => setEditingMatchThreshold(e.target.value)} className="w-32" />
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between py-2 border-b">
                                                    <span className="text-sm">Liveness / anti-spoofing</span>
                                                    <Switcher checked={editingLiveness} onChange={setEditingLiveness} />
                                                </div>
                                                {editingLiveness && (
                                                    <div className="pl-4">
                                                        <label className="text-xs text-gray-400 block mb-1">Modo</label>
                                                        <Select
                                                            size="sm"
                                                            options={LIVENESS_MODE_OPTS}
                                                            value={LIVENESS_MODE_OPTS.find((o) => o.value === editingLivenessMode) ?? null}
                                                            onChange={(o) => setEditingLivenessMode(o?.value ?? 'passive')}
                                                        />
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between py-2 border-b">
                                                    <span className="text-sm">AML / screening</span>
                                                    <Switcher checked={editingAml} onChange={setEditingAml} />
                                                </div>
                                                {editingAml && (
                                                    <div className="pl-4">
                                                        <label className="text-xs text-gray-400 block mb-1">Al accionar</label>
                                                        <Select
                                                            size="sm"
                                                            options={AML_ONMATCH_OPTS}
                                                            value={AML_ONMATCH_OPTS.find((o) => o.value === editingAmlOnMatch) ?? null}
                                                            onChange={(o) => setEditingAmlOnMatch(o?.value ?? 'review')}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div>
                                            <h6 className="text-sm font-medium mb-2">Modo de revisión</h6>
                                            <Select
                                                options={MODE_OPTS}
                                                value={MODE_OPTS.find((m) => m.value === editingReview) ?? null}
                                                onChange={(o) => setEditingReview(o?.value ?? 'auto')}
                                            />
                                        </div>
                                    </div>
                                </TabContent>
                                <TabContent value="pipeline">
                                    <div className="space-y-2">
                                        <p className="text-sm text-gray-500 mb-3">
                                            Activá, desactivá o reordenás los checks del pipeline para este workflow.
                                            El orden de ejecución real está fijo por dependencias de datos; el número
                                            de posición se usa en el editor.
                                        </p>
                                        {pipelineChecks.map((check, idx) => (
                                            <Card key={check.key} className="p-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex flex-col gap-1">
                                                        <Button
                                                            size="xs"
                                                            variant="plain"
                                                            disabled={idx === 0}
                                                            icon={<PiArrowUp />}
                                                            onClick={() => {
                                                                const next = [...pipelineChecks]
                                                                ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                                                                setPipelineChecks(next)
                                                            }}
                                                        />
                                                        <Button
                                                            size="xs"
                                                            variant="plain"
                                                            disabled={idx === pipelineChecks.length - 1}
                                                            icon={<PiArrowDown />}
                                                            onClick={() => {
                                                                const next = [...pipelineChecks]
                                                                ;[next[idx + 1], next[idx]] = [next[idx], next[idx + 1]]
                                                                setPipelineChecks(next)
                                                            }}
                                                        />
                                                    </div>
                                                    <Switcher
                                                        checked={check.enabled}
                                                        onChange={(val: boolean) => {
                                                            const next = [...pipelineChecks]
                                                            next[idx] = { ...next[idx], enabled: val }
                                                            setPipelineChecks(next)
                                                        }}
                                                    />
                                                    <div className="flex-1">
                                                        <span className="font-medium text-sm">{check.label}</span>
                                                        <span className="ml-2 text-xs text-gray-400">{check.key}</span>
                                                    </div>
                                                    {['liveness', 'match', 'aml', 'face_search'].includes(check.key) && (
                                                        <Input
                                                            size="sm"
                                                            placeholder="threshold"
                                                            className="w-28"
                                                            value={String(check.config?.threshold ?? '')}
                                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                                                const val = e.target.value
                                                                const next = [...pipelineChecks]
                                                                next[idx] = {
                                                                    ...next[idx],
                                                                    config: { ...next[idx].config, threshold: val ? Number(val) : undefined },
                                                                }
                                                                setPipelineChecks(next)
                                                            }}
                                                        />
                                                    )}
                                                    {check.key === 'age_estimation' && (
                                                        <Input
                                                            size="sm"
                                                            placeholder="minAge"
                                                            className="w-24"
                                                            value={String(check.config?.minAge ?? '')}
                                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                                                const val = e.target.value
                                                                const next = [...pipelineChecks]
                                                                next[idx] = {
                                                                    ...next[idx],
                                                                    config: { ...next[idx].config, minAge: val ? Number(val) : undefined },
                                                                }
                                                                setPipelineChecks(next)
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                    <div className="mt-3 text-sm text-gray-500">
                                        LoA efectivo:{' '}
                                        <strong>
                                            {pipelineChecks.find(c => c.key === 'liveness' && c.enabled) ? 'L3'
                                                : pipelineChecks.find(c => c.key === 'match' && c.enabled) ? 'L2'
                                                : 'L1'}
                                        </strong>
                                        {' '}(derivado de checks activos)
                                    </div>
                                </TabContent>
                            </div>
                        </Tabs>
                    )
                })()}
                <div className="mt-6 flex justify-end gap-2">
                    <Button variant="default" onClick={() => setEditing(null)}>Cancelar</Button>
                    <Button variant="solid" loading={busy} icon={<PiCheck />} onClick={handleSave}>Guardar como nueva versión</Button>
                </div>
            </Dialog>

            <Dialog isOpen={creating} onClose={() => setCreating(false)} width={480}>
                <h5 className="font-semibold mb-4">Nuevo workflow</h5>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium">Nombre</label>
                        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ej: verificación-estándar" required />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">Nivel de aseguramiento</label>
                        <Select
                            options={LOA_OPTS}
                            value={LOA_OPTS.find((o) => o.value === newLoa) ?? null}
                            onChange={(o) => setNewLoa(o?.value ?? 'L2')}
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-2">
                    <Button variant="default" onClick={() => setCreating(false)}>Cancelar</Button>
                    <Button variant="solid" loading={busy} onClick={handleCreate}>Crear</Button>
                </div>
            </Dialog>
        </div>
    )
}

export default WorkflowsView