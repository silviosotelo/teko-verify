import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Tabs from '@/components/ui/Tabs'
import Dialog from '@/components/ui/Dialog'
import Alert from '@/components/ui/Alert'
import Spinner from '@/components/ui/Spinner'
import Switcher from '@/components/ui/Switcher'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import Table from '@/components/ui/Table'
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
    { value: 'session_approved', label: 'Sesión aprobada' },
    { value: 'session_declined', label: 'Sesión rechazada' },
    { value: 'session_review', label: 'Requiere revisión' },
]

const SettingsEmail = () => {
    const { currentId, current: tenant, loading: tLoading } = useTenant()
    const [templates, setTemplates] = useState<EmailTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [tabValue, setTabValue] = useState('templates')

    const [editOpen, setEditOpen] = useState(false)
    const [editType, setEditType] = useState('')
    const [editSubject, setEditSubject] = useState('')
    const [editBody, setEditBody] = useState('')
    const [editActive, setEditActive] = useState(true)
    const [saving, setSaving] = useState(false)

    const fetchTemplates = async () => {
        if (!currentId) return
        setLoading(true)
        setError('')
        try {
            const res = await tekoApi.listEmailTemplates(currentId)
            setTemplates(res.templates || [])
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Error al cargar templates')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (currentId) fetchTemplates()
    }, [currentId])

    const openCreate = () => {
        setEditType(TEMPLATE_TYPES[0].value)
        setEditSubject('')
        setEditBody('')
        setEditActive(true)
        setEditOpen(true)
    }

    const openEdit = (t: EmailTemplate) => {
        setEditType(t.type)
        setEditSubject(t.subject)
        setEditBody(t.body)
        setEditActive(t.active)
        setEditOpen(true)
    }

    const handleSave = async () => {
        if (!currentId || !editType || !editSubject.trim() || !editBody.trim()) return
        setSaving(true)
        try {
            await tekoApi.upsertEmailTemplate(currentId, {
                type: editType,
                subject: editSubject.trim(),
                body: editBody.trim(),
                active: editActive,
            })
            toast.push(
                <Notification title="Guardado" type="success">Template actualizado</Notification>,
                { placement: 'top-center' },
            )
            setEditOpen(false)
            fetchTemplates()
        } catch (e: unknown) {
            toast.push(
                <Notification title="Error" type="danger">{e instanceof Error ? e.message : 'Error al guardar'}</Notification>,
                { placement: 'top-center' },
            )
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (type: string) => {
        if (!currentId) return
        try {
            await tekoApi.deleteEmailTemplate(currentId, type)
            toast.push(
                <Notification title="Eliminado" type="success">Template eliminado</Notification>,
                { placement: 'top-center' },
            )
            fetchTemplates()
        } catch (e: unknown) {
            toast.push(
                <Notification title="Error" type="danger">{e instanceof Error ? e.message : 'Error al eliminar'}</Notification>,
                { placement: 'top-center' },
            )
        }
    }

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div>
                <h3 className="font-semibold">Configuración de Email</h3>
                <p className="text-sm text-gray-500 mt-1">Administra las plantillas de correo electrónico para notificaciones</p>
            </div>

            <Tabs value={tabValue} onChange={(v) => setTabValue(v as string)}>
                <Tabs.TabList>
                    <Tabs.TabNav value="templates">Plantillas</Tabs.TabNav>
                    <Tabs.TabNav value="smtp">Servidor SMTP</Tabs.TabNav>
                </Tabs.TabList>
                <Tabs.TabContent value="templates">
                    <Card>
                        <div className="flex items-center justify-between mb-4">
                            <h5 className="font-semibold">Plantillas de correo</h5>
                            <Button variant="solid" size="sm" icon={<PiPlus />} onClick={openCreate}>
                                Nueva plantilla
                            </Button>
                        </div>

                        {error && <Alert showIcon type="danger" className="mb-4">{error}</Alert>}

                        {loading ? (
                            <div className="flex justify-center p-8"><Spinner size={40} /></div>
                        ) : templates.length === 0 ? (
                            <div className="text-center py-12 text-gray-400">
                                <PiEnvelope className="mx-auto mb-2 text-4xl" />
                                <p>No hay plantillas configuradas</p>
                                <p className="text-sm">Crea una nueva plantilla para empezar</p>
                            </div>
                        ) : (
                            <Table>
                                <THead>
                                    <Tr>
                                        <Th>Tipo</Th>
                                        <Th>Asunto</Th>
                                        <Th>Activo</Th>
                                        <Th className="text-right">Acciones</Th>
                                    </Tr>
                                </THead>
                                <TBody>
                                    {templates.map((t) => (
                                        <Tr key={t.type}>
                                            <Td className="font-medium">{TEMPLATE_TYPES.find(x => x.value === t.type)?.label || t.type}</Td>
                                            <Td className="text-gray-600">{t.subject}</Td>
                                            <Td>
                                                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${t.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                                    {t.active ? <PiCheck /> : <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />}
                                                    {t.active ? 'Activo' : 'Inactivo'}
                                                </span>
                                            </Td>
                                            <Td className="text-right">
                                                <div className="inline-flex gap-1">
                                                    <Button size="xs" variant="plain" icon={<PiPencil />} onClick={() => openEdit(t)} />
                                                    <Button size="xs" variant="plain" icon={<PiTrash />} onClick={() => handleDelete(t.type)} />
                                                </div>
                                            </Td>
                                        </Tr>
                                    ))}
                                </TBody>
                            </Table>
                        )}
                    </Card>
                </Tabs.TabContent>
                <Tabs.TabContent value="smtp">
                    <Card>
                        <h5 className="font-semibold mb-4">Configuración del servidor SMTP</h5>
                        <Alert showIcon type="info">
                            La configuración SMTP se define mediante variables de entorno en el servidor.
                            Contacta al administrador del sistema para modificarla.
                        </Alert>
                        <div className="mt-4 space-y-3 text-sm text-gray-600">
                            <div className="flex justify-between py-2 border-b"><span>Servidor</span><span className="font-mono text-gray-900">{tenant?.name || '—'}</span></div>
                            <div className="flex justify-between py-2 border-b"><span>Puerto</span><span className="font-mono text-gray-900">587</span></div>
                            <div className="flex justify-between py-2 border-b"><span>Cifrado</span><span className="font-mono text-gray-900">STARTTLS</span></div>
                            <div className="flex justify-between py-2 border-b"><span>From</span><span className="font-mono text-gray-900">noreply@teko.rohekawebservices.online</span></div>
                        </div>
                    </Card>
                </Tabs.TabContent>
            </Tabs>

            <Dialog isOpen={editOpen} onClose={() => setEditOpen(false)} width={620}>
                <h5 className="font-semibold mb-4">
                    {templates.find(t => t.type === editType) ? 'Editar plantilla' : 'Nueva plantilla'}
                </h5>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium">Tipo</label>
                        <Select
                            options={TEMPLATE_TYPES}
                            value={TEMPLATE_TYPES.find((tt) => tt.value === editType)}
                            onChange={(opt) => setEditType(opt?.value ?? '')}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">Asunto</label>
                        <Input value={editSubject} onChange={(e) => setEditSubject(e.target.value)} placeholder="Asunto del correo" />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">Cuerpo (HTML)</label>
                        <Input
                            textArea
                            rows={10}
                            className="font-mono"
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            placeholder="<html><body>...</body></html>"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Switcher checked={editActive} onChange={setEditActive} />
                        <span className="text-sm">Activo</span>
                    </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <Button variant="default" onClick={() => setEditOpen(false)}>Cancelar</Button>
                    <Button variant="solid" loading={saving} onClick={handleSave}>Guardar</Button>
                </div>
            </Dialog>
        </div>
    )
}

export default SettingsEmail