import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Switcher from '@/components/ui/Switcher'
import Tabs from '@/components/ui/Tabs'
import Dialog from '@/components/ui/Dialog'
import Alert from '@/components/ui/Alert'
import Badge from '@/components/ui/Badge'
import Progress from '@/components/ui/Progress'
import Table from '@/components/ui/Table'
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { Tenant } from '@/teko/types'
import {  PiGear, PiTrash, PiCopy, PiCheckCircle, PiWarning, PiX, PiArrowRight } from 'react-icons/pi'
import classNames from '@/utils/classNames'

const Chart = lazy(() => import('@/components/shared/Chart'))

type SmsProvider = 'twilio' | 'aws_sns' | 'custom'

interface SmsProviderConfig {
    provider: SmsProvider
    accountSid: string
    authToken: string
    apiKey: string
    apiSecret: string
    phoneNumber: string
    senderId: string
    enabled: boolean
}

interface SmsTemplate {
    id: string
    name: string
    content: string
    category: string
    variables: string[]
}

interface SmsSettings {
    provider: SmsProviderConfig
    templates: SmsTemplate[]
    rateLimit: number
    deliveryReceipts: boolean
    enabled: boolean
    errorHandling: {
        maxRetries: number
        retryDelaySeconds: number
        failoverProvider: SmsProvider | 'none'
    }
}

interface SmsCost {
    sentThisMonth: number
    estimatedCost: number
    byType: Array<{ type: string; count: number; cost: number }>
    trend: Array<{ month: string; count: number; cost: number }>
}

interface SmsState {
    settings: SmsSettings
    costs: SmsCost
    loading: boolean
}

const PROVIDER_OPTS: { value: SmsProvider; label: string }[] = [
    { value: 'twilio', label: 'Twilio' },
    { value: 'aws_sns', label: 'AWS SNS' },
    { value: 'custom', label: 'Personalizado' },
]

const DEFAULT_PROVIDER: SmsProviderConfig = {
    provider: 'twilio',
    accountSid: '',
    authToken: '',
    apiKey: '',
    apiSecret: '',
    phoneNumber: '',
    senderId: '',
    enabled: true,
}

const DEFAULT_TEMPLATES: SmsTemplate[] = [
    {
        id: 'verification_code',
        name: 'Código de verificación',
        content: 'Tu código de verificación es: {code}. Válido por {minutes} minutos.',
        category: 'verificacion',
        variables: ['code', 'minutes'],
    },
    {
        id: 'reminder',
        name: 'Recordatorio',
        content: 'Hola {name}, te recordamos que debes completar tu verificación de identidad. Hacé clic aquí: {link}',
        category: 'recordatorios',
        variables: ['name', 'link'],
    },
    {
        id: 'alert',
        name: 'Alerta',
        content: 'Alerta de seguridad: se detectó actividad inusual en tu cuenta. Si no fuiste vos, contactá a soporte.',
        category: 'alertas',
        variables: [],
    },
    {
        id: 'custom',
        name: 'Plantilla personalizada',
        content: '',
        category: 'personalizado',
        variables: [],
    },
]

const DEFAULT_SETTINGS: SmsSettings = {
    provider: { ...DEFAULT_PROVIDER },
    templates: DEFAULT_TEMPLATES,
    rateLimit: 30,
    deliveryReceipts: true,
    enabled: true,
    errorHandling: {
        maxRetries: 3,
        retryDelaySeconds: 60,
        failoverProvider: 'none',
    },
}

