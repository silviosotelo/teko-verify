import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import Skeleton from '@/components/ui/Skeleton'
import Tabs from '@/components/ui/Tabs'
import Switcher from '@/components/ui/Switcher'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { TenantIntegration, IntegrationKind } from '@/teko/types'

// Ecme Tabs: TabNav = individual tab button, TabList = tab row container, TabContent = panel
// Verified from admin/src/views/ui-components/navigation/Tabs/Pill.tsx
const { TabNav, TabList, TabContent } = Tabs

// Configuración de campos por kind
const SMTP_FIELDS: Array<{ key: string; label: string; type: string; placeholder: string }> = [
    { key: 'host', label: 'Host SMTP', type: 'text', placeholder: 'smtp.office365.com' },
    { key: 'port', label: 'Puerto', type: 'number', placeholder: '587' },
    { key: 'user', label: 'Usuario', type: 'text', placeholder: 'user@empresa.com' },
    { key: 'password', label: 'Contraseña', type: 'password', placeholder: '(ocultado si configurado)' },
    { key: 'fromEmail', label: 'From Email', type: 'text', placeholder: 'noreply@empresa.com' },
    { key: 'fromName', label: 'From Name', type: 'text', placeholder: 'Teko Verify' },
]

const AML_FIELDS: Array<{ key: string; label: string; type: string; placeholder: string }> = [
    { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.sumsub.com' },
    { key: 'providerName', label: 'Nombre del proveedor', type: 'text', placeholder: 'sumsub' },
    { key: 'apiKey', label: 'API Key', type: 'password', placeholder: '(ocultado si configurado)' },
    { key: 'threshold', label: 'Umbral (0–1)', type: 'number', placeholder: '0.8' },
]

const STORAGE_FIELDS: Array<{ key: string; label: string; type: string; placeholder: string }> = [
    { key: 'baseDir', label: 'Directorio base', type: 'text', placeholder: '/mnt/nas/teko' },
]

function kindFields(kind: IntegrationKind) {
    if (kind === 'smtp') return SMTP_FIELDS
    if (kind === 'aml') return AML_FIELDS
    if (kind === 'storage') return STORAGE_FIELDS
    return []
}

interface IntegrationFormProps {
    tenantId: string
    kind: IntegrationKind
    existing: TenantIntegration | null
    onSaved: (ti: TenantIntegration) => void
}

function IntegrationForm({ tenantId, kind, existing, onSaved }: IntegrationFormProps) {
    const [form, setForm] = useState<Record<string, string>>({})
    const [enabled, setEnabled] = useState(existing?.enabled ?? true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const fields = kindFields(kind)

    useEffect(() => {
        if (!existing) { setForm({}); return }
        const initial: Record<string, string> = {}
        for (const f of fields) {
            const val = existing.config[f.key]
            initial[f.key] = typeof val === 'string' ? val : (typeof val === 'number' ? String(val) : '')
        }
        setEnabled(existing.enabled)
        setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existing])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setBusy(true)
        setError(null)
        setSaved(false)
        try {
            const config: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(form)) {
                if (v !== '' && v !== '***') config[k] = v
            }
            const { integration } = await tekoApi.putIntegration(tenantId, kind, config, enabled)
            onSaved(integration)
            setSaved(true)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setBusy(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
            {fields.map((f) => (
                <div key={f.key}>
                    <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                        {f.label}
                    </label>
                    <Input
                        type={f.type}
                        value={form[f.key] ?? ''}
                        placeholder={f.placeholder}
                        onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    />
                </div>
            ))}
            <div className="flex items-center gap-3">
                <Switcher checked={enabled} onChange={setEnabled} />
                <span className="text-sm text-gray-600 dark:text-gray-300">
                    {enabled ? 'Habilitado' : 'Deshabilitado'}
                </span>
            </div>
            {error && <Alert type="danger" showIcon>{error}</Alert>}
            {saved && <Alert type="success" showIcon>Integración guardada correctamente.</Alert>}
            <div className="flex gap-2">
                <Button variant="solid" type="submit" loading={busy}>Guardar</Button>
            </div>
        </form>
    )
}

const TenantIntegrations = () => {
    const { currentId, loading: tLoading } = useTenant()
    const [integrations, setIntegrations] = useState<TenantIntegration[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<string>('smtp')

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .getIntegrations(currentId)
            .then(({ integrations: list }) => setIntegrations(list))
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId])

    function getIntegration(kind: IntegrationKind): TenantIntegration | null {
        return integrations.find((i) => i.kind === kind) ?? null
    }

    function handleSaved(ti: TenantIntegration) {
        setIntegrations((prev) => {
            const without = prev.filter((i) => i.kind !== ti.kind)
            return [...without, ti]
        })
    }

    if (tLoading || loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-64" />
            </div>
        )
    }

    if (!currentId) {
        return <Alert type="warning" showIcon>Seleccioná un tenant para ver sus integraciones.</Alert>
    }

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Proveedores de integración</h3>
                <p className="text-gray-500">
                    Configurá SMTP, almacenamiento y AML por tenant. Si no se configura, se usa el proveedor global del servidor.
                </p>
            </div>
            {error && <Alert type="danger" showIcon className="mb-4">{error}</Alert>}
            <Card>
                <Tabs defaultValue="smtp" onChange={setActiveTab}>
                    <TabList>
                        <TabNav value="smtp">Email (SMTP)</TabNav>
                        <TabNav value="storage">Almacenamiento</TabNav>
                        <TabNav value="aml">AML / PEP</TabNav>
                        <TabNav value="sms">SMS</TabNav>
                    </TabList>
                    <div className="pt-6">
                        <TabContent value="smtp">
                            <IntegrationForm
                                tenantId={currentId}
                                kind="smtp"
                                existing={getIntegration('smtp')}
                                onSaved={handleSaved}
                            />
                        </TabContent>
                        <TabContent value="storage">
                            <IntegrationForm
                                tenantId={currentId}
                                kind="storage"
                                existing={getIntegration('storage')}
                                onSaved={handleSaved}
                            />
                        </TabContent>
                        <TabContent value="aml">
                            <IntegrationForm
                                tenantId={currentId}
                                kind="aml"
                                existing={getIntegration('aml')}
                                onSaved={handleSaved}
                            />
                        </TabContent>
                        <TabContent value="sms">
                            <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-8 text-center">
                                <p className="text-gray-400 font-medium">SMS — Próximamente</p>
                                <p className="text-sm text-gray-400 mt-1">
                                    La tabla soporta la configuración del proveedor SMS, pero el envío real de mensajes se implementa en una fase futura.
                                </p>
                            </div>
                        </TabContent>
                    </div>
                </Tabs>
            </Card>
            {/* activeTab kept in state for future controlled use */}
            <span className="hidden">{activeTab}</span>
        </div>
    )
}

export default TenantIntegrations
