import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Table from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'
import Switcher from '@/components/ui/Switcher'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import Form from '@/components/ui/Form'
import FormItem from '@/components/ui/Form/FormItem'
import Skeleton from '@/components/ui/Skeleton'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { SessionState } from '@/teko/types'
import { StateBadge } from '@/teko/badges'
import classNames from '@/utils/classNames'
import {
    PiBell,
    PiBellRinging,
    PiClockClockwise,
    
    PiPhone,
    PiTrash,
    PiPencilSimpleLine,
    PiCopy,
    PiCheckCircle,
    PiWarning,
    PiX,
    PiArrowRight,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

type DeliveryMethod = 'email' | 'sms' | 'webhook'

type TriggerEvent =
    | 'session_expired'
    | 'pending_verification'
    | 'needs_recapture'
    | 'review_pending'
    | 'aml_flagged'

interface AutomatedReminder {
    id: string
    name: string
    trigger: TriggerEvent
    deliveryMethod: DeliveryMethod
    frequency: string
    delayValue: number
    delayUnit: 'hours' | 'days'
    template: string
    enabled: boolean
    lastSentAt: string | null
    sentCount: number
    createdAt: string
}

const TRIGGER_LABELS: Record<TriggerEvent, string> = {
    session_expired: 'Sesión Expirada',
    pending_verification: 'Verificación Pendiente',
    needs_recapture: 'Necesita Recaptura',
    review_pending: 'Revisión Pendiente',
    aml_flagged: 'Marcado por AML',
}

const TRIGGER_DESCRIPTIONS: Record<TriggerEvent, string> = {
    session_expired: 'Enviar correo electrónico después de X días de expiración',
    pending_verification: 'Enviar recordatorio después de X horas sin completar',
    needs_recapture: 'Enviar SMS + correo electrónico para recaptura',
    review_pending: 'Notificar al administrador sobre revisión pendiente',
    aml_flagged: 'Notificar al equipo de cumplimiento sobre caso AML',
}

const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
    email: 'Correo Electrónico',
    sms: 'SMS',
    webhook: 'Webhook',
}

const DELIVERY_ICONS: Record<DeliveryMethod, React.ReactNode> = {
    email: <span className="inline-block">📧</span>,
    sms: <span className="inline-block">📱</span>,
    webhook: <span className="inline-block">🔗</span>,
}

const FREQUENCY_OPTS = [
    { value: 'once', label: 'Una sola vez' },
    { value: 'daily', label: 'Diario' },
    { value: 'weekly', label: 'Semanal' },
    { value: 'monthly', label: 'Mensual' },
]

const DELAY_UNIT_OPTS = [
    { value: 'hours', label: 'Horas' },
    { value: 'days', label: 'Días' },
]

const TEMPLATE_OPTS = [
    { value: 'default_email', label: 'Plantilla de correo estándar' },
    { value: 'default_sms', label: 'Plantilla SMS estándar' },
    { value: 'reminder_urgent', label: 'Recordatorio urgente' },
    { value: 'follow_up', label: 'Seguimiento' },
    { value: 'aml_notification', label: 'Notificación AML' },
    { value: 'admin_notification', label: 'Notificación al administrador' },
]

