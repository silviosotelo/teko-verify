// Workflows (P0 #1): definición versionada de checks/umbrales/revisión por tenant.
// Lista los workflows (agrupados por nombre, versión vigente) y permite ver/editar la
// definición JSON. Editar crea una NUEVA versión (el backend versiona). También crea
// workflows nuevos. Editor JSON simple (no editor-grafo) — suficiente para v1.
import { useEffect, useMemo, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Table from '@/components/ui/Table'
import Tag from '@/components/ui/Tag'
import Notification from '@/components/ui/Notification'
import toast from '@/components/ui/toast'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { LoaBadge } from '@/teko/badges'
import { fmtDate } from '@/teko/format'
import type { Workflow, WorkflowDefinition } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

// Plantilla por defecto para un workflow nuevo (L2 con revisión automática).
const TEMPLATE: WorkflowDefinition = {
    document: { required: true },
    match: { required: true, threshold: 0.4 },
    quality: {},
    review: { mode: 'auto' },
}

function notify(msg: string, type: 'success' | 'danger' = 'success') {
    toast.push(
        <Notification title="Workflows" type={type}>
            {msg}
        </Notification>,
        { placement: 'top-center' },
    )
}

const textareaCls =
    'h-72 w-full rounded-lg border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

const WorkflowsView = () => {
    const { currentId, current, loading: tLoading } = useTenant()
    const [all, setAll] = useState<Workflow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    // Editor (ver/editar una versión → guarda como nueva versión).
    const [editing, setEditing] = useState<Workflow | null>(null)
    const [json, setJson] = useState('')
    const [jsonError, setJsonError] = useState<string | null>(null)

    // Crear nuevo.
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newJson, setNewJson] = useState(JSON.stringify(TEMPLATE, null, 2))

    const load = () => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .listWorkflows(currentId)
            .then((r) => setAll(r.workflows))
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId])

    // Versión vigente (mayor) por nombre — el backend ya devuelve name asc, version desc.
    const currentVersions = useMemo(() => {
        const seen = new Set<string>()
        const out: Workflow[] = []
        for (const w of all) {
            if (!seen.has(w.name)) {
                seen.add(w.name)
                out.push(w)
            }
        }
        return out
    }, [all])

    function openEdit(w: Workflow) {
        setEditing(w)
        setJson(JSON.stringify(w.definition, null, 2))
        setJsonError(null)
    }

    async function saveEdit() {
        if (!editing || !currentId) return
        let def: WorkflowDefinition
        try {
            def = JSON.parse(json)
        } catch (e) {
            setJsonError('JSON inválido: ' + (e as Error).message)
            return
        }
        setBusy(true)
        try {
            await tekoApi.updateWorkflow(currentId, editing.name, def)
            notify(`Workflow "${editing.name}" guardado como nueva versión.`)
            setEditing(null)
            load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function submitCreate() {
        if (!currentId) return
        const name = newName.trim()
        if (!name) {
            setError('El nombre es obligatorio.')
            return
        }
        let def: WorkflowDefinition
        try {
            def = JSON.parse(newJson)
        } catch (e) {
            setError('JSON inválido: ' + (e as Error).message)
            return
        }
        setBusy(true)
        try {
            await tekoApi.createWorkflow(currentId, { name, definition: def })
            notify(`Workflow "${name}" creado.`)
            setCreating(false)
            setNewName('')
            setNewJson(JSON.stringify(TEMPLATE, null, 2))
            load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
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
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Workflows</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Definiciones de verificación de ${current.name}`
                            : 'Definiciones de verificación del tenant'}
                    </p>
                </div>
                <Button variant="solid" onClick={() => setCreating(true)}>
                    Nuevo workflow
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
                ) : currentVersions.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay workflows.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Nombre</Th>
                                <Th>Versión</Th>
                                <Th>LoA equiv.</Th>
                                <Th>Revisión</Th>
                                <Th>Default</Th>
                                <Th>Actualizado</Th>
                                <Th />
                            </Tr>
                        </THead>
                        <TBody>
                            {currentVersions.map((w) => (
                                <Tr key={w.id}>
                                    <Td className="font-medium heading-text">
                                        {w.name}
                                    </Td>
                                    <Td className="font-mono text-gray-500">
                                        v{w.version}
                                    </Td>
                                    <Td>
                                        <LoaBadge loa={w.assuranceLevel} />
                                    </Td>
                                    <Td className="text-xs text-gray-500">
                                        {w.definition.review?.mode ?? 'auto'}
                                    </Td>
                                    <Td>
                                        {w.isDefault ? (
                                            <Tag className="border-0 bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-100">
                                                default
                                            </Tag>
                                        ) : (
                                            <span className="text-gray-300">
                                                —
                                            </span>
                                        )}
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(w.updatedAt)}
                                    </Td>
                                    <Td className="text-right">
                                        <Button
                                            size="xs"
                                            variant="default"
                                            onClick={() => openEdit(w)}
                                        >
                                            Ver / editar
                                        </Button>
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>

            {/* Editar = nueva versión */}
            <Dialog
                isOpen={Boolean(editing)}
                onClose={() => setEditing(null)}
                onRequestClose={() => setEditing(null)}
                width={640}
            >
                <h5 className="mb-1">
                    {editing ? `Editar ${editing.name}` : 'Editar workflow'}
                </h5>
                <p className="mb-4 text-xs text-gray-400">
                    Guardar crea una nueva versión (v
                    {editing ? editing.version + 1 : '?'}). Las sesiones existentes
                    conservan la versión que snapshotearon.
                </p>
                <textarea
                    className={textareaCls}
                    value={json}
                    onChange={(e) => setJson(e.target.value)}
                    spellCheck={false}
                />
                {jsonError && (
                    <Alert showIcon className="mt-2" type="danger">
                        {jsonError}
                    </Alert>
                )}
                <div className="mt-4 flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="default"
                        onClick={() => setEditing(null)}
                    >
                        Cancelar
                    </Button>
                    <Button variant="solid" loading={busy} onClick={saveEdit}>
                        Guardar nueva versión
                    </Button>
                </div>
            </Dialog>

            {/* Crear nuevo */}
            <Dialog
                isOpen={creating}
                onClose={() => setCreating(false)}
                onRequestClose={() => setCreating(false)}
                width={640}
            >
                <h5 className="mb-4">Nuevo workflow</h5>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre
                        </label>
                        <Input
                            value={newName}
                            placeholder="ej: onboarding-premium"
                            onChange={(e) => setNewName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Definición (JSON)
                        </label>
                        <textarea
                            className={textareaCls}
                            value={newJson}
                            onChange={(e) => setNewJson(e.target.value)}
                            spellCheck={false}
                        />
                    </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="default"
                        onClick={() => setCreating(false)}
                    >
                        Cancelar
                    </Button>
                    <Button variant="solid" loading={busy} onClick={submitCreate}>
                        Crear
                    </Button>
                </div>
            </Dialog>
        </div>
    )
}

export default WorkflowsView
