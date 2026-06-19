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
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { Tenant, TenantPolicy } from '@/teko/types'
import { PiEnvelope, PiGear, PiTrash, PiCopy, PiCheckCircle, PiWarning, PiX, PiArrowRight } from 'react-icons/pi'
import classNames from '@/utils/classNames'

const Chart = lazy(() => import('@/components/shared/Chart'))

type Encryption = 'tls' | 'ssl' | 'none'
type Provider = 'twilio' | 'aws_sns' | 'custom'

interface SmtpConfig {
    host: string
    port: number
    username: string
    password: string
    encryption: Encryption
    fromName: string
    fromEmail: string
    replyTo: string
    enabled: boolean
    rateLimit: number
    trackOpens: boolean
    bounceHandling: boolean
}

interface EmailTemplate {
    id: string
    name: string
    subject: string
    preview: string
    body: string
    category: string
}

interface EmailSettings {
    templates: EmailTemplate[]
    smtp: SmtpConfig
    smtpTestResult: { ok: boolean; message: string } | null
    emailSentsThisMonth: number
    emailCostThisMonth: number
    emailBounceRate: number
    emailOpenRate: number
}

const DEFAULT_SMTP: SmtpConfig = {
    host: '',
    port: 587,
    username: '',
    password: '',
    encryption: 'tls',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    enabled: true,
    rateLimit: 60,
    trackOpens: true,
    bounceHandling: true,
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
    {
        id: 'verification_link',
        name: 'Enlace de verificación',
        subject: 'Completa tu verificación de identidad',
        preview: 'Haz clic en el enlace para comenzar tu proceso...',
        body: '',
        category: 'verificacion',
    },
    {
        id: 'session_result',
        name: 'Resultado de sesión',
        subject: 'Tu verificación ha sido completada',
        preview: 'Nos complace informarte que tu verificación...',
        body: '',
        category: 'resultados',
    },
    {
        id: 'reminder',
        name: 'Recordatorio',
        subject: 'Recuerda completar tu verificación',
        preview: 'Te recordamos que aún no has completado...',
        body: '',
        category: 'recordatorios',
    },
    {
        id: 'aml_alert',
        name: 'Alerta AML',
        subject: 'Se requiere revisión adicional',
        preview: 'Tu verificación requiere una revisión manual...',
        body: '',
        category: 'alertas',
    },
    {
        id: 'welcome',
        name: 'Mensaje de bienvenida',
        subject: 'Bienvenido a Teko Verify',
        preview: 'Gracias por registrarte. Para comenzar...',
        body: '',
        category: 'bienvenida',
    },
]

