import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Dialog from '@/components/ui/Dialog'
import Switcher from '@/components/ui/Switcher'
import Badge from '@/components/ui/Badge'
import Table from '@/components/ui/Table'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { ApiKey, CreateApiKeyResponse, App } from '@/teko/types'
import { PiPlus, PiCopy, PiCheck, PiTrash, PiKey } from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const SCOPE_OPTIONS = [
    { value: 'manage_tenants', label: 'Gestionar Tenants' },
    { value: 'manage_apps', label: 'Gestionar Apps' },
    { value: 'manage_webhooks', label: 'Gestionar Webhooks' },
    { value: 'review_sessions', label: 'Revisar Sesiones' },
    { value: 'view_sessions', label: 'Ver Sesiones' },
    { value: 'view_usage', label: 'Ver Uso' },
]

const ApiKeysView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [keys, setKeys] = useState<ApiKey[]>([])
    const [apps, setApps] = useState<App[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Create dialog
    const [createOpen, setCreateOpen] = useState(false)
    const [label, setLabel] = useState('')
    const [selectedAppId, setSelectedAppId] = useState('')
    const [selectedScopes, setSelectedScopes] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const [created, setCreated] = useState<CreateApiKeyResponse | null>(null)
    const [copied, setCopied] = useState(false)

    async function load() {
        if (!currentId) return
        setLoading(true)
        setError(null)
        try {
            const [{ apiKeys }, { apps: appList }] = await Promise.all([
                tekoApi.listApiKeys(currentId),
                tekoApi.listApps(currentId),
            ])
            setKeys(apiKeys)
            setApps(appList)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [currentId])

    const openCreate = () => {
        setLabel('')
        setSelectedAppId('')
        setSelectedScopes([])
        setCreated(null)
        setCopied(false)
        setCreateOpen(true)
    }

    async function createKey(e: React.FormEvent) {
        e.preventDefault()
        if (!currentId || !label.trim()) return
        setBusy(true)
        setError(null)
        try {
            const res = await tekoApi.createApiKey(currentId, {
                label: label.trim(),
                appId: selectedAppId || undefined,
                scopes: selectedScopes.length > 0 ? selectedScopes : undefined,
            })
            setCreated(res)
            load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function revoke(keyId: string) {
        if (!currentId) return
        try {
            await tekoApi.revokeApiKey(currentId, keyId)
            toast.push(
                <Notification title="Revocado" type="success">API Key revocada</Notification>,
                { placement: 'top-center' },
            )
            load()
        } catch (e) {
            toast.push(
                <Notification title="Error" type="danger">{(e as Error).message}</Notification>,
                { placement: 'top-center' },
            )
        }
    }

    const copyKey = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const toggleScope = (scope: string) => {
        setSelectedScopes(prev =>
            prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope],
        )
    }

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold">API Keys</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        {current ? `Claves de API para ${current.name}` : 'Gestiona las claves de acceso a la API'}
                    </p>
                </div>
                <Button variant="solid" icon={<PiPlus />} onClick={openCreate}>
                    Nueva API Key
                </Button>
            </div>

            {error && <Alert showIcon type="danger">{error}</Alert>}

            <Card bodyClass="p-0">
                {loading ? (
                    <div className="flex justify-center p-8"><Spinner size={40} /></div>
                ) : keys.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                        <PiKey className="mx-auto mb-2 text-4xl" />
                        <p>No hay API Keys configuradas</p>
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Label</Th>
                                <Th>Prefijo</Th>
                                <Th>App</Th>
                                <Th>Scopes</Th>
                                <Th>Estado</Th>
                                <Th>Creada</Th>
                                <Th>Último uso</Th>
                                <Th className="text-right">Acción</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {keys.map((k) => (
                                <Tr key={k.id}>
                                    <Td className="font-medium">{k.label}</Td>
                                    <Td><code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{k.prefix}...</code></Td>
                                    <Td className="text-gray-500 text-sm">{k.appId ? apps.find(a => a.id === k.appId)?.name || k.appId.slice(0, 8) : '—'}</Td>
                                    <Td>
                                        <div className="flex flex-wrap gap-1">
                                            {(k.scopes?.length ? k.scopes : ['all']).map(s => (
                                                <span key={s} className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{s}</span>
                                            ))}
                                        </div>
                                    </Td>
                                    <Td>
                                        <Badge color={k.status === 'active' ? 'success' : 'danger'}>
                                            {k.status === 'active' ? 'Activa' : 'Revocada'}
                                        </Badge>
                                    </Td>
                                    <Td className="text-sm text-gray-500">{fmtDate(k.createdAt)}</Td>
                                    <Td className="text-sm text-gray-500">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : '—'}</Td>
                                    <Td className="text-right">
                                        {k.status === 'active' && (
                                            <Button size="xs" variant="plain" icon={<PiTrash />} onClick={() => revoke(k.id)} />
                                        )}
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>

            <Dialog isOpen={createOpen} onClose={() => setCreateOpen(false)} width={520}>
                {created ? (
                    <div>
                        <h5 className="font-semibold mb-4">API Key creada</h5>
                        <Alert showIcon type="warning" className="mb-4">
                            Copia esta clave ahora. No podrás verla de nuevo.
                        </Alert>
                        <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg font-mono text-sm break-all mb-4">
                            {created.apiKey}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="solid" icon={copied ? <PiCheck /> : <PiCopy />} onClick={() => copyKey(created.apiKey)}>
                                {copied ? 'Copiado' : 'Copiar'}
                            </Button>
                            <Button variant="default" onClick={() => setCreateOpen(false)}>Cerrar</Button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={createKey}>
                        <h5 className="font-semibold mb-4">Nueva API Key</h5>
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium">Label</label>
                                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej: Producción" required />
                            </div>
                            {apps.length > 0 && (
                                <div>
                                    <label className="mb-1 block text-sm font-medium">App (opcional)</label>
                                    <select
                                        className="w-full border rounded-md px-3 py-2 text-sm"
                                        value={selectedAppId}
                                        onChange={(e) => setSelectedAppId(e.target.value)}
                                    >
                                        <option value="">Todas las apps</option>
                                        {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="mb-1 block text-sm font-medium">Permisos (opcional)</label>
                                <div className="space-y-1.5">
                                    {SCOPE_OPTIONS.map(s => (
                                        <label key={s.value} className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedScopes.includes(s.value)}
                                                onChange={() => toggleScope(s.value)}
                                                className="rounded"
                                            />
                                            {s.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button variant="default" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                            <Button variant="solid" type="submit" loading={busy}>Crear</Button>
                        </div>
                    </form>
                )}
            </Dialog>
        </div>
    )
}

export default ApiKeysView