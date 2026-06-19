import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Dialog from '@/components/ui/Dialog'
import Alert from '@/components/ui/Alert'
import Spinner from '@/components/ui/Spinner'
import Switcher from '@/components/ui/Switcher'
import Tabs from '@/components/ui/Tabs'
import Table from '@/components/ui/Table'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { PiEnvelope, PiPlus, PiPencil, PiTrash, PiCheck } from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

interface EmailTemplate {
    type: string
    subject: string
    body: string
    active: boolean
}

const TEMPLATE_TYPES = [
    { value: 'verification_link', label: 'Link de verificación' },
    { value: 'session_approved', label: 'Aprobada' },
    { value: 'session_declined', label: 'Rechazada' },
    { value: 'session_review', label: 'Requiere revisión' },
    { value: 'session_expired', label: 'Sesión expirada' },
]

const EmailTemplatesView = () => {
    const { currentId } = useTenant()
    const [templates, setTemplates] = useState<EmailTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    const [editOpen, setEditOpen] = useState(false)
    const [editType, setEditType] = useState(TEMPLATE_TYPES[0].value)
    const [editSubject, setEditSubject] = useState('')
    const [editBody, setEditBody] = useState('')
    const [editActive, setEditActive] = useState(true)
    const [saving, setSaving] = useState(false)

    const fetchTemplates = async () => {
        if (!currentId) return
        setLoading(true); setError('')
        try {
            const res = await tekoApi.listEmailTemplates(currentId)
            setTemplates(res.templates || [])
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Error al cargar')
        } finally { setLoading(false) }
    }

    useEffect(() => { if (currentId) fetchTemplates() }, [currentId])

    const openCreate = () => {
        setEditType(TEMPLATE_TYPES[0].value); setEditSubject(''); setEditBody(''); setEditActive(true); setEditOpen(true)
    }

    const openEdit = (t: EmailTemplate) => {
        setEditType(t.type); setEditSubject(t.subject); setEditBody(t.body); setEditActive(t.active); setEditOpen(true)
    }

    const handleSave = async () => {
        if (!currentId) return
        setSaving(true)
        try {
            await tekoApi.upsertEmailTemplate(currentId, { type: editType, subject: editSubject.trim(), body: editBody.trim(), active: editActive })
            toast.push(<Notification title="Guardado" type="success">Template actualizado</Notification>, { placement: 'top-center' })
            setEditOpen(false); fetchTemplates()
        } catch (e: unknown) {
            toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
        } finally { setSaving(false) }
    }

    const handleDelete = async (type: string) => {
        if (!currentId) return
        try {
            await tekoApi.deleteEmailTemplate(currentId, type)
            toast.push(<Notification title="Eliminado" type="success">Template eliminado</Notification>, { placement: 'top-center' })
            fetchTemplates()
        } catch (e: unknown) {
            toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div><h3 className="font-semibold">Plantillas de Email</h3><p className="text-sm text-gray-500 mt-1">Personaliza los correos que reciben los solicitantes</p></div>
                <Button variant="solid" size="sm" icon={<PiPlus />} onClick={openCreate}>Nueva plantilla</Button>
            </div>
            {error && <Alert showIcon type="danger">{error}</Alert>}
            <Card bodyClass="p-0">
                {loading ? <div className="flex justify-center p-8"><Spinner size={40} /></div>
                : templates.length === 0 ? (
                    <div className="text-center py-12 text-gray-400"><PiEnvelope className="mx-auto mb-2 text-4xl" /><p>No hay plantillas</p></div>
                ) : (
                    <Table>
                        <THead><Tr><Th>Tipo</Th><Th>Asunto</Th><Th>Activo</Th><Th className="text-right">Acciones</Th></Tr></THead>
                        <TBody>
                            {templates.map((t) => (
                                <Tr key={t.type}>
                                    <Td className="font-medium">{TEMPLATE_TYPES.find(x => x.value === t.type)?.label || t.type}</Td>
                                    <Td className="text-gray-600">{t.subject}</Td>
                                    <Td><span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${t.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{t.active ? <><PiCheck /> Activo</> : 'Inactivo'}</span></Td>
                                    <Td className="text-right"><div className="inline-flex gap-1"><Button size="xs" variant="plain" icon={<PiPencil />} onClick={() => openEdit(t)} /><Button size="xs" variant="plain" icon={<PiTrash />} onClick={() => handleDelete(t.type)} /></div></Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>

            <Dialog isOpen={editOpen} onClose={() => setEditOpen(false)} width={620}>
                <h5 className="font-semibold mb-4">{templates.find(t => t.type === editType) ? 'Editar' : 'Nueva'} plantilla</h5>
                <div className="space-y-4">
                    <div><label className="mb-1 block text-sm font-medium">Tipo</label>
                        <select className="w-full border rounded-md px-3 py-2 text-sm" value={editType} onChange={(e) => setEditType(e.target.value)}>
                            {TEMPLATE_TYPES.map(tt => <option key={tt.value} value={tt.value}>{tt.label}</option>)}
                        </select>
                    </div>
                    <div><label className="mb-1 block text-sm font-medium">Asunto</label><Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder="Asunto del correo" /></div>
                    <div><label className="mb-1 block text-sm font-medium">Cuerpo (HTML)</label>
                        <textarea className="w-full border rounded-md px-3 py-2 text-sm font-mono min-h-[200px]" value={editBody} onChange={(e) => setEditBody(e.target.value)} placeholder="<html><body>...</body></html>" />
                    </div>
                    <div className="flex items-center gap-2"><Switcher checked={editActive} onChange={setEditActive} /><span className="text-sm">Activo</span></div>
                </div>
                <div className="mt-5 flex justify-end gap-2"><Button variant="default" onClick={() => setEditOpen(false)}>Cancelar</Button><Button variant="solid" loading={saving} onClick={handleSave}>Guardar</Button></div>
            </Dialog>
        </div>
    )
}

export default EmailTemplatesView