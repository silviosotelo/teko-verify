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
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { Tenant, TenantPolicy } from '@/teko/types'
import {  PiTrash, PiCopy, PiCheckCircle, PiWarning, PiX, PiArrowRight, PiDatabase, PiCloud, PiCloudArrowUp, PiPlugsConnected, PiLock, PiShieldCheck } from 'react-icons/pi'
import classNames from '@/utils/classNames'

const Chart = lazy(() => import('@/components/shared/Chart'))

interface StorageUsage {
    totalAllocated: number
    totalUsed: number
    byType: {
        evidence: number
        logs: number
        database: number
        other: number
    }
    growthTrend: Array<{ month: string; used: number }>
}

interface RetentionPolicies {
    sessionDataDays: number
    evidenceDays: number
    auditLogDays: number
    autoDelete: boolean
}

interface StorageSettings {
    maxFileSizeMB: number
    allowedTypes: string
    compressionEnabled: boolean
    compressionLevel: number
    cloudProvider: 'local' | 's3' | 'azure' | 'gcs'
    cloudBucket: string
    cloudRegion: string
    cdnEnabled: boolean
    cdnUrl: string
}

interface StorageSettingsState {
    usage: StorageUsage
    retention: RetentionPolicies
    storage: StorageSettings
    loading: boolean
}

const STORAGE_UNITS = ['MB', 'GB', 'TB']

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const unitIndex = Math.min(Math.floor(i / 3), STORAGE_UNITS.length - 1)
    const unit = STORAGE_UNITS[unitIndex]
    const converted = bytes / Math.pow(k, unitIndex * 3 + 3)
    return `${(bytes / Math.pow(1024, Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 2))).toFixed(1)} ${unit}`
}

function bytesFromHuman(str: string): number {
    const match = str.match(/^([\d.]+)\s*(MB|GB|TB)$/i)
    if (!match) return 0
    const [, value, unit] = match
    const num = parseFloat(value)
    const multiplier =
        unit.toUpperCase() === 'GB' ? 1024 : unit.toUpperCase() === 'TB' ? 1048576 : 1
    return num * multiplier
}

const DEFAULT_RETENTION: RetentionPolicies = {
    sessionDataDays: 365,
    evidenceDays: 730,
    auditLogDays: 2555,
    autoDelete: true,
}

const DEFAULT_STORAGE: StorageSettings = {
    maxFileSizeMB: 50,
    allowedTypes: 'image/jpeg,image/png,image/webp,application/pdf,video/mp4',
    compressionEnabled: true,
    compressionLevel: 6,
    cloudProvider: 's3',
    cloudBucket: '',
    cloudRegion: 'us-east-1',
    cdnEnabled: false,
    cdnUrl: '',
}

const CLOUD_PROVIDERS = [
    { value: 'local', label: 'Almacenamiento local' },
    { value: 's3', label: 'AWS S3' },
    { value: 'azure', label: 'Azure Blob' },
    { value: 'gcs', label: 'Google Cloud Storage' },
] as const

const REGION_OPTS = [
    { value: 'us-east-1', label: 'US Este (N. Virginia)' },
    { value: 'us-west-2', label: 'US Oeste (Oregón)' },
    { value: 'eu-west-1', label: 'Europa (Irlanda)' },
    { value: 'sa-east-1', label: 'Sudamérica (São Paulo)' },
    { value: 'ap-southeast-1', label: 'Asia Pacífico (Singapur)' },
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
        <Notification title="Almacenamiento" type={type}>{msg}</Notification>,
        { placement: 'top-center' },
    )
}

