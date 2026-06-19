import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Switcher from '@/components/ui/Switcher'
import Progress from '@/components/ui/Progress'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import Badge from '@/components/ui/Badge'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import classNames from '@/utils/classNames'
import {
    PiBell,
    PiBellRinging,
    PiCheckCircle,
    PiWarning,
    PiWarningCircle,
    PiEnvelope,
    PiPhone,
    PiWebcam,
} from 'react-icons/pi'

interface AlertThreshold {
    level: number
    enabled: boolean
    channels: string[]
}

const THRESHOLDS = [50, 75, 90, 100]

const THRESHOLD_LABELS: Record<number, string> = {
    50: '50% - Precaución',
    75: '75% - Advertencia',
    90: '90% - Crítico',
    100: '100% - Límite alcanzado',
}

const THRESHOLD_ICONS: Record<number, typeof PiBell> = {
    50: PiBell,
    75: PiBellRinging,
    90: PiWarning,
    100: PiWarningCircle,
}

const THRESHOLD_COLORS: Record<number, 'emerald' | 'amber' | 'red' | 'rose'> = {
    50: 'emerald',
    75: 'amber',
    90: 'red',
    100: 'rose',
}

function BillingUsageAlerts() {
    const { current, currentId, loading: tLoading } = useTenant()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [usageUsage, setUsageUsage] = useState<{ used: number; limit: number }>({
        used: 0,
        limit: 5000,
    })

    const [thresholds, setThresholds] = useState<AlertThreshold[]>(
        THRESHOLDS.map((level) => ({
            level,
            enabled: true,
            channels: ['email'],
        })),
    )

    const [channels, setChannels] = useState({
        email: true,
        webhook: false,
        sms: false,
    })

    const [webhookUrl, setWebhookUrl] = useState('')
    const [smsNumber, setSmsNumber] = useState('')

    useEffect(() => {
        if (!currentId) {
            setLoading(false)
            return
        }
        setLoading(true)
        tekoApi
            .usage(currentId)
            .then((res) => {
                setUsageUsage({ used: res.total, limit: 5000 })
            })
            .catch((e) => {
                setError((e as Error).message)
            })
            .finally(() => setLoading(false))
    }, [currentId])

    const usagePct =
        usageUsage.limit > 0
            ? Math.round((usageUsage.used / usageUsage.limit) * 100)
            : 0

    const handleThresholdToggle = useCallback((level: number) => {
        setThresholds((prev) =>
            prev.map((t) => (t.level === level ? { ...t, enabled: !t.enabled } : t)),
        )
    }, [])

    const handleChannelToggle = useCallback((level: number, channel: string) => {
        setThresholds((prev) =>
            prev.map((t) => {
                if (t.level !== level) return t
                const has = t.channels.includes(channel)
                return {
                    ...t,
                    channels: has
                        ? t.channels.filter((c) => c !== channel)
                        : [...t.channels, channel],
                }
            }),
        )
    }, [])

    function handleSave() {
        setSaving(true)
        setSaved(false)
        setTimeout(() => {
            setSaving(false)
            setSaved(true)
            setTimeout(() => setSaved(false), 3000)
        }, 1000)
    }

    function handleReset() {
        setThresholds(
            THRESHOLDS.map((level) => ({
                level,
                enabled: true,
                channels: ['email'],
            })),
        )
        setChannels({ email: true, webhook: false, sms: false })
        setWebhookUrl('')
        setSmsNumber('')
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
            <div className="mb-6">
                <h3 className="mb-1">Alertas de Uso</h3>
                <p className="text-gray-500">
                    {current
                        ? `Configura las alertas de uso para ${current.name}`
                        : 'Configura las alertas de uso'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-6" type="danger">
                    {error}
                </Alert>
            )}

            {saved && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                >
                    <Alert showIcon className="mb-6" type="success">
                        Configuración de alertas guardada correctamente.
                    </Alert>
                </motion.div>
            )}

            {loading ? (
                <div className="space-y-6">
                    <Card>
                        <Skeleton className="h-6 w-48 mb-4" />
                        <Skeleton className="h-4 w-full mb-2" />
                        <Skeleton className="h-4 w-3/4 mb-6" />
                        <Skeleton className="h-12 w-full" />
                    </Card>
                    <div className="grid gap-4 md:grid-cols-2">
                        {[0, 1].map((i) => (
                            <Card key={i}>
                                <Skeleton className="h-6 w-32 mb-4" />
                                {[0, 1, 2].map((j) => (
                                    <Skeleton key={j} className="h-12 w-full mb-3" />
                                ))}
                            </Card>
                        ))}
                    </div>
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-6"
                >
                    {/* Current usage section */}
                    <Card>
                        <div className="flex items-center gap-3 mb-4">
                            <div
                                className={classNames(
                                    'flex h-10 w-10 items-center justify-center rounded-lg',
                                    usagePct >= 90
                                        ? 'bg-red-100 dark:bg-red-500/20'
                                        : usagePct >= 75
                                            ? 'bg-amber-100 dark:bg-amber-500/20'
                                            : 'bg-emerald-100 dark:bg-emerald-500/20',
                                )}
                            >
                                <PiBellRinging
                                    className={classNames(
                                        'h-5 w-5',
                                        usagePct >= 90
                                            ? 'text-red-600'
                                            : usagePct >= 75
                                                ? 'text-amber-600'
                                                : 'text-emerald-600',
                                    )}
                                />
                            </div>
                            <div>
                                <h4 className="font-semibold heading-text">Uso Actual</h4>
                                <p className="text-sm text-gray-500">
                                    Monitoreo en tiempo real del consumo del plan
                                </p>
                            </div>
                        </div>

                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-500">
                                    Verificaciones utilizadas
                                </span>
                                <span className="text-sm font-semibold heading-text">
                                    {usageUsage.used} / {usageUsage.limit}
                                </span>
                            </div>
                            <Progress
                                value={usagePct}
                                max={100}
                                color={
                                    usagePct >= 90
                                        ? 'red'
                                        : usagePct >= 75
                                            ? 'amber'
                                            : 'emerald'
                                }
                                showLabel
                                className="mb-2"
                            />
                            <div className="flex items-center justify-between text-xs text-gray-400">
                                <span>0</span>
                                <span>{usagePct}% utilizado</span>
                                <span>{usageUsage.limit}</span>
                            </div>
                        </div>

                        {usagePct >= 90 && (
                            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                                <PiWarningCircle className="mt-0.5 w-5 h-5 flex-shrink-0" />
                                <div>
                                    <span className="font-semibold">Límite crítico:</span> Has
                                    alcanzado el {usagePct}% de tu límite mensual. Se han
                                    activado todas las alertas.
                                </div>
                            </div>
                        )}

                        {usagePct >= 75 && usagePct < 90 && (
                            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                <PiWarning className="mt-0.5 w-5 h-5 flex-shrink-0" />
                                <div>
                                    <span className="font-semibold">Advertencia:</span> Has
                                    alcanzado el {usagePct}% de tu límite mensual. Revisa tu
                                    configuración de alertas.
                                </div>
                            </div>
                        )}
                    </Card>

                    {/* Threshold alerts */}
                    <Card>
                        <div className="flex items-center gap-3 mb-6">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/20">
                                <PiBell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold heading-text">Umbral de Alertas</h4>
                                <p className="text-sm text-gray-500">
                                    Configura notificaciones automáticas al alcanzar ciertos
                                    porcentajes de uso
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {thresholds.map((threshold) => {
                                const Icon = THRESHOLD_ICONS[threshold.level]
                                const color = THRESHOLD_COLORS[threshold.level]
                                return (
                                    <div
                                        key={threshold.level}
                                        className={classNames(
                                            'flex items-center justify-between rounded-lg border p-4 transition-colors',
                                            threshold.enabled
                                                ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'
                                                : 'border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30 opacity-60',
                                        )}
                                    >
                                        <div className="flex items-center gap-4 flex-1">
                                            <div
                                                className={classNames(
                                                    'flex h-10 w-10 items-center justify-center rounded-lg',
                                                    color === 'emerald' &&
                                                        'bg-emerald-100 dark:bg-emerald-500/20',
                                                    color === 'amber' &&
                                                        'bg-amber-100 dark:bg-amber-500/20',
                                                    color === 'red' &&
                                                        'bg-red-100 dark:bg-red-500/20',
                                                    color === 'rose' &&
                                                        'bg-rose-100 dark:bg-rose-500/20',
                                                )}
                                            >
                                                <Icon
                                                    className={classNames(
                                                        'h-5 w-5',
                                                        color === 'emerald' && 'text-emerald-600',
                                                        color === 'amber' && 'text-amber-600',
                                                        color === 'red' && 'text-red-600',
                                                        color === 'rose' && 'text-rose-600',
                                                    )}
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium heading-text">
                                                        {THRESHOLD_LABELS[threshold.level]}
                                                    </span>
                                                    <Badge
                                                        variant="solid"
                                                        color={color}
                                                        className="text-xs"
                                                    >
                                                        {threshold.level}%
                                                    </Badge>
                                                </div>
                                                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                                                    <span
                                                        className={classNames(
                                                            'flex items-center gap-1',
                                                            channels.email &&
                                                                'text-blue-600 dark:text-blue-400',
                                                        )}
                                                    >
                                                        <PiEnvelope className="w-3 h-3" />
                                                        Email
                                                    </span>
                                                    <span
                                                        className={classNames(
                                                            'flex items-center gap-1',
                                                            channels.webhook &&
                                                                'text-blue-600 dark:text-blue-400',
                                                        )}
                                                    >
                                                        <PiWebcam className="w-3 h-3" />
                                                        Webhook
                                                    </span>
                                                    <span
                                                        className={classNames(
                                                            'flex items-center gap-1',
                                                            channels.sms &&
                                                                'text-blue-600 dark:text-blue-400',
                                                        )}
                                                    >
                                                        <PiPhone className="w-3 h-3" />
                                                        SMS
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <Switcher
                                            checked={threshold.enabled}
                                            onChange={() => handleThresholdToggle(threshold.level)}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                    </Card>

                    {/* Notification channels */}
                    <Card>
                        <div className="flex items-center gap-3 mb-6">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-500/20">
                                <PiEnvelope className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold heading-text">
                                    Canales de Notificación
                                </h4>
                                <p className="text-sm text-gray-500">
                                    Selecciona los canales por los cuales recibirás las alertas
                                </p>
                            </div>
                        </div>

                        <div className="space-y-6">
                            {/* Email */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-500/20">
                                        <PiEnvelope className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                    </div>
                                    <div>
                                        <div className="font-medium heading-text">Email</div>
                                        <div className="text-sm text-gray-500">
                                            Recibe alertas en tu correo electrónico
                                        </div>
                                    </div>
                                </div>
                                <Switcher
                                    checked={channels.email}
                                    onChange={() =>
                                        setChannels((prev) => ({
                                            ...prev,
                                            email: !prev.email,
                                        }))
                                    }
                                />
                            </div>

                            {channels.email && (
                                <div className="ml-14">
                                    <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                        Correo electrónico
                                    </label>
                                    <Input
                                        type="email"
                                        placeholder="admin@empresa.com"
                                        defaultValue="admin@tekoverify.com"
                                    />
                                </div>
                            )}

                            {/* Webhook */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-500/20">
                                        <PiWebcam className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <div className="font-medium heading-text">Webhook</div>
                                        <div className="text-sm text-gray-500">
                                            Envía notificaciones a una URL personalizada
                                        </div>
                                    </div>
                                </div>
                                <Switcher
                                    checked={channels.webhook}
                                    onChange={() =>
                                        setChannels((prev) => ({
                                            ...prev,
                                            webhook: !prev.webhook,
                                        }))
                                    }
                                />
                            </div>

                            {channels.webhook && (
                                <div className="ml-14">
                                    <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                        URL del webhook
                                    </label>
                                    <Input
                                        placeholder="https://api.tu-servicio.com/webhooks/alertas"
                                        value={webhookUrl}
                                        onChange={(e) => setWebhookUrl(e.target.value)}
                                    />
                                </div>
                            )}

                            {/* SMS */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-500/20">
                                        <PiPhone className="h-5 w-5 text-green-600 dark:text-green-400" />
                                    </div>
                                    <div>
                                        <div className="font-medium heading-text">SMS</div>
                                        <div className="text-sm text-gray-500">
                                            Recibe alertas por mensaje de texto
                                        </div>
                                    </div>
                                </div>
                                <Switcher
                                    checked={channels.sms}
                                    onChange={() =>
                                        setChannels((prev) => ({
                                            ...prev,
                                            sms: !prev.sms,
                                        }))
                                    }
                                />
                            </div>

                            {channels.sms && (
                                <div className="ml-14">
                                    <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                        Número de teléfono
                                    </label>
                                    <Input
                                        placeholder="+595 9XX XXX XXX"
                                        value={smsNumber}
                                        onChange={(e) => setSmsNumber(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-3">
                        <Button variant="outline" onClick={handleReset}>
                            Restablecer
                        </Button>
                        <Button
                            variant="solid"
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? (
                                <>
                                    <Spinner className="w-4 h-4" />
                                    <span>Guardando...</span>
                                </>
                            ) : (
                                <>
                                    <PiCheckCircle className="w-4 h-4" />
                                    <span>Guardar configuración</span>
                                </>
                            )}
                        </Button>
                    </div>
                </motion.div>
            )}
        </div>
    )
}

export default BillingUsageAlerts
