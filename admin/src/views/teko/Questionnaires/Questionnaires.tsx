// Questionnaires (P2): formularios custom por tenant que un workflow puede incluir.
// Lista los cuestionarios y permite ver/editar el set de preguntas (JSON). Editar
// bumpea la versión (el backend versiona). También crea cuestionarios nuevos. Para
// ligar uno a un workflow, copiá su id en la def del workflow:
// `"questionnaire": { "questionnaireId": "<id>" }`.
import { useEffect, useState } from 'react'
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
import { fmtDate } from '@/teko/format'
import type { Questionnaire, QuestionnaireQuestion } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

// Plantilla por defecto para un cuestionario nuevo (preguntas KYC típicas).
const TEMPLATE: QuestionnaireQuestion[] = [
    { id: 'occupation', label: 'Ocupación', type: 'text', required: true },
    {
        id: 'source_of_funds',
        label: 'Origen de fondos',
        type: 'select',
        options: ['Salario', 'Negocio propio', 'Inversiones', 'Otro'],
        required: true,
    },
    {
        id: 'pep',
        label: '¿Sos una Persona Expuesta Políticamente (PEP)?',
        type: 'checkbox',
        required: false,
    },
]

function notify(msg: string, type: 'success' | 'danger' = 'success') {
    toast.push(
        <Notification title="Cuestionarios" type={type}>
            {msg}
        </Notification>,
        { placement: 'top-center' },
    )
}

const textareaCls =
    'h-72 w-full rounded-lg border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

function parseQuestions(text: string): QuestionnaireQuestion[] {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('Debe ser un array de preguntas.')
    return parsed as QuestionnaireQuestion[]
}

const QuestionnairesView = () => {
    const { currentId, current, loading: tLoading } = useTenant()
    const [all, setAll] = useState<Questionnaire[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    // Editor (ver/editar un cuestionario).
    const [editing, setEditing] = useState<Questionnaire | null>(null)
    const [editName, setEditName] = useState('')
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
            .listQuestionnaires(currentId)
            .then((r) => setAll(r.questionnaires))
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId])

    function openEdit(q: Questionnaire) {
        setEditing(q)
        setEditName(q.name)
        setJson(JSON.stringify(q.questions, null, 2))
        setJsonError(null)
    }

    async function saveEdit() {
        if (!editing || !currentId) return
        let questions: QuestionnaireQuestion[]
        try {
            questions = parseQuestions(json)
        } catch (e) {
            setJsonError('JSON inválido: ' + (e as Error).message)
            return
        }
        setBusy(true)
        try {
            await tekoApi.updateQuestionnaire(currentId, editing.id, {
                name: editName.trim() || editing.name,
                questions,
            })
            notify(`Cuestionario "${editing.name}" guardado.`)
            setEditing(null)
            load()
        } catch (e) {
            setJsonError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function toggleActive(q: Questionnaire) {
        if (!currentId) return
        try {
            await tekoApi.updateQuestionnaire(currentId, q.id, { active: !q.active })
            load()
        } catch (e) {
            setError((e as Error).message)
        }
    }

    async function submitCreate() {
        if (!currentId) return
        const name = newName.trim()
        if (!name) {
            setError('El nombre es obligatorio.')
            return
        }
        let questions: QuestionnaireQuestion[]
        try {
            questions = parseQuestions(newJson)
        } catch (e) {
            setError('JSON inválido: ' + (e as Error).message)
            return
        }
        setBusy(true)
        try {
            await tekoApi.createQuestionnaire(currentId, { name, questions })
            notify(`Cuestionario "${name}" creado.`)
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

    function copyId(id: string) {
        navigator.clipboard?.writeText(id).then(
            () => notify('Id copiado al portapapeles.'),
            () => undefined,
        )
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
                    <h3 className="mb-1">Cuestionarios</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Formularios custom de ${current.name}. Ligá uno a un workflow con "questionnaire": { "questionnaireId": "<id>" }.`
                            : 'Formularios custom del tenant.'}
                    </p>
                </div>
                <Button variant="solid" onClick={() => setCreating(true)}>
                    Nuevo cuestionario
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
                ) : all.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay cuestionarios. Creá uno y ligalo a un workflow.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Nombre</Th>
                                <Th>Id</Th>
                                <Th>Preguntas</Th>
                                <Th>Versión</Th>
                                <Th>Activo</Th>
                                <Th>Actualizado</Th>
                                <Th />
                            </Tr>
                        </THead>
                        <TBody>
                            {all.map((q) => (
                                <Tr key={q.id}>
                                    <Td className="font-medium heading-text">
                                        {q.name}
                                    </Td>
                                    <Td>
                                        <button
                                            type="button"
                                            title="Copiar id"
                                            onClick={() => copyId(q.id)}
                                            className="font-mono text-xs text-gray-400 hover:text-emerald-600"
                                        >
                                            {q.id.slice(0, 8)}…
                                        </button>
                                    </Td>
                                    <Td className="text-gray-500">
                                        {q.questions.length}
                                    </Td>
                                    <Td className="font-mono text-gray-500">
                                        v{q.version}
                                    </Td>
                                    <Td>
                                        {q.active ? (
                                            <Tag className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100">
                                                activo
                                            </Tag>
                                        ) : (
                                            <Tag className="border-0 bg-gray-100 text-gray-500">
                                                inactivo
                                            </Tag>
                                        )}
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(q.updatedAt)}
                                    </Td>
                                    <Td className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => toggleActive(q)}
                                            >
                                                {q.active
                                                    ? 'Desactivar'
                                                    : 'Activar'}
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => openEdit(q)}
                                            >
                                                Ver / editar
                                            </Button>
                                        </div>
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>

            {/* Editar */}
            <Dialog
                isOpen={Boolean(editing)}
                onClose={() => setEditing(null)}
                onRequestClose={() => setEditing(null)}
                width={640}
            >
                <h5 className="mb-1">
                    {editing ? `Editar ${editing.name}` : 'Editar cuestionario'}
                </h5>
                <p className="mb-4 text-xs text-gray-400">
                    Editar las preguntas crea una nueva versión. Las sesiones
                    existentes conservan las respuestas ya dadas.
                </p>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre
                        </label>
                        <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Preguntas (JSON)
                        </label>
                        <textarea
                            className={textareaCls}
                            value={json}
                            onChange={(e) => setJson(e.target.value)}
                            spellCheck={false}
                        />
                    </div>
                </div>
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
                        Guardar
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
                <h5 className="mb-4">Nuevo cuestionario</h5>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre
                        </label>
                        <Input
                            value={newName}
                            placeholder="ej: KYC reforzado"
                            onChange={(e) => setNewName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Preguntas (JSON)
                        </label>
                        <p className="mb-1 text-xs text-gray-400">
                            Cada pregunta: {'{ id, label, type, options?, required }'}.
                            Tipos: text · select · multiselect · checkbox · date ·
                            number.
                        </p>
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

export default QuestionnairesView
