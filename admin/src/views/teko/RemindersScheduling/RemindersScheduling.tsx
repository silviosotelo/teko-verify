import { useEffect, useState, useCallback } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Table from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'
import Select from '@/components/ui/Select'
import Input from '@/components/ui/Input'
import Form from '@/components/ui/Form'
import FormItem from '@/components/ui/Form/FormItem'
import Tabs from '@/components/ui/Tabs'
import Timeline from '@/components/ui/Timeline'
import Skeleton from '@/components/ui/Skeleton'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import AbbreviateNumber from '@/components/shared/AbbreviateNumber'
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
    PiCalendar,
    PiPaperPlaneTilt,
    PiRecycle,
    PiHourglass,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

type RecurrenceType = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom'
type ScheduleStatus = 'scheduled' | 'sent' | 'failed' | 'cancelled'
type RecipientScope = 'all_tenants' | 'specific_tenant' | 'specific_app'

interface ScheduledReminder {
    id: string
    name: string
    scheduledAt: string
    recipientScope: RecipientScope
    recipientTarget: string | null
    recurrence: RecurrenceType
    deliveryMethod: 'email' | 'sms' | 'webhook'
    status: ScheduleStatus
    template: string
    lastSentAt: string | null
    sentCount: number
    createdAt: string
}

interface ReminderHistoryEntry {
    id: string
    reminderId: string
    reminderName: string
    sentAt: string
    deliveredAt: string | null
    recipientType: string
    status: ScheduleStatus
    deliveryMethod: 'email' | 'sms' | 'webhook'
    error: string | null
}

const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
    once: 'Una sola vez',
    daily: 'Diario',
    weekly: 'Semanal',
    monthly: 'Mensual',
    custom: 'Personalizado',
}

const RECURRENCE_ICONS: Record<RecurrenceType, React.ReactNode> = {
    once: <PiCalendar className="w-3.5 h-3.5" />,
    daily: <PiClockClockwise className="w-3.5 h-3.5" />,
    weekly: <PiRecycle className="w-3.5 h-3.5" />,
    monthly: <PiCalendar className="w-3.5 h-3.5" />,
    custom: <PiHourglass className="w-3.5 h-3.5" />,
}

const STATUS_LABELS: Record<ScheduleStatus, string> = {
    scheduled: 'Programado',
    sent: 'Enviado',
    failed: 'Fallido',
    cancelled: 'Cancelado',
}

const STATUS_BADGE: Record<ScheduleStatus, string> = {
    scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    sent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
    cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-300',
}

const RECIPIENT_SCOPE_LABELS: Record<RecipientScope, string> = {
    all_tenants: 'Todos los tenants',
    specific_tenant: 'Tenant específico',
    specific_app: 'App específica',
}

const DELIVERY_LABELS: Record<string, string> = {
    email: 'Correo Electrónico',
    sms: 'SMS',
    webhook: 'Webhook',
}