const DEFAULT_COSTS: SmsCost = {
    sentThisMonth: 2847,
    estimatedCost: 142.35,
    byType: [
        { type: 'Verificación', count: 1520, cost: 76.0 },
        { type: 'Recordatorios', count: 890, cost: 44.5 },
        { type: 'Alertas', count: 237, cost: 21.85 },
        { type: 'Otros', count: 200, cost: 0.0 },
    ],
    trend: [
        { month: 'Jul', count: 1800, cost: 90.0 },
        { month: 'Ago', count: 2050, cost: 102.5 },
        { month: 'Sep', count: 2200, cost: 110.0 },
        { month: 'Oct', count: 2380, cost: 119.0 },
        { month: 'Nov', count: 2500, cost: 125.0 },
        { month: 'Dic', count: 2620, cost: 131.0 },
        { month: 'Ene', count: 2700, cost: 135.0 },
        { month: 'Feb', count: 2750, cost: 137.5 },
        { month: 'Mar', count: 2780, cost: 139.0 },
        { month: 'Abr', count: 2800, cost: 140.0 },
        { month: 'May', count: 2830, cost: 141.5 },
        { month: 'Jun', count: 2847, cost: 142.35 },
    ],
}

const FAILOVER_OPTS = [
    { value: 'none', label: 'Sin failover' },
    { value: 'twilio', label: 'Twilio' },
    { value: 'aws_sns', label: 'AWS SNS' },
] as const