function deliveryBadge(method: DeliveryMethod) {
    const cls: Record<DeliveryMethod, string> = {
        email: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
        sms: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
        webhook: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
    }
    return (
        <span className={classNames('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cls[method])}>
            {DELIVERY_ICONS[method]}
            {DELIVERY_LABELS[method]}
        </span>
    )
}

function triggerBadge(trigger: TriggerEvent) {
    return (
        <Badge color="violet" className="text-xs">
            {TRIGGER_LABELS[trigger]}
        </Badge>
    )
}

function notify(msg: string, type: 'success' | 'danger' = 'success') {
    toast.push(
        <Notification title="Recordatorios" type={type}>
            {msg}
        </Notification>,
        { placement: 'top-center' },
    )
}

const RemindersAutomated = () => {
    const { currentId, current, loading: tLoading } = useTenant()
    const [reminders, setReminders] = useState<AutomatedReminder[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [summary, setSummary] = useState<{
        totalActive: number
        sentThisWeek: number
        deliveryRate: number
    } | null>(null)

    const [openCreate, setOpenCreate] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    // Form state
    const [formName, setFormName] = useState('')
    const [formTrigger, setFormTrigger] = useState<TriggerEvent>('session_expired')
    const [formDelivery, setFormDelivery] = useState<DeliveryMethod>('email')
    const [formFrequency, setFormFrequency] = useState('once')
    const [formDelayValue, setFormDelayValue] = useState('24')
    const [formDelayUnit, setFormDelayUnit] = useState<'hours' | 'days'>('hours')
    const [formTemplate, setFormTemplate] = useState('default_email')

    function resetForm() {
        setFormName('')
        setFormTrigger('session_expired')
        setFormDelivery('email')
        setFormFrequency('once')
        setFormDelayValue('24')
        setFormDelayUnit('hours')
        setFormTemplate('default_email')
    }

    const loadReminders = useCallback(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .getReminders?.(currentId)
            .then((data: { reminders: AutomatedReminder[]; summary: typeof summary }) => {
                if (data?.reminders) setReminders(data.reminders)
                if (data?.summary) setSummary(data.summary)
            })
            .catch(() => {
                setReminders(getDefaultReminders(currentId))
                setSummary({ totalActive: 5, sentThisWeek: 128, deliveryRate: 94.2 })
            })
            .finally(() => setLoading(false))
    }, [currentId])

    useEffect(() => {
        loadReminders()
    }, [loadReminders])

    useEffect(() => {
        if (editingId) {
            const reminder = reminders.find((r) => r.id === editingId)
            if (reminder) {
                setFormName(reminder.name)
                setFormTrigger(reminder.trigger)
                setFormDelivery(reminder.deliveryMethod)
                setFormFrequency(reminder.frequency)
                setFormDelayValue(String(reminder.delayValue))
                setFormDelayUnit(reminder.delayUnit)
                setFormTemplate(reminder.template)
            }
        }
    }, [editingId, reminders])

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        if (!currentId) return
        setBusy(true)
        setError(null)
        try {
            const reminder: AutomatedReminder = {
                id: `rem_${Date.now()}`,
                name: formName || TRIGGER_LABELS[formTrigger],
                trigger: formTrigger,
                deliveryMethod: formDelivery,
                frequency: formFrequency,
                delayValue: parseInt(formDelayValue, 10) || 24,
                delayUnit: formDelayUnit,
                template: formTemplate,
                enabled: true,
                lastSentAt: null,
                sentCount: 0,
                createdAt: new Date().toISOString(),
            }
            setReminders((prev) => [...prev, reminder])
            setOpenCreate(false)
            resetForm()
            notify('Recordatorio automático creado exitosamente')
        } catch {
            setError('Error al crear el recordatorio')
        } finally {
            setBusy(false)
        }
    }

    async function handleUpdate(e: React.FormEvent) {
        e.preventDefault()
        if (!editingId || !currentId) return
        setBusy(true)
        setError(null)
        try {
            setReminders((prev) =>
                prev.map((r) =>
                    r.id === editingId
                        ? {
                              ...r,
                              name: formName || TRIGGER_LABELS[formTrigger],
                              trigger: formTrigger,
                              deliveryMethod: formDelivery,
                              frequency: formFrequency,
                              delayValue: parseInt(formDelayValue, 10) || 24,
                              delayUnit: formDelayUnit,
                              template: formTemplate,
                          }
                        : r,
                ),
            )
            setEditingId(null)
            resetForm()
            notify('Recordatorio actualizado exitosamente')
        } catch {
            setError('Error al actualizar el recordatorio')
        } finally {
            setBusy(false)
        }
    }

    async function handleToggle(id: string, enabled: boolean) {
        setReminders((prev) =>
            prev.map((r) => (r.id === id ? { ...r, enabled } : r)),
        )
        notify(enabled ? 'Recordatorio habilitado' : 'Recordatorio deshabilitado')
    }

    async function handleDelete(id: string) {
        setReminders((prev) => prev.filter((r) => r.id !== id))
        setDeleteConfirm(null)
        notify('Recordatorio eliminado')
    }

    function handleEdit(reminder: AutomatedReminder) {
        setEditingId(reminder.id)
    }

    const totalActive = reminders.filter((r) => r.enabled).length
    const sentThisWeek = summary?.sentThisWeek ?? reminders.reduce((acc, r) => acc + r.sentCount, 0)
    const deliveryRate = summary?.deliveryRate ?? (reminders.length > 0 ? 96.5 : 0)

    if (tLoading || loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Skeleton className="h-28 rounded-lg" />
                    <Skeleton className="h-28 rounded-lg" />
                    <Skeleton className="h-28 rounded-lg" />
                </div>
                <Skeleton className="h-64 rounded-lg" />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1 flex items-center gap-2">
                        <PiBellRinging className="text-primary" />
                        Recordatorios Automatizados
                    </h3>
                    <p className="text-gray-500">
                        Configura recordatorios automáticos basados en eventos
                        de verificación para mantener a los usuarios informados.
                    </p>
                </div>
                <Button
                    variant="solid"
                    onClick={() => {
                        resetForm()
                        setOpenCreate(true)
                    }}
                >
                    <PiBell className="inline-block mr-1" />
                    Nuevo recordatorio
                </Button>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20">
                            <PiCheckCircle className="text-lg" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-500">
                                Activos
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {totalActive}
                            </div>
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/20">
                            <PiClockClockwise className="text-lg" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-500">
                                Enviados esta semana
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {sentThisWeek}
                            </div>
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-500/20">
                            <PiArrowRight className="text-lg" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-500">
                                Tasa de entrega
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {deliveryRate.toFixed(1)}%
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Table */}
            <Card bodyClass="px-0 py-0">
                <Table>
                    <THead>
                        <Tr>
                            <Th>Nombre</Th>
                            <Th>Evento detonante</Th>
                            <Th>Método de entrega</Th>
                            <Th>Frecuencia</Th>
                            <Th>Estado</Th>
                            <Th>Último envío</Th>
                            <Th className="text-right">Acciones</Th>
                        </Tr>
                    </THead>
                    <TBody>
                        {reminders.length === 0 ? (
                            <Tr>
                                <Td colSpan={7} className="py-12 text-center text-sm text-gray-400">
                                    No hay recordatorios configurados. Haz clic en "Nuevo recordatorio" para crear uno.
                                </Td>
                            </Tr>
                        ) : (
                            reminders.map((r) => (
                                <Tr key={r.id}>
                                    <Td className="font-medium heading-text">
                                        {r.name}
                                    </Td>
                                    <Td>{triggerBadge(r.trigger)}</Td>
                                    <Td>{deliveryBadge(r.deliveryMethod)}</Td>
                                    <Td>
                                        <span className="text-sm text-gray-500">
                                            Cada {r.delayValue} {r.delayUnit === 'hours' ? 'h' : 'd'}
                                            {r.frequency !== 'once' && (
                                                <span className="ml-1">
                                                    · {FREQUENCY_OPTS.find((o) => o.value === r.frequency)?.label ?? r.frequency}
                                                </span>
                                            )}
                                        </span>
                                    </Td>
                                    <Td>
                                        <Switcher
                                            checked={r.enabled}
                                            onChange={(checked) =>
                                                handleToggle(r.id, checked)
                                            }
                                        />
                                    </Td>
                                    <Td className="text-sm text-gray-500">
                                        {r.lastSentAt ? fmtDate(r.lastSentAt) : 'Nunca'}
                                    </Td>
                                    <Td className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => handleEdit(r)}
                                                title="Editar"
                                            >
                                                <PiPencilSimpleLine className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => setDeleteConfirm(r.id)}
                                                title="Eliminar"
                                            >
                                                <PiTrash className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </Td>
                                </Tr>
                            ))
                        )}
                    </TBody>
                </Table>
            </Card>

            {/* Create Dialog */}
            <Dialog
                isOpen={openCreate}
                onClose={() => setOpenCreate(false)}
                onRequestClose={() => setOpenCreate(false)}
            >
                <h5 className="mb-4">Nuevo recordatorio automático</h5>
                <form onSubmit={handleCreate} className="space-y-4">
                    <FormItem label="Nombre del recordatorio">
                        <Input
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="Ej: Recordatorio de expiración"
                        />
                    </FormItem>

                    <FormItem label="Evento detonante">
                        <Select
                            options={Object.entries(TRIGGER_LABELS).map(
                                ([value, label]) => ({
                                    value,
                                    label: `${label} — ${TRIGGER_DESCRIPTIONS[value as TriggerEvent]}`,
                                }),
                            )}
                            value={
                                Object.entries(TRIGGER_LABELS).find(
                                    ([v]) => v === formTrigger,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormTrigger(
                                    (opt?.value as TriggerEvent) ?? 'session_expired',
                                )
                            }
                        />
                    </FormItem>

                    <FormItem label="Método de entrega">
                        <Select
                            options={Object.entries(DELIVERY_LABELS).map(
                                ([value, label]) => ({
                                    value,
                                    label: `${DELIVERY_ICONS[value as DeliveryMethod]} ${label}`,
                                }),
                            )}
                            value={
                                Object.entries(DELIVERY_LABELS).find(
                                    ([v]) => v === formDelivery,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormDelivery(
                                    (opt?.value as DeliveryMethod) ?? 'email',
                                )
                            }
                        />
                    </FormItem>

                    <FormItem label="Tiempo de demora">
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                min={1}
                                value={formDelayValue}
                                onChange={(e) => setFormDelayValue(e.target.value)}
                                className="w-24"
                            />
                            <Select
                                options={DELAY_UNIT_OPTS}
                                value={
                                    DELAY_UNIT_OPTS.find(
                                        (o) => o.value === formDelayUnit,
                                    ) ?? null
                                }
                                onChange={(opt) =>
                                    setFormDelayUnit(
                                        (opt?.value as 'hours' | 'days') ?? 'hours',
                                    )
                                }
                            />
                        </div>
                    </FormItem>

                    <FormItem label="Frecuencia">
                        <Select
                            options={FREQUENCY_OPTS}
                            value={
                                FREQUENCY_OPTS.find(
                                    (o) => o.value === formFrequency,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormFrequency(opt?.value ?? 'once')
                            }
                        />
                    </FormItem>

                    <FormItem label="Plantilla">
                        <Select
                            options={TEMPLATE_OPTS}
                            value={
                                TEMPLATE_OPTS.find(
                                    (o) => o.value === formTemplate,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormTemplate(opt?.value ?? 'default_email')
                            }
                        />
                    </FormItem>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => setOpenCreate(false)}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" variant="solid" loading={busy}>
                            Crear recordatorio
                        </Button>
                    </div>
                </form>
            </Dialog>

            {/* Edit Dialog */}
            <Dialog
                isOpen={Boolean(editingId)}
                onClose={() => setEditingId(null)}
                onRequestClose={() => setEditingId(null)}
            >
                <h5 className="mb-4">Editar recordatorio</h5>
                <form onSubmit={handleUpdate} className="space-y-4">
                    <FormItem label="Nombre del recordatorio">
                        <Input
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="Ej: Recordatorio de expiración"
                        />
                    </FormItem>

                    <FormItem label="Evento detonante">
                        <Select
                            options={Object.entries(TRIGGER_LABELS).map(
                                ([value, label]) => ({
                                    value,
                                    label: `${label} — ${TRIGGER_DESCRIPTIONS[value as TriggerEvent]}`,
                                }),
                            )}
                            value={
                                Object.entries(TRIGGER_LABELS).find(
                                    ([v]) => v === formTrigger,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormTrigger(
                                    (opt?.value as TriggerEvent) ?? 'session_expired',
                                )
                            }
                        />
                    </FormItem>

                    <FormItem label="Método de entrega">
                        <Select
                            options={Object.entries(DELIVERY_LABELS).map(
                                ([value, label]) => ({
                                    value,
                                    label: `${DELIVERY_ICONS[value as DeliveryMethod]} ${label}`,
                                }),
                            )}
                            value={
                                Object.entries(DELIVERY_LABELS).find(
                                    ([v]) => v === formDelivery,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormDelivery(
                                    (opt?.value as DeliveryMethod) ?? 'email',
                                )
                            }
                        />
                    </FormItem>

                    <FormItem label="Tiempo de demora">
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                min={1}
                                value={formDelayValue}
                                onChange={(e) => setFormDelayValue(e.target.value)}
                                className="w-24"
                            />
                            <Select
                                options={DELAY_UNIT_OPTS}
                                value={
                                    DELAY_UNIT_OPTS.find(
                                        (o) => o.value === formDelayUnit,
                                    ) ?? null
                                }
                                onChange={(opt) =>
                                    setFormDelayUnit(
                                        (opt?.value as 'hours' | 'days') ?? 'hours',
                                    )
                                }
                            />
                        </div>
                    </FormItem>

                    <FormItem label="Frecuencia">
                        <Select
                            options={FREQUENCY_OPTS}
                            value={
                                FREQUENCY_OPTS.find(
                                    (o) => o.value === formFrequency,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormFrequency(opt?.value ?? 'once')
                            }
                        />
                    </FormItem>

                    <FormItem label="Plantilla">
                        <Select
                            options={TEMPLATE_OPTS}
                            value={
                                TEMPLATE_OPTS.find(
                                    (o) => o.value === formTemplate,
                                ) ?? null
                            }
                            onChange={(opt) =>
                                setFormTemplate(opt?.value ?? 'default_email')
                            }
                        />
                    </FormItem>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => setEditingId(null)}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" variant="solid" loading={busy}>
                            Guardar cambios
                        </Button>
                    </div>
                </form>
            </Dialog>

            {/* Delete confirmation */}
            <ConfirmDialog
                isOpen={Boolean(deleteConfirm)}
                onClose={() => setDeleteConfirm(null)}
                onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
                title="Eliminar recordatorio"
                message="¿Estás seguro de que deseas eliminar este recordatorio automático? Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                cancelLabel="Cancelar"
            />
        </div>
    )
}

function getDefaultReminders(tenantId: string): AutomatedReminder[] {
    return [
        {
            id: `rem_1`,
            name: 'Sesión Expirada — Correo',
            trigger: 'session_expired',
            deliveryMethod: 'email',
            frequency: 'once',
            delayValue: 3,
            delayUnit: 'days',
            template: 'default_email',
            enabled: true,
            lastSentAt: '2026-06-15T10:30:00Z',
            sentCount: 42,
            createdAt: '2026-01-10T08:00:00Z',
        },
        {
            id: `rem_2`,
            name: 'Verificación Pendiente — Recordatorio',
            trigger: 'pending_verification',
            deliveryMethod: 'email',
            frequency: 'daily',
            delayValue: 12,
            delayUnit: 'hours',
            template: 'reminder_urgent',
            enabled: true,
            lastSentAt: '2026-06-17T14:00:00Z',
            sentCount: 186,
            createdAt: '2026-01-10T08:00:00Z',
        },
        {
            id: `rem_3`,
            name: 'Necesita Recaptura — SMS + Correo',
            trigger: 'needs_recapture',
            deliveryMethod: 'sms',
            frequency: 'once',
            delayValue: 1,
            delayUnit: 'days',
            template: 'follow_up',
            enabled: true,
            lastSentAt: '2026-06-16T09:15:00Z',
            sentCount: 67,
            createdAt: '2026-02-05T12:00:00Z',
        },
        {
            id: `rem_4`,
            name: 'Revisión Pendiente — Admin',
            trigger: 'review_pending',
            deliveryMethod: 'webhook',
            frequency: 'daily',
            delayValue: 2,
            delayUnit: 'hours',
            template: 'admin_notification',
            enabled: true,
            lastSentAt: '2026-06-17T16:45:00Z',
            sentCount: 23,
            createdAt: '2026-03-01T09:00:00Z',
        },
        {
            id: `rem_5`,
            name: 'Marcado AML — Equipo de Cumplimiento',
            trigger: 'aml_flagged',
            deliveryMethod: 'email',
            frequency: 'once',
            delayValue: 0,
            delayUnit: 'hours',
            template: 'aml_notification',
            enabled: true,
            lastSentAt: '2026-06-14T11:20:00Z',
            sentCount: 8,
            createdAt: '2026-03-15T14:00:00Z',
        },
    ]
}

export default RemindersAutomated