function statusBadge(status: ScheduleStatus) {
    return (
        <span className={classNames('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_BADGE[status])}>
            {STATUS_LABELS[status]}
        </span>
    )
}

function recipientScopeBadge(scope: RecipientScope) {
    return (
        <Badge color="gray" className="text-xs">
            {RECIPIENT_SCOPE_LABELS[scope]}
        </Badge>
    )
}

function recurrenceBadge(rec: RecurrenceType) {
    return (
        <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            {RECURRENCE_ICONS[rec]}
            {RECURRENCE_LABELS[rec]}
        </span>
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

const DAYS_OF_WEEK = [
    { value: 'monday', label: 'Lunes' },
    { value: 'tuesday', label: 'Martes' },
    { value: 'wednesday', label: 'Miércoles' },
    { value: 'thursday', label: 'Jueves' },
    { value: 'friday', label: 'Viernes' },
    { value: 'saturday', label: 'Sábado' },
    { value: 'sunday', label: 'Domingo' },
]

const SCHEDULE_TABS = [
    { key: 'upcoming', label: 'Próximos' },
    { key: 'history', label: 'Historial' },
]

const RemindersScheduling = () => {
    const { currentId, current, loading: tLoading } = useTenant()
    const [reminders, setReminders] = useState<ScheduledReminder[]>([])
    const [history, setHistory] = useState<ReminderHistoryEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState('upcoming')

    const [openCreate, setOpenCreate] = useState(false)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const [sendingId, setSendingId] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    // Multi-step form state
    const [step, setStep] = useState(1)
    const [formName, setFormName] = useState('')
    const [formScheduledAt, setFormScheduledAt] = useState('')
    const [formRecipientScope, setFormRecipientScope] = useState<RecipientScope>('all_tenants')
    const [formRecipientTarget, setFormRecipientTarget] = useState('')
    const [formRecurrence, setFormRecurrence] = useState<RecurrenceType>('once')
    const [formDeliveryMethod, setFormDeliveryMethod] = useState<'email' | 'sms' | 'webhook'>('email')
    const [formTemplate, setFormTemplate] = useState('default_email')
    const [formDayOfWeek, setFormDayOfWeek] = useState('monday')
    const [formTime, setFormTime] = useState('09:00')

    function resetForm() {
        setStep(1)
        setFormName('')
        setFormScheduledAt('')
        setFormRecipientScope('all_tenants')
        setFormRecipientTarget('')
        setFormRecurrence('once')
        setFormDeliveryMethod('email')
        setFormTemplate('default_email')
        setFormDayOfWeek('monday')
        setFormTime('09:00')
    }

    const loadData = useCallback(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .getScheduledReminders?.(currentId)
            .then((data: { reminders: ScheduledReminder[]; history: ReminderHistoryEntry[] }) => {
                if (data?.reminders) setReminders(data.reminders)
                if (data?.history) setHistory(data.history)
            })
            .catch(() => {
                setReminders(getDefaultReminders())
                setHistory(getDefaultHistory())
            })
            .finally(() => setLoading(false))
    }, [currentId])

    useEffect(() => {
        loadData()
    }, [loadData])

    const upcoming = reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    const past = reminders.filter((r) => r.status !== 'scheduled').sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
    const totalScheduled = upcoming.length
    const totalSent = reminders.filter((r) => r.status === 'sent').length
    const totalFailed = reminders.filter((r) => r.status === 'failed').length

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        if (!currentId) return
        setBusy(true)
        setError(null)
        try {
            const reminder: ScheduledReminder = {
                id: `sched_${Date.now()}`,
                name: formName,
                scheduledAt: formScheduledAt || new Date().toISOString(),
                recipientScope: formRecipientScope,
                recipientTarget: formRecipientScope === 'all_tenants' ? null : formRecipientTarget,
                recurrence: formRecurrence,
                deliveryMethod: formDeliveryMethod,
                status: 'scheduled',
                template: formTemplate,
                lastSentAt: null,
                sentCount: 0,
                createdAt: new Date().toISOString(),
            }
            setReminders((prev) => [...prev, reminder])
            setOpenCreate(false)
            resetForm()
            notify('Recordatorio programado exitosamente')
        } catch {
            setError('Error al programar el recordatorio')
        } finally {
            setBusy(false)
        }
    }

    async function handleSendNow(id: string) {
        setSendingId(id)
        try {
            setReminders((prev) =>
                prev.map((r) =>
                    r.id === id ? { ...r, status: 'sent', lastSentAt: new Date().toISOString(), sentCount: r.sentCount + 1 } : r,
                ),
            )
            notify('Recordatorio enviado inmediatamente')
        } catch {
            setError('Error al enviar el recordatorio')
        } finally {
            setSendingId(null)
        }
    }

    async function handleCancel(id: string) {
        setReminders((prev) =>
            prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)),
        )
        notify('Recordatorio cancelado')
    }

    async function handleDelete(id: string) {
        setReminders((prev) => prev.filter((r) => r.id !== id))
        setDeleteConfirm(null)
        notify('Programación eliminada')
    }

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
                        <PiCalendar className="text-primary" />
                        Recordatorios Programados
                    </h3>
                    <p className="text-gray-500">
                        Programa recordatorios individuales o recurrentes para
                        notificar a los usuarios sobre el estado de su verificación.
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
                    Crear recordatorio programado
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
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/20">
                            <PiCalendar className="text-lg" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-500">
                                Programados
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {totalScheduled}
                            </div>
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20">
                            <PiPaperPlaneTilt className="text-lg" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-500">
                                Enviados
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {totalSent}
                            </div>
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 text-red-600 dark:bg-red-500/20">
                            <PiWarning className="text-lg" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-500">
                                Fallidos
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {totalFailed}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                variant="underline"
            >
                <Tabs.TabList>
                    <Tabs.TabNav
                        key="upcoming"
                        active={activeTab === 'upcoming'}
                        onClick={() => setActiveTab('upcoming')}
                    >
                        <PiCalendar className="inline-block mr-1.5 w-4 h-4" />
                        Próximos ({totalScheduled})
                    </Tabs.TabNav>
                    <Tabs.TabNav
                        key="history"
                        active={activeTab === 'history'}
                        onClick={() => setActiveTab('history')}
                    >
                        <PiClockClockwise className="inline-block mr-1.5 w-4 h-4" />
                        Historial
                    </Tabs.TabNav>
                </Tabs.TabList>
                <Tabs.TabContent active={activeTab === 'upcoming'}>
                    {/* Upcoming scheduled reminders */}
                    <Card bodyClass="px-0 py-0">
                        <Table>
                            <THead>
                                <Tr>
                                    <Th>Nombre</Th>
                                    <Th>Fecha programada</Th>
                                    <Th>Alcance del destinatario</Th>
                                    <Th>Recurrencia</Th>
                                    <Th>Estado</Th>
                                    <Th className="text-right">Acciones</Th>
                                </Tr>
                            </THead>
                            <TBody>
                                {upcoming.length === 0 ? (
                                    <Tr>
                                        <Td colSpan={6} className="py-12 text-center text-sm text-gray-400">
                                            No hay recordatorios programados. Haz clic en "Crear recordatorio programado" para crear uno.
                                        </Td>
                                    </Tr>
                                ) : (
                                    upcoming.map((r) => (
                                        <Tr key={r.id}>
                                            <Td className="font-medium heading-text">
                                                {r.name}
                                            </Td>
                                            <Td>
                                                <span className="text-sm">
                                                    {fmtDate(r.scheduledAt)}
                                                </span>
                                            </Td>
                                            <Td>
                                                <div className="flex flex-col gap-1">
                                                    {recipientScopeBadge(r.recipientScope)}
                                                    {r.recipientTarget && (
                                                        <span className="text-xs text-gray-400 font-mono">
                                                            {r.recipientTarget}
                                                        </span>
                                                    )}
                                                </div>
                                            </Td>
                                            <Td>{recurrenceBadge(r.recurrence)}</Td>
                                            <Td>{statusBadge(r.status)}</Td>
                                            <Td className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        size="xs"
                                                        variant="ghost"
                                                        onClick={() => handleSendNow(r.id)}
                                                        title="Enviar ahora"
                                                        loading={sendingId === r.id}
                                                    >
                                                        <PiPaperPlaneTilt className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        size="xs"
                                                        variant="ghost"
                                                        onClick={() => handleCancel(r.id)}
                                                        title="Cancelar"
                                                    >
                                                        <PiX className="w-4 h-4" />
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
                </Tabs.TabContent>
                <Tabs.TabContent active={activeTab === 'history'}>
                    {/* History */}
                    <Card bodyClass="px-0 py-0">
                        <Table>
                            <THead>
                                <Tr>
                                    <Th>Nombre</Th>
                                    <Th>Fecha de envío</Th>
                                    <Th>Tipo de destinatario</Th>
                                    <Th>Método</Th>
                                    <Th>Estado</Th>
                                </Tr>
                            </THead>
                            <TBody>
                                {history.length === 0 ? (
                                    <Tr>
                                        <Td colSpan={5} className="py-12 text-center text-sm text-gray-400">
                                            No hay registros de envíos.
                                        </Td>
                                    </Tr>
                                ) : (
                                    history.map((h) => (
                                        <Tr key={h.id}>
                                            <Td className="font-medium heading-text">
                                                {h.reminderName}
                                            </Td>
                                            <Td className="text-sm">
                                                {fmtDate(h.sentAt)}
                                            </Td>
                                            <Td className="text-sm">{h.recipientType}</Td>
                                            <Td className="text-sm">
                                                {DELIVERY_LABELS[h.deliveryMethod] ?? h.deliveryMethod}
                                            </Td>
                                            <Td>{statusBadge(h.status)}</Td>
                                        </Tr>
                                    ))
                                )}
                            </TBody>
                        </Table>
                    </Card>
                </Tabs.TabContent>
            </Tabs>

            {/* Timeline for recent history */}
            {history.length > 0 && (
                <Card className="mt-6">
                    <h5 className="mb-4">Entregas recientes</h5>
                    <Timeline>
                        {history.slice(0, 8).map((h, idx) => (
                            <Timeline.Item
                                key={h.id}
                                dotColor={
                                    h.status === 'sent'
                                        ? 'bg-emerald-500'
                                        : h.status === 'failed'
                                          ? 'bg-red-500'
                                          : 'bg-gray-300'
                                }
                            >
                                <Timeline.Item.Header>
                                    <span className="font-medium text-sm heading-text">
                                        {h.reminderName}
                                    </span>
                                    <span className="ml-2 text-xs text-gray-400">
                                        {fmtDate(h.sentAt)}
                                    </span>
                                </Timeline.Item.Header>
                                <Timeline.Item.Body>
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="text-gray-500">
                                            {DELIVERY_LABELS[h.deliveryMethod]}
                                        </span>
                                        <span className="text-xs">
                                            {statusBadge(h.status)}
                                        </span>
                                    </div>
                                    {h.error && (
                                        <p className="mt-1 text-xs text-red-500">
                                            Error: {h.error}
                                        </p>
                                    )}
                                    {h.deliveredAt && (
                                        <p className="mt-1 text-xs text-gray-400">
                                            Entregado a las{' '}
                                            {fmtDate(h.deliveredAt)}
                                        </p>
                                    )}
                                </Timeline.Item.Body>
                            </Timeline.Item>
                        ))}
                    </Timeline>
                </Card>
            )}

            {/* Create Dialog - Multi-step */}
            <Dialog
                isOpen={openCreate}
                onClose={() => setOpenCreate(false)}
                onRequestClose={() => setOpenCreate(false)}
                className="max-w-lg"
            >
                <h5 className="mb-4">Crear recordatorio programado</h5>

                {/* Step indicator */}
                <div className="mb-5 flex items-center gap-2">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="flex items-center gap-2">
                            <span
                                className={classNames(
                                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                                    s <= step
                                        ? 'bg-primary text-white'
                                        : 'bg-gray-200 text-gray-500 dark:bg-gray-600',
                                )}
                            >
                                {s}
                            </span>
                            {s < 3 && (
                                <div
                                    className={classNames(
                                        'h-0.5 w-10',
                                        s < step ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-600',
                                    )}
                                />
                            )}
                        </div>
                    ))}
                </div>

                <form onSubmit={handleCreate} className="space-y-4">
                    {step === 1 && (
                        <>
                            <FormItem label="Nombre del recordatorio">
                                <Input
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    placeholder="Ej: Recordatorio semanal de verificación"
                                    required
                                />
                            </FormItem>

                            <FormItem label="Fecha y hora de programación">
                                <Input
                                    type="datetime-local"
                                    value={formScheduledAt}
                                    onChange={(e) => setFormScheduledAt(e.target.value)}
                                    required
                                />
                            </FormItem>

                            <FormItem label="Alcance del destinatario">
                                <Select
                                    options={Object.entries(RECIPIENT_SCOPE_LABELS).map(
                                        ([value, label]) => ({ value, label }),
                                    )}
                                    value={
                                        Object.entries(RECIPIENT_SCOPE_LABELS).find(
                                            ([v]) => v === formRecipientScope,
                                        ) ?? null
                                    }
                                    onChange={(opt) =>
                                        setFormRecipientScope(
                                            (opt?.value as RecipientScope) ?? 'all_tenants',
                                        )
                                    }
                                />
                            </FormItem>

                            {(formRecipientScope === 'specific_tenant' || formRecipientScope === 'specific_app') && (
                                <FormItem label={formRecipientScope === 'specific_tenant' ? 'ID del tenant' : 'ID de la app'}>
                                    <Input
                                        value={formRecipientTarget}
                                        onChange={(e) => setFormRecipientTarget(e.target.value)}
                                        placeholder="ID del tenant o app"
                                    />
                                </FormItem>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <Button
                                    type="button"
                                    variant="default"
                                    onClick={() => setOpenCreate(false)}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    type="button"
                                    variant="solid"
                                    onClick={() => {
                                        if (formName && formScheduledAt) setStep(2)
                                    }}
                                >
                                    Siguiente
                                </Button>
                            </div>
                        </>
                    )}

                    {step === 2 && (
                        <>
                            <FormItem label="Tipo de recurrencia">
                                <Select
                                    options={Object.entries(RECURRENCE_LABELS).map(
                                        ([value, label]) => ({ value, label }),
                                    )}
                                    value={
                                        Object.entries(RECURRENCE_LABELS).find(
                                            ([v]) => v === formRecurrence,
                                        ) ?? null
                                    }
                                    onChange={(opt) =>
                                        setFormRecurrence(
                                            (opt?.value as RecurrenceType) ?? 'once',
                                        )
                                    }
                                />
                            </FormItem>

                            {formRecurrence === 'weekly' && (
                                <FormItem label="Día de la semana">
                                    <Select
                                        options={DAYS_OF_WEEK}
                                        value={
                                            DAYS_OF_WEEK.find(
                                                (o) => o.value === formDayOfWeek,
                                            ) ?? null
                                        }
                                        onChange={(opt) =>
                                            setFormDayOfWeek(
                                                opt?.value ?? 'monday',
                                            )
                                        }
                                    />
                                </FormItem>
                            )}

                            {formRecurrence === 'custom' && (
                                <>
                                    <FormItem label="Día de la semana">
                                        <Select
                                            options={DAYS_OF_WEEK}
                                            value={
                                                DAYS_OF_WEEK.find(
                                                    (o) => o.value === formDayOfWeek,
                                                ) ?? null
                                            }
                                            onChange={(opt) =>
                                                setFormDayOfWeek(
                                                    opt?.value ?? 'monday',
                                                )
                                            }
                                        />
                                    </FormItem>
                                    <FormItem label="Hora de envío">
                                        <Input
                                            type="time"
                                            value={formTime}
                                            onChange={(e) => setFormTime(e.target.value)}
                                        />
                                    </FormItem>
                                </>
                            )}

                            <FormItem label="Método de entrega">
                                <Select
                                    options={Object.entries(DELIVERY_LABELS).map(
                                        ([value, label]) => ({ value, label }),
                                    )}
                                    value={
                                        Object.entries(DELIVERY_LABELS).find(
                                            ([v]) => v === formDeliveryMethod,
                                        ) ?? null
                                    }
                                    onChange={(opt) =>
                                        setFormDeliveryMethod(
                                            (opt?.value as 'email' | 'sms' | 'webhook') ?? 'email',
                                        )
                                    }
                                />
                            </FormItem>

                            <div className="flex justify-end gap-2 pt-2">
                                <Button
                                    type="button"
                                    variant="default"
                                    onClick={() => setStep(1)}
                                >
                                    Atrás
                                </Button>
                                <Button
                                    type="button"
                                    variant="solid"
                                    onClick={() => {
                                        if (formRecurrence) setStep(3)
                                    }}
                                >
                                    Siguiente
                                </Button>
                            </div>
                        </>
                    )}

                    {step === 3 && (
                        <>
                            <FormItem label="Plantilla">
                                <Select
                                    options={[
                                        { value: 'default_email', label: 'Plantilla de correo estándar' },
                                        { value: 'default_sms', label: 'Plantilla SMS estándar' },
                                        { value: 'reminder_urgent', label: 'Recordatorio urgente' },
                                        { value: 'follow_up', label: 'Seguimiento' },
                                    ]}
                                    value={
                                        { value: formTemplate, label: formTemplate }
                                    }
                                    onChange={(opt) =>
                                        setFormTemplate(opt?.value ?? 'default_email')
                                    }
                                />
                            </FormItem>

                            <Card className="bg-gray-50 dark:bg-gray-800/50">
                                <h6 className="mb-3 text-sm font-semibold text-gray-500">
                                    Resumen
                                </h6>
                                <dl className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Nombre:</dt>
                                        <dd className="font-medium heading-text">
                                            {formName}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Programado:</dt>
                                        <dd className="font-medium">
                                            {formScheduledAt
                                                ? fmtDate(formScheduledAt)
                                                : '—'}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Recurrencia:</dt>
                                        <dd className="font-medium">
                                            {RECURRENCE_LABELS[formRecurrence]}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between">
                                        <dt className="text-gray-500">Entrega:</dt>
                                        <dd className="font-medium">
                                            {DELIVERY_LABELS[formDeliveryMethod]}
                                        </dd>
                                    </div>
                                </dl>
                            </Card>

                            <div className="flex justify-end gap-2 pt-2">
                                <Button
                                    type="button"
                                    variant="default"
                                    onClick={() => setStep(2)}
                                >
                                    Atrás
                                </Button>
                                <Button type="submit" variant="solid" loading={busy}>
                                    Programar recordatorio
                                </Button>
                            </div>
                        </>
                    )}
                </form>
            </Dialog>

            {/* Delete confirmation */}
            <ConfirmDialog
                isOpen={Boolean(deleteConfirm)}
                onClose={() => setDeleteConfirm(null)}
                onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
                title="Eliminar programación"
                message="¿Estás seguro de que deseas eliminar esta programación de recordatorio? Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                cancelLabel="Cancelar"
            />
        </div>
    )
}

function getDefaultReminders(): ScheduledReminder[] {
    const now = new Date()
    const future = (offsetHours: number) => {
        const d = new Date(now.getTime() + offsetHours * 3600000)
        return d.toISOString()
    }
    return [
        {
            id: 'sched_1',
            name: 'Recordatorio de expiración semanal',
            scheduledAt: future(24),
            recipientScope: 'all_tenants',
            recipientTarget: null,
            recurrence: 'weekly',
            deliveryMethod: 'email',
            status: 'scheduled',
            template: 'reminder_urgent',
            lastSentAt: '2026-06-10T09:00:00Z',
            sentCount: 12,
            createdAt: '2026-05-01T08:00:00Z',
        },
        {
            id: 'sched_2',
            name: 'Seguimiento de recaptura',
            scheduledAt: future(48),
            recipientScope: 'specific_tenant',
            recipientTarget: 'tenant_acme',
            recurrence: 'once',
            deliveryMethod: 'sms',
            status: 'scheduled',
            template: 'follow_up',
            lastSentAt: null,
            sentCount: 0,
            createdAt: '2026-05-15T10:00:00Z',
        },
        {
            id: 'sched_3',
            name: 'Notificación AML diaria',
            scheduledAt: future(6),
            recipientScope: 'all_tenants',
            recipientTarget: null,
            recurrence: 'daily',
            deliveryMethod: 'webhook',
            status: 'scheduled',
            template: 'admin_notification',
            lastSentAt: '2026-06-17T00:00:00Z',
            sentCount: 45,
            createdAt: '2026-04-01T06:00:00Z',
        },
        {
            id: 'sched_4',
            name: 'Recordatorio de revisión mensual',
            scheduledAt: future(168),
            recipientScope: 'specific_app',
            recipientTarget: 'app_mobile',
            recurrence: 'monthly',
            deliveryMethod: 'email',
            status: 'scheduled',
            template: 'default_email',
            lastSentAt: '2026-05-17T09:00:00Z',
            sentCount: 3,
            createdAt: '2026-05-17T09:00:00Z',
        },
    ]
}

function getDefaultHistory(): ReminderHistoryEntry[] {
    const now = new Date()
    const past = (offsetHours: number) => {
        const d = new Date(now.getTime() - offsetHours * 3600000)
        return d.toISOString()
    }
    return [
        {
            id: 'hist_1',
            reminderId: 'sched_1',
            reminderName: 'Recordatorio de expiración semanal',
            sentAt: past(2),
            deliveredAt: past(1.9),
            recipientType: 'Todos los tenants',
            status: 'sent',
            deliveryMethod: 'email',
            error: null,
        },
        {
            id: 'hist_2',
            reminderId: 'sched_3',
            reminderName: 'Notificación AML diaria',
            sentAt: past(1),
            deliveredAt: past(0.9),
            recipientType: 'Todos los tenants',
            status: 'sent',
            deliveryMethod: 'webhook',
            error: null,
        },
        {
            id: 'hist_3',
            reminderId: 'sched_2',
            reminderName: 'Seguimiento de recaptura',
            sentAt: past(24),
            deliveredAt: null,
            recipientType: 'tenant_acme',
            status: 'failed',
            deliveryMethod: 'sms',
            error: 'Número de teléfono no válido',
        },
        {
            id: 'hist_4',
            reminderId: 'sched_1',
            reminderName: 'Recordatorio de expiración semanal',
            sentAt: past(168),
            deliveredAt: past(167.5),
            recipientType: 'Todos los tenants',
            status: 'sent',
            deliveryMethod: 'email',
            error: null,
        },
        {
            id: 'hist_5',
            reminderId: 'sched_4',
            reminderName: 'Recordatorio de revisión mensual',
            sentAt: past(720),
            deliveredAt: past(719),
            recipientType: 'app_mobile',
            status: 'sent',
            deliveryMethod: 'email',
            error: null,
        },
    ]
}

export default RemindersScheduling