const ENCRYPTION_OPTS = [
    { value: 'tls', label: 'TLS' },
    { value: 'ssl', label: 'SSL' },
    { value: 'none', label: 'Ninguna' },
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

function notify(msg: string, type: 'success' | 'danger' = 'success') {
    toast.push(
        <Notification title="Email" type={type}>{msg}</Notification>,
        { placement: 'top-center' },
    )
}

const SettingsEmail = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [settings, setSettings] = useState<EmailSettings | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState(0)

    // SMTP form state
    const [smtp, setSmtp] = useState<SmtpConfig>(DEFAULT_SMTP)
    const [showPassword, setShowPassword] = useState(false)

    // Template editing
    const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null)
    const [editSubject, setEditSubject] = useState('')
    const [editBody, setEditBody] = useState('')

    // Test connection
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

    // Reset confirmation
    const [resetConfirm, setResetConfirm] = useState<string | null>(null)

    const loadSettings = useCallback(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        setTimeout(() => {
            setSettings({
                templates: DEFAULT_TEMPLATES,
                smtp: { ...DEFAULT_SMTP, fromName: current?.name ?? '' },
                smtpTestResult: null,
                emailSentsThisMonth: 1247,
                emailCostThisMonth: 62.35,
                emailBounceRate: 1.2,
                emailOpenRate: 34.5,
            })
            setSmtp({ ...DEFAULT_SMTP, fromName: current?.name ?? '' })
            setLoading(false)
        }, 600)
    }, [currentId, current])

    useEffect(() => {
        loadSettings()
    }, [loadSettings])

    async function handleSaveSmtp() {
        if (!currentId) return
        if (!smtp.fromEmail.trim()) {
            setError('El email remitente es obligatorio.')
            return
        }
        setSaving(true)
        setError(null)
        try {
            setSettings((prev) =>
                prev ? { ...prev, smtp: { ...smtp } } : null
            )
            notify('Configuración SMTP guardada correctamente.')
        } catch (e) {
            setError((e as Error).message)
            notify((e as Error).message, 'danger')
        } finally {
            setSaving(false)
        }
    }

    async function handleTestConnection() {
        setTesting(true)
        setTestResult(null)
        try {
            await new Promise<void>((resolve) =>
                setTimeout(resolve, 1500)
            )
            setTestResult({
                ok: true,
                message: `Conexión exitosa a ${smtp.host}:${smtp.port} como ${smtp.username}`,
            })
            notify('Prueba de conexión exitosa.')
        } catch (e) {
            setTestResult({
                ok: false,
                message: (e as Error).message,
            })
            notify('Error en la prueba de conexión.', 'danger')
        } finally {
            setTesting(false)
        }
    }

    function openEditTemplate(template: EmailTemplate) {
        setEditingTemplate(template)
        setEditSubject(template.subject)
        setEditBody(template.body)
    }

    function handleSaveTemplate() {
        if (!editingTemplate || !settings) return
        const updated = settings.templates.map((t) =>
            t.id === editingTemplate.id
                ? { ...t, subject: editSubject, body: editBody }
                : t
        )
        setSettings({ ...settings, templates: updated })
        setEditingTemplate(null)
        notify('Plantilla actualizada.')
    }

    function handleResetTemplate(templateId: string) {
        if (!settings) return
        const def = DEFAULT_TEMPLATES.find((t) => t.id === templateId)
        if (!def) return
        const updated = settings.templates.map((t) =>
            t.id === templateId ? { ...def } : t
        )
        setSettings({ ...settings, templates: updated })
        setResetConfirm(null)
        notify('Plantilla restablecida a valores predeterminados.')
    }

    const handleTabChange = (idx: number) => {
        setActiveTab(idx)
        if (idx === 0 && settings) {
            setSmtp(settings.smtp)
        }
    }

    const tabs = [
        { label: 'Configuración SMTP', icon: PiGear },
        { label: 'Plantillas de correo', icon: PiEnvelope },
        { label: 'Ajustes generales', icon: PiArrowRight },
    ]

    if (tLoading || loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Configuración de Email</h3>
                <p className="text-gray-500">
                    {current
                        ? `Configuración de correo electrónico para ${current.name}`
                        : 'Configuración de correo electrónico del tenant'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {settings && (
                <>
                    {/* Métricas rápidas */}
                    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <Card>
                            <div className="text-sm text-gray-500">
                                Enviados este mes
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {settings.emailSentsThisMonth.toLocaleString()}
                            </div>
                        </Card>
                        <Card>
                            <div className="text-sm text-gray-500">
                                Tasa de rebote
                            </div>
                            <div
                                className={classNames(
                                    'text-2xl font-bold',
                                    settings.emailBounceRate > 5
                                        ? 'text-red-600'
                                        : settings.emailBounceRate > 2
                                            ? 'text-amber-600'
                                            : 'text-emerald-600',
                                )}
                            >
                                {settings.emailBounceRate}%
                            </div>
                        </Card>
                        <Card>
                            <div className="text-sm text-gray-500">
                                Tasa de aperturas
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {settings.emailOpenRate}%
                            </div>
                        </Card>
                        <Card>
                            <div className="text-sm text-gray-500">
                                Costo estimado
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                ${settings.emailCostThisMonth.toFixed(2)}
                            </div>
                        </Card>
                    </div>

                    {/* Tabs principales */}
                    <Tabs
                        items={tabs.map((t) => ({
                            key: String(tabs.indexOf(t)),
                            title: t.label,
                            icon: <t.icon className="h-4 w-4" />,
                        }))}
                        activeKey={String(activeTab)}
                        onChange={(key) => handleTabChange(parseInt(key, 10))}
                    />

                    {/* Tab 0: Configuración SMTP */}
                    {activeTab === 0 && (
                        <div className="mt-6 space-y-6">
                            <Card>
                                <h5 className="mb-4 flex items-center gap-2">
                                    <PiGear className="h-5 w-5 text-gray-500" />
                                    Configuración del servidor SMTP
                                </h5>
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <Field label="Host SMTP">
                                        <Input
                                            placeholder="smtp.tu-proveedor.com"
                                            value={smtp.host}
                                            onChange={(e) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    host: e.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field label="Puerto">
                                        <Input
                                            type="number"
                                            value={smtp.port}
                                            onChange={(e) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    port: parseInt(
                                                        e.target.value,
                                                        10,
                                                    ) || 587,
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field label="Cuenta de usuario">
                                        <Input
                                            placeholder="usuario@tu-dominio.com"
                                            value={smtp.username}
                                            onChange={(e) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    username: e.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field label="Contraseña">
                                        <div className="relative">
                                            <Input
                                                type={
                                                    showPassword
                                                        ? 'text'
                                                        : 'password'
                                                }
                                                placeholder="••••••••"
                                                value={smtp.password}
                                                onChange={(e) =>
                                                    setSmtp((p) => ({
                                                        ...p,
                                                        password: e.target.value,
                                                    }))
                                                }
                                            />
                                            <button
                                                type="button"
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                onClick={() =>
                                                    setShowPassword(
                                                        !showPassword,
                                                    )
                                                }
                                            >
                                                {showPassword ? (
                                                    <PiX className="h-4 w-4" />
                                                ) : (
                                                    <PiEnvelope className="h-4 w-4" />
                                                )}
                                            </button>
                                        </div>
                                    </Field>
                                    <Field label="Cifrado">
                                        <Select
                                            options={ENCRYPTION_OPTS}
                                            value={
                                                ENCRYPTION_OPTS.find(
                                                    (o) =>
                                                        o.value ===
                                                        smtp.encryption,
                                                )
                                            }
                                            onChange={(o) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    encryption: (
                                                        o?.value as Encryption
                                                    ) ?? 'tls',
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field label="Habilitado">
                                        <Switcher
                                            checked={smtp.enabled}
                                            onChange={(v) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    enabled: v,
                                                }))
                                            }
                                        />
                                    </Field>
                                </div>
                            </Card>

                            <Card>
                                <h5 className="mb-4 flex items-center gap-2">
                                    <PiEnvelope className="h-5 w-5 text-gray-500" />
                                    Remitente
                                </h5>
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                                    <Field label="Nombre remitente">
                                        <Input
                                            value={smtp.fromName}
                                            onChange={(e) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    fromName: e.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field label="Email remitente">
                                        <Input
                                            type="email"
                                            value={smtp.fromEmail}
                                            onChange={(e) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    fromEmail: e.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label="Responder a"
                                        hint="Deja vacío para usar el email remitente"
                                    >
                                        <Input
                                            type="email"
                                            value={smtp.replyTo}
                                            onChange={(e) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    replyTo: e.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                </div>
                            </Card>

                            <Card>
                                <h5 className="mb-4 flex items-center gap-2">
                                    <PiGear className="h-5 w-5 text-gray-500" />
                                    Probar conexión
                                </h5>
                                <div className="flex items-center gap-3">
                                    <Button
                                        variant="solid"
                                        loading={testing}
                                        onClick={handleTestConnection}
                                    >
                                        Probar conexión SMTP
                                    </Button>
                                    {testResult && (
                                        <Badge
                                            color={
                                                testResult.ok
                                                    ? 'success'
                                                    : 'danger'
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
                                        settings && setSmtp(settings.smtp)
                                    }
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    variant="solid"
                                    loading={saving}
                                    onClick={handleSaveSmtp}
                                >
                                    Guardar configuración
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Tab 1: Plantillas */}
                    {activeTab === 1 && (
                        <div className="mt-6 space-y-4">
                            {settings.templates.map((template) => (
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
                                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                                                {template.subject}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-400">
                                                {template.preview}
                                            </p>
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
                                                isOpen={
                                                    resetConfirm ===
                                                    template.id
                                                }
                                                onClose={() =>
                                                    setResetConfirm(null)
                                                }
                                                onConfirm={() =>
                                                    handleResetTemplate(
                                                        template.id,
                                                    )
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
                                                        setResetConfirm(
                                                            template.id,
                                                        )
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

                    {/* Tab 2: Ajustes generales */}
                    {activeTab === 2 && (
                        <div className="mt-6 space-y-6">
                            <Card>
                                <h5 className="mb-4">
                                    Correos transaccionales
                                </h5>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-medium heading-text">
                                                Habilitar correos
                                                transaccionales
                                            </p>
                                            <p className="text-sm text-gray-400">
                                                Envío automático de correos de
                                                verificación, resultados y
                                                recordatorios
                                            </p>
                                        </div>
                                        <Switcher
                                            checked={smtp.enabled}
                                            onChange={(v) =>
                                                setSmtp((p) => ({
                                                    ...p,
                                                    enabled: v,
                                                }))
                                            }
                                        />
                                    </div>
                                    <div className="border-t pt-4 dark:border-gray-700">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-medium heading-text">
                                                    Seguimiento de aperturas
                                                </p>
                                                <p className="text-sm text-gray-400">
                                                    Registrar cuándo un usuario
                                                    abre un correo electrónico
                                                </p>
                                            </div>
                                            <Switcher
                                                checked={smtp.trackOpens}
                                                onChange={(v) =>
                                                    setSmtp((p) => ({
                                                        ...p,
                                                        trackOpens: v,
                                                    }))
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="border-t pt-4 dark:border-gray-700">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-medium heading-text">
                                                    Manejo de rebotes
                                                </p>
                                                <p className="text-sm text-gray-400">
                                                    Detectar y procesar correos
                                                    rebotados automáticamente
                                                </p>
                                            </div>
                                            <Switcher
                                                checked={smtp.bounceHandling}
                                                onChange={(v) =>
                                                    setSmtp((p) => ({
                                                        ...p,
                                                        bounceHandling: v,
                                                    }))
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="border-t pt-4 dark:border-gray-700">
                                        <Field label="Límite de velocidad (correos por minuto)">
                                            <Input
                                                type="number"
                                                min={1}
                                                max={1000}
                                                value={smtp.rateLimit}
                                                onChange={(e) =>
                                                    setSmtp((p) => ({
                                                        ...p,
                                                        rateLimit:
                                                            parseInt(
                                                                e.target.value,
                                                                10,
                                                            ) || 60,
                                                    }))
                                                }
                                            />
                                        </Field>
                                    </div>
                                </div>
                                <div className="mt-4 flex justify-end">
                                    <Button
                                        variant="solid"
                                        loading={saving}
                                        onClick={handleSaveSmtp}
                                    >
                                        Guardar ajustes
                                    </Button>
                                </div>
                            </Card>

                            <Card>
                                <h5 className="mb-4 flex items-center gap-2">
                                    <PiWarning className="h-5 w-5 text-amber-500" />
                                    Estadísticas de rendimiento
                                </h5>
                                <Suspense
                                    fallback={
                                        <div className="flex h-48 items-center justify-center">
                                            <Spinner size={32} />
                                        </div>
                                    }
                                >
                                    <Chart
                                        type="line"
                                        series={[
                                            {
                                                name: 'Enviados',
                                                data: [
                                                    120, 180, 95, 210, 160,
                                                    240, 190, 280, 200, 310,
                                                    250, 290,
                                                ],
                                            },
                                            {
                                                name: 'Abiertos',
                                                data: [
                                                    45, 60, 35, 70, 55, 80,
                                                    65, 95, 75, 100, 85,
                                                    98,
                                                ],
                                            },
                                        ]}
                                        xAxis={[
                                            'Ene',
                                            'Feb',
                                            'Mar',
                                            'Abr',
                                            'May',
                                            'Jun',
                                            'Jul',
                                            'Ago',
                                            'Sep',
                                            'Oct',
                                            'Nov',
                                            'Dic',
                                        ]}
                                        height={260}
                                    />
                                </Suspense>
                            </Card>
                        </div>
                    )}
                </>
            )}

            {/* Editar plantilla */}
            <Dialog
                isOpen={Boolean(editingTemplate)}
                onClose={() => setEditingTemplate(null)}
                onRequestClose={() => setEditingTemplate(null)}
                width={720}
            >
                <h5 className="mb-4">
                    Editar: {editingTemplate?.name}
                </h5>
                <div className="space-y-4">
                    <Field label="Asunto">
                        <Input
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                        />
                    </Field>
                    <Field label="Cuerpo del correo">
                        <textarea
                            className="min-h-[200px] w-full rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-800 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            placeholder="Escribí el cuerpo del correo..."
                        />
                    </Field>
                </div>
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

export default SettingsEmail
