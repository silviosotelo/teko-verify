import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'
import Tag from '@/components/ui/Tag'
import Select from '@/components/ui/Select'
import Switcher from '@/components/ui/Switcher'
import Table from '@/components/ui/Table'
import Tabs from '@/components/ui/Tabs'
import Skeleton from '@/components/ui/Skeleton'
import Timeline from '@/components/ui/Timeline'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'

const { THead, TBody, Tr, Th, Td } = Table

interface AutomationTrigger {
    id: string
    name: string
    description: string
    event: string
    enabled: boolean
    lastFired: string | null
    eventCount: number
    actions: AutomationAction[]
}

interface AutomationAction {
    id: string
    type: string
    label: string
    config: Record<string, unknown>
}

interface AutomationHistory {
    id: string
    triggerId: string
    triggeredAt: string
    status: 'success' | 'failed' | 'pending'
    duration: number
    actionResults: Record<string, string>
}

const TRIGGERS: AutomationTrigger[] = [
    {
        id: 'session-created',
        name: 'Nueva sesión creada',
        description: 'Se dispara cuando un usuario inicia una sesión de verificación.',
        event: 'session.created',
        enabled: true,
        lastFired: new Date(Date.now() - 1800000).toISOString(),
        eventCount: 1247,
        actions: [
            {
                id: 'a1',
                type: 'webhook',
                label: 'Enviar webhook',
                config: { url: 'https://crm.example.com/teko/new' },
            },
        ],
    },
    {
        id: 'session-verified',
        name: 'Sesión verificada',
        description: 'Se dispara cuando una sesión alcanza el estado verified.',
        event: 'session.approved',
        enabled: true,
        lastFired: new Date(Date.now() - 3600000).toISOString(),
        eventCount: 892,
        actions: [
            {
                id: 'a2',
                type: 'webhook',
                label: 'Actualizar CRM',
                config: { endpoint: 'https://crm.example.com/verify' },
            },
            {
                id: 'a3',
                type: 'email',
                label: 'Enviar email de bienvenida',
                config: { template: 'welcome_verified' },
            },
        ],
    },
    {
        id: 'session-rejected',
        name: 'Sesión rechazada',
        description: 'Se dispara cuando una sesión es rechazada por cualquier motivo.',
        event: 'session.declined',
        enabled: true,
        lastFired: new Date(Date.now() - 7200000).toISOString(),
        eventCount: 156,
        actions: [
            {
                id: 'a4',
                type: 'webhook',
                label: 'Notificar al equipo',
                config: { channel: '#verificaciones' },
            },
        ],
    },
    {
        id: 'session-review',
        name: 'Sesión en revisión',
        description: 'Se dispara cuando una sesión entra en revisión manual.',
        event: 'session.in_review',
        enabled: false,
        lastFired: null,
        eventCount: 43,
        actions: [
            {
                id: 'a5',
                type: 'webhook',
                label: 'Crear ticket',
                config: { service: 'jira' },
            },
        ],
    },
]

const ACTION_TYPES = [
    { value: 'webhook', label: 'Enviar webhook' },
    { value: 'email', label: 'Enviar email' },
    { value: 'slack', label: 'Mensaje de Slack' },
    { value: 'crm', label: 'Actualizar CRM' },
    { value: 'database', label: 'Insertar en base de datos' },
    { value: 'webhook_retry', label: 'Reintentar webhook fallido' },
]