const Field = ({
    label,
    children,
    hint,
}: {
    label: string
    children: React.ReactNode
    hint?: string
}) => (
    <div>
        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
            {label}
        </label>
        {children}
        {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
)

const { THead, TBody, Tr, Th, Td } = Table

function notify(msg: string, type: 'success' | 'danger' = 'success') {
    toast.push(
        <Notification title="SMS" type={type}>{msg}</Notification>,
        { placement: 'top-center' },
    )
}

const SettingsSMS = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [smsState, setSmsState] = useState<SmsState | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState(0)

    const [provider, setProvider] = useState<SmsProviderConfig>(DEFAULT_PROVIDER)
    const [showAuth, setShowAuth] = useState(false)

    // Template editing
    const [editingTemplate, setEditingTemplate] = useState<SmsTemplate | null>(null)
    const [editContent, setEditContent] = useState('')

    // Test send
    const [testPhone, setTestPhone] = useState('')
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

    // Reset confirmation
    const [resetConfirm, setResetConfirm] = useState<string | null>(null)

    const loadSettings = useCallback(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        setTimeout(() => {
            setSmsState({
                settings: { ...DEFAULT_SETTINGS },
                costs: { ...DEFAULT_COSTS },
                loading: false,
            })
            setProvider({ ...DEFAULT_PROVIDER })
            setLoading(false)
        }, 600)
    }, [currentId])

    useEffect(() => {
        loadSettings()
    }, [loadSettings])

    async function handleSaveProvider() {
        if (!currentId) return
        setSaving(true)
        setError(null)
        try {
            setSmsState((prev) =>
                prev ? { ...prev, settings: { ...prev.settings, provider: { ...provider } } } : null
            )
            notify('Configuración del proveedor SMS guardada.')
        } catch (e) {
            setError((e as Error).message)
            notify((e as Error).message, 'danger')
        } finally {
            setSaving(false)
        }
    }

    async function handleTestSend() {
        if (!testPhone.trim()) {
            setError('Ingresá un número de teléfono para la prueba.')
            return
        }
        setTesting(true)
        setTestResult(null)
        try {
            await new Promise<void>((resolve) => setTimeout(resolve, 2000))
            setTestResult({
                ok: true,
                message: `SMS de prueba enviado a ${testPhone}`,
            })
            notify('SMS de prueba enviado correctamente.')
        } catch (e) {
            setTestResult({
                ok: false,
                message: (e as Error).message,
            })
            notify('Error al enviar SMS de prueba.', 'danger')
        } finally {
            setTesting(false)
        }
    }

    function openEditTemplate(template: SmsTemplate) {
        setEditingTemplate(template)
        setEditContent(template.content)
    }

    function handleSaveTemplate() {
        if (!editingTemplate || !smsState) return
        const updated = smsState.settings.templates.map((t) =>
            t.id === editingTemplate.id ? { ...t, content: editContent } : t
        )
        setSmsState((prev) =>
            prev ? { ...prev, settings: { ...prev.settings, templates: updated } } : null
        )
        setEditingTemplate(null)
        notify('Plantilla actualizada.')
    }

    function handleResetTemplate(templateId: string) {
        if (!smsState) return
        const def = DEFAULT_TEMPLATES.find((t) => t.id === templateId)
        if (!def) return
        const updated = smsState.settings.templates.map((t) =>
            t.id === templateId ? { ...def } : t
        )
        setSmsState((prev) =>
            prev ? { ...prev, settings: { ...prev.settings, templates: updated } } : null
        )
        setResetConfirm(null)
        notify('Plantilla restablecida.')
    }

    const handleTabChange = (idx: number) => {
        setActiveTab(idx)
        if (smsState) {
            if (idx === 0) setProvider(smsState.settings.provider)
        }
    }

    const tabs = [
        { label: 'Proveedor SMS', icon: <span>⚙️</span> },
        { label: 'Plantillas', icon: <span>📝</span> },
        { label: 'Ajustes y costos', icon: <span>📊</span> },
    ]

    if (tLoading || loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    if (!smsState) return null

    const { costs } = smsState

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Configuración SMS</h3>
                <p className="text-gray-500">
                    {current
                        ? `Configuración de mensajes SMS para ${current.name}`
                        : 'Configuración de mensajes SMS del tenant'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {/* Métricas rápidas */}
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card>
                    <div className="text-sm text-gray-500">
                        Enviados este mes
                    </div>
                    <div className="text-2xl font-bold heading-text">
                        {costs.sentThisMonth.toLocaleString()}
                    </div>
                </Card>
                <Card>
                    <div className="text-sm text-gray-500">Costo estimado</div>
                    <div className="text-2xl font-bold heading-text">
                        ${costs.estimatedCost.toFixed(2)}
                    </div>
                </Card>
                <Card>
                    <div className="text-sm text-gray-500">
                        Costo por SMS
                    </div>
                    <div className="text-2xl font-bold heading-text">
                        $
                        {(
                            costs.estimatedCost / costs.sentThisMonth
                        ).toFixed(4)}
                    </div>
                </Card>
                <Card>
                    <div className="text-sm text-gray-500">Proveedor</div>
                    <div className="text-2xl font-bold heading-text">
                        <Badge
                            color={
                                provider.provider === 'twilio'
                                    ? 'info'
                                    : provider.provider === 'aws_sns'
                                      ? 'success'
                                      : 'warning'
                            }
                        >
                            {
                                PROVIDER_OPTS.find(
                                    (p) => p.value === provider.provider,
                                )?.label
                            }
                        </Badge>
                    </div>
                </Card>
            </div>

            <Tabs
                items={tabs.map((t) => ({
                    key: String(tabs.indexOf(t)),
                    title: t.label,
                    icon: <t.icon className="h-4 w-4" />,
                }))}
                activeKey={String(activeTab)}
                onChange={(key) => handleTabChange(parseInt(key, 10))}
            />

            {/* Tab 0: Proveedor SMS */}
            {activeTab === 0 && (
                <div className="mt-6 space-y-6">
                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiGear className="h-5 w-5 text-gray-500" />
                            Configuración del proveedor
                        </h5>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Field label="Proveedor SMS">
                                <Select
                                    options={PROVIDER_OPTS}
                                    value={
                                        PROVIDER_OPTS.find(
                                            (p) => p.value === provider.provider,
                                        )
                                    }
                                    onChange={(o) =>
                                        setProvider((p) => ({
                                            ...p,
                                            provider: (o?.value ??
                                                'twilio') as SmsProvider,
                                        }))
                                    }
                                />
                            </Field>
                            <Field label="Habilitado">
                                <Switcher
                                    checked={provider.enabled}
                                    onChange={(v) =>
                                        setProvider((p) => ({
                                            ...p,
                                            enabled: v,
                                        }))
                                    }
                                />
                            </Field>
                        </div>

                        {provider.provider === 'twilio' && (
                            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <Field label="Account SID">
                                    <Input
                                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        value={provider.accountSid}
                                        onChange={(e) =>
                                            setProvider((p) => ({
                                                ...p,
                                                accountSid: e.target.value,
                                            }))
                                        }
                                    />
                                </Field>
                                <Field label="Auth Token">
                                    <div className="relative">
                                        <Input
                                            type={
                                                showAuth
                                                    ? 'text'
                                                    : 'password'
                                            }
                                            placeholder="••••••••"
                                            value={provider.authToken}
                                            onChange={(e) =>
                                                setProvider((p) => ({
                                                    ...p,
                                                    authToken: e.target.value,
                                                }))
                                            }
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            onClick={() =>
                                                setShowAuth(!showAuth)
                                            }
                                        >
                                            {showAuth ? (
                                                <PiX className="h-4 w-4" />
                                            ) : (
                                                <PiGear className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </Field>
                            </div>
                        )}

                        {provider.provider === 'aws_sns' && (
                            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <Field label="API Key (Access Key)">
                                    <Input
                                        placeholder="AKIAxxxxxxxxxxxxxxxx"
                                        value={provider.apiKey}
                                        onChange={(e) =>
                                            setProvider((p) => ({
                                                ...p,
                                                apiKey: e.target.value,
                                            }))
                                        }
                                    />
                                </Field>
                                <Field label="API Secret (Secret Key)">
                                    <div className="relative">
                                        <Input
                                            type={
                                                showAuth
                                                    ? 'text'
                                                    : 'password'
                                            }
                                            placeholder="••••••••"
                                            value={provider.apiSecret}
                                            onChange={(e) =>
                                                setProvider((p) => ({
                                                    ...p,
                                                    apiSecret: e.target.value,
                                                }))
                                            }
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            onClick={() =>
                                                setShowAuth(!showAuth)
                                            }
                                        >
                                            {showAuth ? (
                                                <PiX className="h-4 w-4" />
                                            ) : (
                                                <PiGear className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </Field>
                            </div>
                        )}

                        {provider.provider === 'custom' && (
                            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <Field label="Endpoint API">
                                    <Input
                                        placeholder="https://api.proveedor.com/v1/sms"
                                        value={provider.apiKey}
                                        onChange={(e) =>
                                            setProvider((p) => ({
                                                ...p,
                                                apiKey: e.target.value,
                                            }))
                                        }
                                    />
                                </Field>
                                <Field label="Token de autenticación">
                                    <div className="relative">
                                        <Input
                                            type={
                                                showAuth
                                                    ? 'text'
                                                    : 'password'
                                            }
                                            placeholder="••••••••"
                                            value={provider.apiSecret}
                                            onChange={(e) =>
                                                setProvider((p) => ({
                                                    ...p,
                                                    apiSecret: e.target.value,
                                                }))
                                            }
                                        />
                                        <button
                                            type="button"
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            onClick={() =>
                                                setShowAuth(!showAuth)
                                            }
                                        >
                                            {showAuth ? (
                                                <PiX className="h-4 w-4" />
                                            ) : (
                                                <PiGear className="h-4 w-4" />
                                            )}
                                        </button>
                                    </div>
                                </Field>
                            </div>
                        )}

                        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Field label="Número de teléfono (origen)">
                                <Input
                                    placeholder="+59899123456"
                                    value={provider.phoneNumber}
                                    onChange={(e) =>
                                        setProvider((p) => ({
                                            ...p,
                                            phoneNumber: e.target.value,
                                        }))
                                    }
                                />
                            </Field>
                            <Field label="Sender ID / Número remitente">
                                <Input
                                    placeholder="TEKO"
                                    value={provider.senderId}
                                    onChange={(e) =>
                                        setProvider((p) => ({
                                            ...p,
                                            senderId: e.target.value,
                                        }))
                                    }
                                />
                            </Field>
                        </div>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiCheckCircle className="h-5 w-5 text-gray-500" />
                            Probar envío
                        </h5>
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="flex-1 min-w-[200px]">
                                <Field label="Número de destino">
                                    <Input
                                        placeholder="+59899123456"
                                        value={testPhone}
                                        onChange={(e) =>
                                            setTestPhone(e.target.value)
                                        }
                                    />
                                </Field>
                            </div>
                            <Button
                                variant="solid"
                                loading={testing}
                                onClick={handleTestSend}
                            >
                                Enviar SMS de prueba
                            </Button>
                            {testResult && (
                                <Badge
                                    color={
                                        testResult.ok ? 'success' : 'danger'
                                    }
                                    className="flex items-center gap-1"
                                >
                                    {testResult.ok ? (
                                        <PiCheckCircle className="h-4 w-4" />
                                    ) : (
                                        <PiX className="h-4 w-4" />
                                    )}
                                    {testResult.message}
                                </Badge>
                            )}
                        </div>
                    </Card>

                    <div className="flex justify-end gap-2">
                        <Button
                            variant="default"
                            onClick={() =>
                                setProvider(smsState.settings.provider)
                            }
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="solid"
                            loading={saving}
                            onClick={handleSaveProvider}
                        >
                            Guardar configuración
                        </Button>
                    </div>
                </div>
            )}

            {/* Tab 1: Plantillas SMS */}
            {activeTab === 1 && (
                <div className="mt-6 space-y-4">
                    {smsState.settings.templates.map((template) => (
                        <Card key={template.id}>
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h5 className="font-medium heading-text">
                                            {template.name}
                                        </h5>
                                        <Badge
                                            color="info"
                                            className="text-xs"
                                        >
                                            {template.category}
                                        </Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 font-mono">
                                        {template.content || '(vacía)'}
                                    </p>
                                    {template.variables.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {template.variables.map((v) => (
                                                <Badge
                                                    key={v}
                                                    color="warning"
                                                    className="text-xs"
                                                >
                                                    {'{'}{v}{'}'}
                                                </Badge>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex shrink-0 gap-1">
                                    <Button
                                        size="xs"
                                        variant="default"
                                        onClick={() =>
                                            openEditTemplate(template)
                                        }
                                    >
                                        Editar
                                    </Button>
                                    <ConfirmDialog
                                        isOpen={resetConfirm === template.id}
                                        onClose={() => setResetConfirm(null)}
                                        onConfirm={() =>
                                            handleResetTemplate(template.id)
                                        }
                                        title="Restablecer plantilla"
                                        body={`¿Restablecer "${template.name}" a los valores predeterminados?`}
                                        confirmText="Restablecer"
                                        confirmVariant="danger"
                                    >
                                        <Button
                                            size="xs"
                                            variant="default"
                                            onClick={() =>
                                                setResetConfirm(template.id)
                                            }
                                        >
                                            <PiTrash className="h-3.5 w-3.5" />
                                        </Button>
                                    </ConfirmDialog>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Tab 2: Ajustes y costos */}
            {activeTab === 2 && (
                <div className="mt-6 space-y-6">
                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiGear className="h-5 w-5 text-gray-500" />
                            Ajustes generales
                        </h5>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium heading-text">
                                        Habilitar SMS
                                    </p>
                                    <p className="text-sm text-gray-400">
                                        Envío automático de mensajes SMS
                                        transaccionales
                                    </p>
                                </div>
                                <Switcher
                                    checked={smsState.settings.enabled}
                                    onChange={(v) =>
                                        setSmsState((prev) =>
                                            prev
                                                ? {
                                                      ...prev,
                                                      settings: {
                                                          ...prev.settings,
                                                          enabled: v,
                                                      },
                                                  }
                                                : null,
                                        )
                                    }
                                />
                            </div>
                            <div className="border-t pt-4 dark:border-gray-700">
                                <Field label="Límite de velocidad (SMS por minuto)">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={100}
                                        value={smsState.settings.rateLimit}
                                        onChange={(e) =>
                                            setSmsState((prev) =>
                                                prev
                                                    ? {
                                                          ...prev,
                                                          settings: {
                                                              ...prev.settings,
                                                              rateLimit:
                                                                  parseInt(
                                                                      e.target
                                                                          .value,
                                                                      10,
                                                                  ) || 30,
                                                          },
                                                      }
                                                    : null,
                                            )
                                        }
                                    />
                                </Field>
                            </div>
                            <div className="border-t pt-4 dark:border-gray-700">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium heading-text">
                                            Acuses de recibo
                                        </p>
                                        <p className="text-sm text-gray-400">
                                            Registrar el estado de entrega de
                                            cada SMS
                                        </p>
                                    </div>
                                    <Switcher
                                        checked={
                                            smsState.settings.deliveryReceipts
                                        }
                                        onChange={(v) =>
                                            setSmsState((prev) =>
                                                prev
                                                    ? {
                                                          ...prev,
                                                          settings: {
                                                              ...prev.settings,
                                                              deliveryReceipts: v,
                                                          },
                                                      }
                                                    : null,
                                            )
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiWarning className="h-5 w-5 text-gray-500" />
                            Manejo de errores
                        </h5>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            <Field label="Reintentos máximos">
                                <Input
                                    type="number"
                                    min={0}
                                    max={10}
                                    value={smsState.settings.errorHandling.maxRetries}
                                    onChange={(e) =>
                                        setSmsState((prev) =>
                                            prev
                                                ? {
                                                      ...prev,
                                                      settings: {
                                                          ...prev.settings,
                                                          errorHandling: {
                                                              ...prev.settings
                                                                  .errorHandling,
                                                              maxRetries:
                                                                  parseInt(
                                                                      e.target
                                                                          .value,
                                                                      10,
                                                                  ) || 3,
                                                          },
                                                      },
                                                  }
                                                : null,
                                        )
                                    }
                                />
                            </Field>
                            <Field label="Retraso entre reintentos (segundos)">
                                <Input
                                    type="number"
                                    min={1}
                                    value={smsState.settings.errorHandling.retryDelaySeconds}
                                    onChange={(e) =>
                                        setSmsState((prev) =>
                                            prev
                                                ? {
                                                      ...prev,
                                                      settings: {
                                                          ...prev.settings,
                                                          errorHandling: {
                                                              ...prev.settings
                                                                  .errorHandling,
                                                              retryDelaySeconds:
                                                                  parseInt(
                                                                      e.target
                                                                          .value,
                                                                      10,
                                                                  ) || 60,
                                                          },
                                                      },
                                                  }
                                                : null,
                                        )
                                    }
                                />
                            </Field>
                            <Field label="Proveedor de respaldo">
                                <Select
                                    options={FAILOVER_OPTS}
                                    value={
                                        FAILOVER_OPTS.find(
                                            (o) =>
                                                o.value ===
                                                smsState.settings.errorHandling
                                                    .failoverProvider,
                                        )
                                    }
                                    onChange={(o) =>
                                        setSmsState((prev) =>
                                            prev
                                                ? {
                                                      ...prev,
                                                      settings: {
                                                          ...prev.settings,
                                                          errorHandling: {
                                                              ...prev.settings
                                                                  .errorHandling,
                                                              failoverProvider:
                                                                  (o?.value ??
                                                                      'none') as SmsProvider | 'none',
                                                          },
                                                      },
                                                  }
                                                : null,
                                        )
                                    }
                                />
                            </Field>
                        </div>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiArrowRight className="h-5 w-5 text-gray-500" />
                            Costos por tipo
                        </h5>
                        <Table>
                            <THead>
                                <Tr>
                                    <Th>Tipo</Th>
                                    <Th>Cantidad</Th>
                                    <Th>Costo</Th>
                                    <Th>% del total</Th>
                                </Tr>
                            </THead>
                            <TBody>
                                {costs.byType.map((item) => {
                                    const pct =
                                        costs.estimatedCost > 0
                                            ? (
                                                  (item.cost /
                                                      costs.estimatedCost) *
                                                  100
                                              ).toFixed(1)
                                            : '0'
                                    return (
                                        <Tr key={item.type}>
                                            <Td className="font-medium heading-text">
                                                {item.type}
                                            </Td>
                                            <Td>
                                                {item.count.toLocaleString()}
                                            </Td>
                                            <Td>
                                                ${item.cost.toFixed(2)}
                                            </Td>
                                            <Td>
                                                <div className="flex items-center gap-2">
                                                    <Progress
                                                        percent={
                                                            parseFloat(pct)
                                                        }
                                                        color="bg-blue-500"
                                                        height={6}
                                                    />
                                                    <span className="text-xs text-gray-500">
                                                        {pct}%
                                                    </span>
                                                </div>
                                            </Td>
                                        </Tr>
                                    )
                                })}
                            </TBody>
                        </Table>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiArrowRight className="h-5 w-5 text-gray-500" />
                            Tendencia de envío y costos
                        </h5>
                        <Suspense
                            fallback={
                                <div className="flex h-48 items-center justify-center">
                                    <Spinner size={32} />
                                </div>
                            }
                        >
                            <Chart
                                type="bar"
                                series={[
                                    {
                                        name: 'SMS enviados',
                                        data: costs.trend.map((t) => t.count),
                                    },
                                    {
                                        name: 'Costo ($)',
                                        data: costs.trend.map(
                                            (t) => t.cost * 10,
                                        ),
                                    },
                                ]}
                                xAxis={costs.trend.map((t) => t.month)}
                                height={260}
                                customOptions={{
                                    plotOptions: {
                                        bar: {
                                            borderRadius: 4,
                                            columnWidth: '60%',
                                        },
                                    },
                                    chart: {
                                        toolbar: { show: false },
                                    },
                                }}
                            />
                        </Suspense>
                    </Card>
                </div>
            )}

            {/* Editar plantilla */}
            <Dialog
                isOpen={Boolean(editingTemplate)}
                onClose={() => setEditingTemplate(null)}
                onRequestClose={() => setEditingTemplate(null)}
                width={640}
            >
                <h5 className="mb-4">
                    Editar: {editingTemplate?.name}
                </h5>
                {editingTemplate && (
                    <div className="space-y-4">
                        <Field
                            label="Variables disponibles"
                            hint={
                                editingTemplate.variables.length > 0
                                    ? editingTemplate.variables
                                          .map((v) => `{'{'}${v}{'}'}`)
                                          .join(', ')
                                    : 'Sin variables'
                            }
                        >
                            <div className="flex flex-wrap gap-1">
                                {editingTemplate.variables.map((v) => (
                                    <Badge
                                        key={v}
                                        color="warning"
                                        className="text-xs"
                                    >
                                        {'{'}{v}{'}'}
                                    </Badge>
                                ))}
                            </div>
                        </Field>
                        <Field label="Contenido del SMS">
                            <textarea
                                className="min-h-[120px] w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                placeholder="Escribí el contenido del SMS..."
                            />
                            <p className="mt-1 text-xs text-gray-400">
                                {editContent.length}/160 caracteres (
                                {editContent.length > 160
                                    ? Math.ceil(
                                          editContent.length / 160,
                                      )
                                    : 1}{' '}
                                segmento{Math.ceil(editContent.length / 160) !== 1 ? 's' : ''})
                            </p>
                        </Field>
                    </div>
                )}
                <div className="mt-5 flex justify-end gap-2">
                    <Button
                        variant="default"
                        onClick={() => setEditingTemplate(null)}
                    >
                        Cancelar
                    </Button>
                    <Button variant="solid" onClick={handleSaveTemplate}>
                        Guardar cambios
                    </Button>
                </div>
            </Dialog>
        </div>
    )
}

export default SettingsSMS