const SettingsStorage = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [settings, setSettings] = useState<StorageSettingsState | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [activeTab, setActiveTab] = useState(0)

    const [retention, setRetention] = useState<RetentionPolicies>(DEFAULT_RETENTION)
    const [storage, setStorage] = useState<StorageSettings>(DEFAULT_STORAGE)

    const loadSettings = useCallback(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        setTimeout(() => {
            const allocated = 100 * 1024 * 1024 * 1024
            const used = 37.8 * 1024 * 1024 * 1024
            setSettings({
                usage: {
                    totalAllocated: allocated,
                    totalUsed: used,
                    byType: {
                        evidence: 24.5 * 1024 * 1024 * 1024,
                        logs: 3.2 * 1024 * 1024 * 1024,
                        database: 7.1 * 1024 * 1024 * 1024,
                        other: 3.0 * 1024 * 1024 * 1024,
                    },
                    growthTrend: [
                        { month: 'Jul', used: 28.2 },
                        { month: 'Ago', used: 29.8 },
                        { month: 'Sep', used: 31.1 },
                        { month: 'Oct', used: 32.4 },
                        { month: 'Nov', used: 33.5 },
                        { month: 'Dic', used: 34.2 },
                        { month: 'Ene', used: 35.0 },
                        { month: 'Feb', used: 35.8 },
                        { month: 'Mar', used: 36.1 },
                        { month: 'Abr', used: 36.7 },
                        { month: 'May', used: 37.2 },
                        { month: 'Jun', used: 37.8 },
                    ],
                },
                retention: { ...DEFAULT_RETENTION },
                storage: { ...DEFAULT_STORAGE },
                loading: false,
            })
            setRetention({ ...DEFAULT_RETENTION })
            setStorage({ ...DEFAULT_STORAGE })
            setLoading(false)
        }, 600)
    }, [currentId])

    useEffect(() => {
        loadSettings()
    }, [loadSettings])

    async function handleSaveRetention() {
        if (!currentId) return
        setSaving(true)
        setError(null)
        try {
            setSettings((prev) =>
                prev ? { ...prev, retention: { ...retention } } : null
            )
            notify('Políticas de retención guardadas.')
        } catch (e) {
            setError((e as Error).message)
            notify((e as Error).message, 'danger')
        } finally {
            setSaving(false)
        }
    }

    async function handleSaveStorage() {
        if (!currentId) return
        if (storage.cloudProvider !== 'local' && !storage.cloudBucket.trim()) {
            setError('El nombre del bucket es obligatorio.')
            return
        }
        setSaving(true)
        setError(null)
        try {
            setSettings((prev) =>
                prev ? { ...prev, storage: { ...storage } } : null
            )
            notify('Configuración de almacenamiento guardada.')
        } catch (e) {
            setError((e as Error).message)
            notify((e as Error).message, 'danger')
        } finally {
            setSaving(false)
        }
    }

    const handleTabChange = (idx: number) => {
        setActiveTab(idx)
        if (settings) {
            if (idx === 1) setRetention(settings.retention)
            if (idx === 2) setStorage(settings.storage)
        }
    }

    const tabs = [
        { label: 'Uso de almacenamiento', icon: <span>💾</span> },
        { label: 'Políticas de retención', icon: <span>🛡️</span> },
        { label: 'Ajustes generales', icon: <span>⚙️</span> },
    ]

    if (tLoading || loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    if (!settings) return null

    const usagePct =
        settings.usage.totalAllocated > 0
            ? Math.round(
                  (settings.usage.totalUsed / settings.usage.totalAllocated) *
                      100,
              )
            : 0

    const usageColor =
        usagePct > 90
            ? 'bg-red-500'
            : usagePct > 75
              ? 'bg-amber-500'
              : 'bg-emerald-500'

    const usageBarColor =
        usagePct > 90
            ? 'text-red-600'
            : usagePct > 75
              ? 'text-amber-600'
              : 'text-emerald-600'

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Almacenamiento</h3>
                <p className="text-gray-500">
                    {current
                        ? `Configuración de almacenamiento para ${current.name}`
                        : 'Configuración de almacenamiento del tenant'}
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
                        Almacenamiento total
                    </div>
                    <div className="text-2xl font-bold heading-text">
                        {(settings.usage.totalAllocated / (1024 ** 3)).toFixed(0)}{' '}
                        GB
                    </div>
                </Card>
                <Card>
                    <div className="text-sm text-gray-500">Usado</div>
                    <div className="text-2xl font-bold heading-text">
                        {(settings.usage.totalUsed / (1024 ** 3)).toFixed(1)} GB
                    </div>
                </Card>
                <Card>
                    <div className="text-sm text-gray-500">Disponible</div>
                    <div className="text-2xl font-bold text-emerald-600">
                        {((settings.usage.totalAllocated - settings.usage.totalUsed) / (1024 ** 3)).toFixed(1)}{' '}
                        GB
                    </div>
                </Card>
                <Card>
                    <div className="text-sm text-gray-500">Porcentaje</div>
                    <div
                        className={classNames(
                            'text-2xl font-bold',
                            usageBarColor,
                        )}
                    >
                        {usagePct}%
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

            {/* Tab 0: Uso de almacenamiento */}
            {activeTab === 0 && (
                <div className="mt-6 space-y-6">
                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <span className="h-5 w-5 text-gray-500">??</span>
                            Resumen de uso
                        </h5>
                        <div className="mb-4">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-sm text-gray-500">
                                    {formatBytes(settings.usage.totalUsed)} de{' '}
                                    {formatBytes(
                                        settings.usage.totalAllocated,
                                    )}
                                </span>
                                <span
                                    className={classNames(
                                        'text-sm font-semibold',
                                        usageBarColor,
                                    )}
                                >
                                    {usagePct}%
                                </span>
                            </div>
                            <Progress
                                percent={usagePct}
                                color={usageColor}
                                height={10}
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {[
                                {
                                    label: 'Evidencias',
                                    value: settings.usage.byType.evidence,
                                    icon: PiCloud,
                                    color: 'text-blue-500',
                                },
                                {
                                    label: 'Logs',
                                    value: settings.usage.byType.logs,
                                    icon: PiDatabase,
                                    color: 'text-amber-500',
                                },
                                {
                                    label: 'Base de datos',
                                    value: settings.usage.byType.database,
                                    icon: PiPlugsConnected,
                                    color: 'text-purple-500',
                                },
                                {
                                    label: 'Otros',
                                    value: settings.usage.byType.other,
                                    icon: <span>📄</span>,
                                    color: 'text-gray-500',
                                },
                            ].map((item) => (
                                <div
                                    key={item.label}
                                    className="rounded-lg bg-gray-50 p-3 dark:bg-gray-700/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <item.icon
                                            className={classNames(
                                                'h-4 w-4',
                                                item.color,
                                            )}
                                        />
                                        <span className="text-sm text-gray-500">
                                            {item.label}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-lg font-semibold heading-text">
                                        {(item.value / (1024 ** 3)).toFixed(1)}{' '}
                                        GB
                                    </p>
                                    <Progress
                                        percent={Math.round(
                                            (item.value /
                                                settings.usage.totalAllocated) *
                                                100,
                                        )}
                                        color="bg-blue-500"
                                        height={4}
                                    />
                                </div>
                            ))}
                        </div>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiCloudArrowUp className="h-5 w-5 text-gray-500" />
                            Tendencia de crecimiento
                        </h5>
                        <Suspense
                            fallback={
                                <div className="flex h-48 items-center justify-center">
                                    <Spinner size={32} />
                                </div>
                            }
                        >
                            <Chart
                                type="area"
                                series={[
                                    {
                                        name: 'Almacenamiento usado (GB)',
                                        data:
                                            settings.usage.growthTrend.map(
                                                (g) => g.used,
                                            ),
                                    },
                                ]}
                                xAxis={
                                    settings.usage.growthTrend.map(
                                        (g) => g.month,
                                    )
                                }
                                height={260}
                                customOptions={{
                                    stroke: {
                                        curve: 'smooth',
                                        width: 2,
                                    },
                                    fill: {
                                        type: 'gradient',
                                        gradient: {
                                            shadeIntensity: 1,
                                            opacityFrom: 0.4,
                                            opacityTo: 0.1,
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

            {/* Tab 1: Políticas de retención */}
            {activeTab === 1 && (
                <div className="mt-6 space-y-6">
                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiShieldCheck className="h-5 w-5 text-gray-500" />
                            Períodos de retención
                        </h5>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            <Field
                                label="Retención de datos de sesión (días)"
                                hint="Datos de sesión activos y completados"
                            >
                                <Input
                                    type="number"
                                    min={1}
                                    value={retention.sessionDataDays}
                                    onChange={(e) =>
                                        setRetention((p) => ({
                                            ...p,
                                            sessionDataDays: parseInt(
                                                e.target.value,
                                                10,
                                            ) || 365,
                                        }))
                                    }
                                />
                            </Field>
                            <Field
                                label="Retención de evidencia (días)"
                                hint="Imágenes, videos y documentos de verificación"
                            >
                                <Input
                                    type="number"
                                    min={1}
                                    value={retention.evidenceDays}
                                    onChange={(e) =>
                                        setRetention((p) => ({
                                            ...p,
                                            evidenceDays: parseInt(
                                                e.target.value,
                                                10,
                                            ) || 730,
                                        }))
                                    }
                                />
                            </Field>
                            <Field
                                label="Retención de auditoría (días)"
                                hint="Registros de auditoría y trazabilidad"
                            >
                                <Input
                                    type="number"
                                    min={1}
                                    value={retention.auditLogDays}
                                    onChange={(e) =>
                                        setRetention((p) => ({
                                            ...p,
                                            auditLogDays: parseInt(
                                                e.target.value,
                                                10,
                                            ) || 2555,
                                        }))
                                    }
                                />
                            </Field>
                        </div>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiTrash className="h-5 w-5 text-gray-500" />
                            Eliminación automática
                        </h5>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium heading-text">
                                    Eliminar datos expirados automáticamente
                                </p>
                                <p className="text-sm text-gray-400">
                                    Los datos que superen el período de retención
                                    se eliminarán sin posibilidad de
                                    recuperación
                                </p>
                            </div>
                            <Switcher
                                checked={retention.autoDelete}
                                onChange={(v) =>
                                    setRetention((p) => ({ ...p, autoDelete: v }))
                                }
                            />
                        </div>
                    </Card>

                    {retention.autoDelete && (
                        <Alert showIcon type="warning">
                            <p className="font-medium">
                                Precaución con la eliminación automática
                            </p>
                            <p className="mt-1 text-sm text-gray-500">
                                Los datos eliminados no pueden recuperarse. Asegurate
                                de tener copias de seguridad antes de habilitar
                                esta opción.
                            </p>
                        </Alert>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button
                            variant="default"
                            onClick={() =>
                                settings && setRetention(settings.retention)
                            }
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="solid"
                            loading={saving}
                            onClick={handleSaveRetention}
                        >
                            Guardar políticas
                        </Button>
                    </div>
                </div>
            )}

            {/* Tab 2: Ajustes generales de almacenamiento */}
            {activeTab === 2 && (
                <div className="mt-6 space-y-6">
                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <span className="h-5 w-5 text-gray-500">??</span>
                            Límites de archivos
                        </h5>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Field label="Tamaño máximo por archivo (MB)">
                                <Input
                                    type="number"
                                    min={1}
                                    max={500}
                                    value={storage.maxFileSizeMB}
                                    onChange={(e) =>
                                        setStorage((p) => ({
                                            ...p,
                                            maxFileSizeMB: parseInt(
                                                e.target.value,
                                                10,
                                            ) || 50,
                                        }))
                                    }
                                />
                            </Field>
                            <Field
                                label="Tipos de archivo permitidos"
                                hint="Separados por comas"
                            >
                                <Input
                                    value={storage.allowedTypes}
                                    onChange={(e) =>
                                        setStorage((p) => ({
                                            ...p,
                                            allowedTypes: e.target.value,
                                        }))
                                    }
                                />
                            </Field>
                        </div>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiLock className="h-5 w-5 text-gray-500" />
                            Compresión de evidencia
                        </h5>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium heading-text">
                                        Compresión habilitada
                                    </p>
                                    <p className="text-sm text-gray-400">
                                        Comprimir archivos de evidencia al
                                        almacenarlos
                                    </p>
                                </div>
                                <Switcher
                                    checked={storage.compressionEnabled}
                                    onChange={(v) =>
                                        setStorage((p) => ({
                                            ...p,
                                            compressionEnabled: v,
                                        }))
                                    }
                                />
                            </div>
                            {storage.compressionEnabled && (
                                <Field label="Nivel de compresión (1-9)">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={9}
                                        value={storage.compressionLevel}
                                        onChange={(e) =>
                                            setStorage((p) => ({
                                                ...p,
                                                compressionLevel:
                                                    parseInt(
                                                        e.target.value,
                                                        10,
                                                    ) || 6,
                                            }))
                                        }
                                    />
                                    <p className="mt-1 text-xs text-gray-400">
                                        1 = compresión rápida, 9 = máxima
                                        compresión (más lento)
                                    </p>
                                </Field>
                            )}
                        </div>
                    </Card>

                    <Card>
                        <h5 className="mb-4 flex items-center gap-2">
                            <PiCloud className="h-5 w-5 text-gray-500" />
                            Almacenamiento en la nube
                        </h5>
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Field label="Proveedor">
                                <Select
                                    options={CLOUD_PROVIDERS}
                                    value={
                                        CLOUD_PROVIDERS.find(
                                            (p) =>
                                                p.value ===
                                                storage.cloudProvider,
                                        )
                                    }
                                    onChange={(o) =>
                                        setStorage((p) => ({
                                            ...p,
                                            cloudProvider: (o?.value ??
                                                's3') as StorageSettings['cloudProvider'],
                                        }))
                                    }
                                />
                            </Field>
                            {storage.cloudProvider !== 'local' && (
                                <>
                                    <Field label="Bucket / Contenedor">
                                        <Input
                                            placeholder="mi-bucket-evidencias"
                                            value={storage.cloudBucket}
                                            onChange={(e) =>
                                                setStorage((p) => ({
                                                    ...p,
                                                    cloudBucket: e.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                    <Field label="Región">
                                        <Select
                                            options={REGION_OPTS}
                                            value={
                                                REGION_OPTS.find(
                                                    (r) =>
                                                        r.value ===
                                                        storage.cloudRegion,
                                                )
                                            }
                                            onChange={(o) =>
                                                setStorage((p) => ({
                                                    ...p,
                                                    cloudRegion: o?.value ?? 'us-east-1',
                                                }))
                                            }
                                        />
                                    </Field>
                                </>
                            )}
                        </div>
                    </Card>

                    {storage.cloudProvider !== 'local' && (
                        <Card>
                            <h5 className="mb-4 flex items-center gap-2">
                                <PiArrowRight className="h-5 w-5 text-gray-500" />
                                CDN
                            </h5>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium heading-text">
                                            Habilitar CDN
                                        </p>
                                        <p className="text-sm text-gray-400">
                                            Distribuir contenido de evidencia a
                                            través de una red de distribución
                                        </p>
                                    </div>
                                    <Switcher
                                        checked={storage.cdnEnabled}
                                        onChange={(v) =>
                                            setStorage((p) => ({
                                                ...p,
                                                cdnEnabled: v,
                                            }))
                                        }
                                    />
                                </div>
                                {storage.cdnEnabled && (
                                    <Field label="URL del CDN">
                                        <Input
                                            placeholder="https://cdn.tu-dominio.com"
                                            value={storage.cdnUrl}
                                            onChange={(e) =>
                                                setStorage((p) => ({
                                                    ...p,
                                                    cdnUrl: e.target.value,
                                                }))
                                            }
                                        />
                                    </Field>
                                )}
                            </div>
                        </Card>
                    )}

                    <div className="flex justify-end gap-2">
                        <Button
                            variant="default"
                            onClick={() =>
                                settings && setStorage(settings.storage)
                            }
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="solid"
                            loading={saving}
                            onClick={handleSaveStorage}
                        >
                            Guardar configuración
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

export default SettingsStorage