const IntegrationsZapier = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [triggers, setTriggers] = useState<AutomationTrigger[]>(TRIGGERS)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [creating, setCreating] = useState(false)
    const [wizardStep, setWizardStep] = useState(1)
    const [busy, setBusy] = useState(false)
    const [historyOpen, setHistoryOpen] = useState<string | null>(null)
    const [history, setHistory] = useState<AutomationHistory[]>([])
    const [historyLoading, setHistoryLoading] = useState(false)

    // Wizard state
    const [wizardTrigger, setWizardTrigger] = useState('')
    const [wizardActionType, setWizardActionType] = useState('')
    const [wizardConfig, setWizardConfig] = useState<Record<string, string>>({
        url: '',
        email: '',
        channel: '',
        endpoint: '',
        service: '',
    })

    useEffect(() => {
        if (!currentId) return
        // Simulamos carga de automatizaciones
        const timer = setTimeout(() => {
            setLoading(false)
        }, 800)
        return () => clearTimeout(timer)
    }, [currentId])

    function toggleTrigger(id: string) {
        setTriggers((prev) =>
            prev.map((t) =>
                t.id === id ? { ...t, enabled: !t.enabled } : t,
            ),
        )
    }

    function openHistory(trigger: AutomationTrigger) {
        setHistoryOpen(trigger.id)
        setHistoryLoading(true)
        // Simulamos historial
        setTimeout(() => {
            setHistory([
                {
                    id: `h-${trigger.id}-1`,
                    triggerId: trigger.id,
                    triggeredAt: new Date(Date.now() - 120000).toISOString(),
                    status: 'success',
                    duration: 234,
                    actionResults: { webhook: '200 OK' },
                },
                {
                    id: `h-${trigger.id}-2`,
                    triggerId: trigger.id,
                    triggeredAt: new Date(Date.now() - 300000).toISOString(),
                    status: 'success',
                    duration: 189,
                    actionResults: { webhook: '200 OK' },
                },
                {
                    id: `h-${trigger.id}-3`,
                    triggerId: trigger.id,
                    triggeredAt: new Date(Date.now() - 600000).toISOString(),
                    status: 'failed',
                    duration: 5002,
                    actionResults: { webhook: '502 Bad Gateway' },
                },
                {
                    id: `h-${trigger.id}-4`,
                    triggerId: trigger.id,
                    triggeredAt: new Date(Date.now() - 900000).toISOString(),
                    status: 'success',
                    duration: 312,
                    actionResults: { webhook: '200 OK' },
                },
            ])
            setHistoryLoading(false)
        }, 400)
    }

    function resetWizard() {
        setWizardStep(1)
        setWizardTrigger('')
        setWizardActionType('')
        setWizardConfig({ url: '', email: '', channel: '', endpoint: '', service: '' })
    }

    function submitCreate(e: React.FormEvent) {
        e.preventDefault()
        if (!wizardTrigger || !wizardActionType) return
        setBusy(true)
        setError(null)
        setTimeout(() => {
            const newTrigger: AutomationTrigger = {
                id: `custom-${Date.now()}`,
                name: `Automatización personalizada`,
                description: `Trigger: ${triggers.find((t) => t.id === wizardTrigger)?.name || ''}`,
                event: triggers.find((t) => t.id === wizardTrigger)?.event ?? 'session.created',
                enabled: true,
                lastFired: null,
                eventCount: 0,
                actions: [
                    {
                        id: `a-${Date.now()}`,
                        type: wizardActionType,
                        label: ACTION_TYPES.find((a) => a.value === wizardActionType)?.label ?? 'Acción',
                        config: { ...wizardConfig },
                    },
                ],
            }
            setTriggers((prev) => [...prev, newTrigger])
            setCreating(false)
            resetWizard()
            setBusy(false)
        }, 500)
    }

    function getTriggerConfigFields(type: string) {
        switch (type) {
            case 'webhook':
                return (
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            URL de destino
                        </label>
                        <Input
                            placeholder="https://tu-servidor/webhook"
                            value={wizardConfig.url}
                            onChange={(e) =>
                                setWizardConfig((prev) => ({ ...prev, url: e.target.value }))
                            }
                        />
                    </div>
                )
            case 'email':
                return (
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Template de email
                        </label>
                        <Input
                            placeholder="welcome_verified"
                            value={wizardConfig.email}
                            onChange={(e) =>
                                setWizardConfig((prev) => ({ ...prev, email: e.target.value }))
                            }
                        />
                    </div>
                )
            case 'slack':
                return (
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Canal de Slack
                        </label>
                        <Input
                            placeholder="#verificaciones"
                            value={wizardConfig.channel}
                            onChange={(e) =>
                                setWizardConfig((prev) => ({ ...prev, channel: e.target.value }))
                            }
                        />
                    </div>
                )
            case 'crm':
                return (
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Endpoint del CRM
                        </label>
                        <Input
                            placeholder="https://crm.example.com/api/verify"
                            value={wizardConfig.endpoint}
                            onChange={(e) =>
                                setWizardConfig((prev) => ({ ...prev, endpoint: e.target.value }))
                            }
                        />
                    </div>
                )
            case 'database':
                return (
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Servicio / Tabla
                        </label>
                        <Input
                            placeholder="postgresql://users"
                            value={wizardConfig.service}
                            onChange={(e) =>
                                setWizardConfig((prev) => ({ ...prev, service: e.target.value }))
                            }
                        />
                    </div>
                )
            default:
                return null
        }
    }

    if (tLoading || loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
                <div className="grid grid-cols-1 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-32" />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Automatizaciones</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Automatizaciones de eventos para ${current.name}`
                            : 'Automatizaciones de eventos'}
                    </p>
                </div>
                <Button variant="solid" onClick={() => { setCreating(true); resetWizard() }}>
                    Crear automatización
                </Button>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {/* Tabs de resumen */}
            <Tabs
                tabs={[
                    {
                        key: 'triggers',
                        label: `Activos (${triggers.filter((t) => t.enabled).length})`,
                    },
                    { key: 'all', label: 'Todos' },
                ]}
                defaultTab="triggers"
            >
                {(activeTab) => (
                    <div className="space-y-4">
                        {triggers
                            .filter(
                                (t) =>
                                    activeTab === 'all' || t.enabled,
                            )
                            .map((trigger) => (
                                <Card key={trigger.id}>
                                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                                        {/* Trigger info */}
                                        <div className="flex-1">
                                            <div className="mb-1 flex items-center gap-2">
                                                <h5 className="font-semibold heading-text">
                                                    {trigger.name}
                                                </h5>
                                                <Tag
                                                    className={`border-0 ${
                                                        trigger.enabled
                                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                            : 'bg-gray-100 text-gray-400 dark:bg-gray-600 dark:text-gray-300'
                                                    }`}
                                                >
                                                    {trigger.enabled ? 'activo' : 'pausado'}
                                                </Tag>
                                            </div>
                                            <p className="mb-2 text-sm text-gray-500">
                                                {trigger.description}
                                            </p>
                                            <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                                                <span>
                                                    Evento:{' '}
                                                    <code className="text-gray-600 dark:text-gray-300">
                                                        {trigger.event}
                                                    </code>
                                                </span>
                                                <span>
                                                    Total:{' '}
                                                    <strong className="text-gray-700 dark:text-gray-200">
                                                        {trigger.eventCount.toLocaleString()}
                                                    </strong>
                                                </span>
                                                <span>
                                                    Último:{' '}
                                                    {trigger.lastFired
                                                        ? fmtDate(trigger.lastFired)
                                                        : 'Nunca'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Actions visual */}
                                        <div className="flex flex-col items-center gap-1">
                                            <span className="text-xs text-gray-400">
                                                Acciones: {trigger.actions.length}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                {trigger.actions.map((action, idx) => (
                                                    <div
                                                        key={action.id}
                                                        className="flex items-center gap-1"
                                                    >
                                                        <Tag className="border-0 bg-violet-100 text-xs text-violet-700 dark:bg-violet-500/20 dark:text-violet-100">
                                                            {action.label}
                                                        </Tag>
                                                        {idx < trigger.actions.length - 1 && (
                                                            <span className="text-gray-300">→</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Controls */}
                                        <div className="flex items-center gap-2">
                                            <Switcher
                                                checked={trigger.enabled}
                                                onChange={() => toggleTrigger(trigger.id)}
                                            />
                                            <Button
                                                size="sm"
                                                variant="default"
                                                onClick={() => openHistory(trigger)}
                                            >
                                                Historial
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Visual flow */}
                                    {trigger.actions.length > 0 && (
                                        <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-700/30">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                                                T
                                            </div>
                                            <span className="flex-1 text-xs font-medium text-primary">
                                                {trigger.name}
                                            </span>
                                            <span className="text-lg text-gray-300">→</span>
                                            {trigger.actions.map((action, idx) => (
                                                <div key={action.id}>
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-100">
                                                        A
                                                    </div>
                                                    {idx < trigger.actions.length - 1 && (
                                                        <span className="text-lg text-gray-300">→</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </Card>
                            ))}
                    </div>
                )}
            </Tabs>

            {/* Crear automatización - Wizard */}
            <Dialog
                isOpen={creating}
                onClose={() => { setCreating(false); resetWizard() }}
                onRequestClose={() => { setCreating(false); resetWizard() }}
                width={640}
            >
                <h5 className="mb-4">Crear automatización</h5>

                {/* Wizard steps indicator */}
                <div className="mb-6 flex items-center gap-2">
                    {[1, 2, 3].map((step) => (
                        <div key={step} className="flex items-center gap-2">
                            <div
                                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                    step === wizardStep
                                        ? 'bg-primary text-white'
                                        : step < wizardStep
                                          ? 'bg-emerald-500 text-white'
                                          : 'bg-gray-200 text-gray-500 dark:bg-gray-600'
                                }`}
                            >
                                {step < wizardStep ? '✓' : step}
                            </div>
                            {step < 3 && (
                                <div
                                    className={`h-0.5 w-12 ${
                                        step < wizardStep
                                            ? 'bg-emerald-500'
                                            : 'bg-gray-200 dark:bg-gray-600'
                                    }`}
                                />
                            )}
                        </div>
                    ))}
                    <span className="ml-2 text-sm text-gray-500">
                        {wizardStep === 1
                            ? 'Elegir trigger'
                            : wizardStep === 2
                              ? 'Elegir acción'
                              : 'Configurar'}
                    </span>
                </div>

                {wizardStep === 1 && (
                    <div className="space-y-4">
                        <div>
                            <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                Trigger (evento que inicia la automatización)
                            </label>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {TRIGGERS.map((t) => (
                                    <Button
                                        key={t.id}
                                        type="button"
                                        block
                                        active={wizardTrigger === t.id}
                                        onClick={() => setWizardTrigger(t.id)}
                                        className="h-auto justify-start p-3 text-left"
                                    >
                                        <div>
                                            <div className="text-sm font-medium heading-text">
                                                {t.name}
                                            </div>
                                            <div className="mt-0.5 text-xs text-gray-500">
                                                {t.description}
                                            </div>
                                            <div className="mt-1 text-[10px] font-mono text-gray-400">
                                                {t.event}
                                            </div>
                                        </div>
                                    </Button>
                                ))}
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="default"
                                onClick={() => { setCreating(false); resetWizard() }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="solid"
                                disabled={!wizardTrigger}
                                onClick={() => setWizardStep(2)}
                            >
                                Siguiente
                            </Button>
                        </div>
                    </div>
                )}

                {wizardStep === 2 && (
                    <div className="space-y-4">
                        <div>
                            <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                Acción (qué hacer cuando se dispara el trigger)
                            </label>
                            <Select
                                options={ACTION_TYPES}
                                value={ACTION_TYPES.find(
                                    (a) => a.value === wizardActionType,
                                )}
                                onChange={(opt) =>
                                    setWizardActionType(opt?.value ?? '')
                                }
                            />
                        </div>
                        <div className="flex justify-between gap-2">
                            <Button
                                variant="default"
                                onClick={() => setWizardStep(1)}
                            >
                                Atrás
                            </Button>
                            <Button
                                variant="solid"
                                disabled={!wizardActionType}
                                onClick={() => setWizardStep(3)}
                            >
                                Siguiente
                            </Button>
                        </div>
                    </div>
                )}

                {wizardStep === 3 && (
                    <form onSubmit={submitCreate} className="space-y-4">
                        <div>
                            <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                Configurar parámetros de la acción
                            </label>
                            {wizardActionType ? (
                                getTriggerConfigFields(wizardActionType)
                            ) : (
                                <p className="text-sm text-gray-400">
                                    Elegí un tipo de acción en el paso anterior.
                                </p>
                            )}
                        </div>
                        <div className="flex justify-between gap-2">
                            <Button
                                variant="default"
                                onClick={() => setWizardStep(2)}
                            >
                                Atrás
                            </Button>
                            <div className="flex gap-2">
                                <Button
                                    variant="default"
                                    onClick={() => { setCreating(false); resetWizard() }}
                                >
                                    Cancelar
                                </Button>
                                <Button variant="solid" loading={busy} type="submit">
                                    Crear automatización
                                </Button>
                            </div>
                        </div>
                    </form>
                )}
            </Dialog>

            {/* Historial de ejecuciones */}
            <Dialog
                isOpen={Boolean(historyOpen)}
                onClose={() => setHistoryOpen(null)}
                onRequestClose={() => setHistoryOpen(null)}
                width={720}
            >
                <h5 className="mb-1">Historial de ejecuciones</h5>
                {historyOpen && (
                    <p className="mb-4 text-sm text-gray-500">
                        {triggers.find((t) => t.id === historyOpen)?.name}
                    </p>
                )}
                {historyLoading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size={32} />
                    </div>
                ) : history.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-400">
                        Sin ejecuciones todavía.
                    </div>
                ) : (
                    <div className="max-h-80 overflow-auto">
                        <Table>
                            <THead>
                                <Tr>
                                    <Th>Fecha</Th>
                                    <Th>Estado</Th>
                                    <Th>Duración</Th>
                                    <Th>Resultado</Th>
                                </Tr>
                            </THead>
                            <TBody>
                                {history.map((h) => (
                                    <Tr key={h.id}>
                                        <Td className="text-sm">
                                            {fmtDate(h.triggeredAt)}
                                        </Td>
                                        <Td>
                                            <Tag
                                                className={`border-0 ${
                                                    h.status === 'success'
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                        : h.status === 'failed'
                                                          ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100'
                                                          : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100'
                                                }`}
                                            >
                                                {h.status === 'success'
                                                    ? 'Exitosa'
                                                    : h.status === 'failed'
                                                      ? 'Fallida'
                                                      : 'Pendiente'}
                                            </Tag>
                                        </Td>
                                        <Td className="text-sm text-gray-500">
                                            {h.duration}ms
                                        </Td>
                                        <Td className="text-sm font-mono text-gray-500">
                                            {Object.entries(h.actionResults)
                                                .map(
                                                    ([k, v]) =>
                                                        `${k}: ${v}`,
                                                )
                                                .join(', ')}
                                        </Td>
                                    </Tr>
                                ))}
                            </TBody>
                        </Table>
                    </div>
                )}
                <div className="mt-4 flex justify-end">
                    <Button variant="default" onClick={() => setHistoryOpen(null)}>
                        Cerrar
                    </Button>
                </div>
            </Dialog>

            {/* Timeline de actividad reciente */}
            <Card className="mt-6">
                <h5 className="mb-4">Actividad reciente</h5>
                <Timeline
                    items={[
                        {
                            time: new Date(Date.now() - 1800000).toISOString(),
                            title: 'Nueva sesión creada',
                            description: 'Trigger "Nueva sesión creada" ejecutó 1 acción en 234ms.',
                            color: 'bg-emerald-500',
                        },
                        {
                            time: new Date(Date.now() - 3600000).toISOString(),
                            title: 'Sesión verificada',
                            description: 'Trigger "Sesión verificada" ejecutó 2 acciones en 412ms.',
                            color: 'bg-blue-500',
                        },
                        {
                            time: new Date(Date.now() - 7200000).toISOString(),
                            title: 'Sesión rechazada',
                            description: 'Trigger "Sesión rechazada" ejecutó 1 acción en 198ms.',
                            color: 'bg-amber-500',
                        },
                        {
                            time: new Date(Date.now() - 14400000).toISOString(),
                            title: 'Sesión en revisión',
                            description: 'Trigger "Sesión en revisión" falló (pausado).',
                            color: 'bg-gray-400',
                        },
                    ]}
                />
            </Card>
        </div>
    )
}

export default IntegrationsZapier
