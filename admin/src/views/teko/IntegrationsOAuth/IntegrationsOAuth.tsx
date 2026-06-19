import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Table from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'
import Tag from '@/components/ui/Tag'
import Skeleton from '@/components/ui/Skeleton'
import Notification from '@/components/ui/Notification'
import toast from '@/components/ui/toast'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { App, Tenant } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

interface OAuthClient {
    id: string
    name: string
    appId: string | null
    clientId: string
    clientSecret: string | null
    redirectUris: string[]
    scopes: string[]
    grantTypes: string[]
    enabled: boolean
    createdAt: string
    lastTokenAt: string | null
}

interface OAuthFlowStep {
    label: string
    description: string
    example: string
}

const OAUTH_FLOWS: Record<string, OAuthFlowStep[]> = {
    authorization_code: [
        {
            label: '1. Redirigir al usuario',
            description: 'El cliente redirige al usuario a la URL de autorización de Teko.',
            example: 'https://admin.teko.verify/oauth/authorize?client_id=xxx&redirect_uri=yyy&response_type=code&scope=openid',
        },
        {
            label: '2. Usuario autoriza',
            description: 'El usuario inicia sesión y autoriza la aplicación.',
            example: 'El usuario ingresa sus credenciales y aprueba el acceso.',
        },
        {
            label: '3. Código de autorización',
            description: 'Teko redirige al cliente con un código temporal.',
            example: 'https://mi-app.com/callback?code=AUTH_CODE',
        },
        {
            label: '4. Intercambiar código por token',
            description: 'El cliente intercambia el código por access_token y refresh_token.',
            example: 'POST /oauth/token con code, client_id, client_secret',
        },
        {
            label: '5. Recibir tokens',
            description: 'Teko devuelve los tokens para acceder a la API.',
            example: '{ "access_token": "eyJ...", "refresh_token": "dGhpcy...", "token_type": "Bearer" }',
        },
    ],
    client_credentials: [
        {
            label: '1. Solicitar token directamente',
            description: 'La aplicación solicita tokens con sus credenciales de cliente.',
            example: 'POST /oauth/token con client_id, client_secret, grant_type=client_credentials',
        },
        {
            label: '2. Recibir access_token',
            description: 'Teko devuelve un access_token sin refresh_token.',
            example: '{ "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }',
        },
    ],
}

const DEFAULT_SCOPES = ['openid', 'profile', 'sessions:read', 'sessions:write']
const DEFAULT_GRANT_TYPES = ['authorization_code', 'refresh_token']

function notify(msg: string, type: 'success' | 'danger' = 'success') {
    toast.push(
        <Notification title="OAuth" type={type}>{msg}</Notification>,
        { placement: 'top-center' },
    )
}

const IntegrationsOAuth = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [clients, setClients] = useState<OAuthClient[]>([])
    const [apps, setApps] = useState<App[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<OAuthClient | null>(null)
    const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState(false)

    // Form crear
    const [formName, setFormName] = useState('')
    const [formAppId, setFormAppId] = useState<string>('')
    const [formRedirectUris, setFormRedirectUris] = useState('')
    const [formScopes, setFormScopes] = useState(DEFAULT_SCOPES.join('\n'))
    const [formGrantTypes, setFormGrantTypes] = useState(DEFAULT_GRANT_TYPES.join('\n'))
    const [formEnabled, setFormEnabled] = useState(true)

    // Form editar
    const [eName, setEName] = useState('')
    const [eEnabled, setEEnabled] = useState(true)
    const [eRedirectUris, setERedirectUris] = useState('')
    const [eScopes, setEScopes] = useState('')
    const [eGrantTypes, setEGrantTypes] = useState('')

    // Token management
    const [revokeTarget, setRevokeTarget] = useState<OAuthClient | null>(null)

    // Flow diagram
    const [selectedFlow, setSelectedFlow] = useState('authorization_code')

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        Promise.all([
            tekoApi.listApps(currentId).catch(() => ({ apps: [] })),
        ])
            .then(([ap]) => {
                setApps((ap as { apps: App[] }).apps)
            })
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId])

    useEffect(() => {
        if (!currentId || apps.length === 0) return
        // Simulamos clientes OAuth basados en las apps registradas
        const simulated: OAuthClient[] = apps.map((app) => ({
            id: `oauth-${app.id}`,
            name: app.name,
            appId: app.id,
            clientId: app.id.slice(0, 8) + 'a3b7c9d1e2f4',
            clientSecret: null,
            redirectUris: [`https://${app.slug || app.name}.example.com/callback`],
            scopes: [...DEFAULT_SCOPES],
            grantTypes: [...DEFAULT_GRANT_TYPES],
            enabled: true,
            createdAt: app.createdAt,
            lastTokenAt: null,
        }))
        setClients(simulated)
    }, [currentId, apps])

    function resetForm() {
        setFormName('')
        setFormAppId(apps[0]?.id ?? '')
        setFormRedirectUris('')
        setFormScopes(DEFAULT_SCOPES.join('\n'))
        setFormGrantTypes(DEFAULT_GRANT_TYPES.join('\n'))
        setFormEnabled(true)
    }

    async function submitCreate(e: React.FormEvent) {
        e.preventDefault()
        if (!currentId || !formName.trim()) return
        setBusy(true)
        setError(null)
        try {
            const appId = formAppId || undefined
            if (appId) {
                await tekoApi.createApp(currentId, formName.trim())
            }
            const newApp = {
                id: `app-${Date.now()}`,
                tenantId: currentId,
                name: formName.trim(),
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
            const newClient: OAuthClient = {
                id: `oauth-${newApp.id}`,
                name: formName.trim(),
                appId: appId || null,
                clientId: `ck_${Math.random().toString(36).slice(2, 10)}`,
                clientSecret: `cs_${Math.random().toString(36).slice(2, 20)}`,
                redirectUris: formRedirectUris
                    .split('\n')
                    .map((u) => u.trim())
                    .filter(Boolean),
                scopes: formScopes.split('\n').map((s) => s.trim()).filter(Boolean),
                grantTypes: formGrantTypes.split('\n').map((g) => g.trim()).filter(Boolean),
                enabled: formEnabled,
                createdAt: new Date().toISOString(),
                lastTokenAt: null,
            }
            setClients((prev) => [...prev, newClient])
            setAdding(false)
            resetForm()
            notify('Aplicación OAuth registrada correctamente.')
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function submitEdit(e: React.FormEvent) {
        e.preventDefault()
        if (!editing) return
        setBusy(true)
        setError(null)
        try {
            setClients((prev) =>
                prev.map((c) =>
                    c.id === editing.id
                        ? {
                              ...c,
                              name: eName,
                              enabled: eEnabled,
                              redirectUris: eRedirectUris
                                  .split('\n')
                                  .map((u) => u.trim())
                                  .filter(Boolean),
                              scopes: eScopes.split('\n').map((s) => s.trim()).filter(Boolean),
                              grantTypes: eGrantTypes.split('\n').map((g) => g.trim()).filter(Boolean),
                          }
                        : c,
                ),
            )
            setEditing(null)
            notify('Aplicación OAuth actualizada.')
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setBusy(false)
        }
    }

    function openEdit(client: OAuthClient) {
        setEditing(client)
        setEName(client.name)
        setEEnabled(client.enabled)
        setERedirectUris(client.redirectUris.join('\n'))
        setEScopes(client.scopes.join('\n'))
        setEGrantTypes(client.grantTypes.join('\n'))
    }

    function toggleSecret(id: string) {
        setVisibleSecrets((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    function copySecret(secret: string) {
        navigator.clipboard.writeText(secret)
        notify('Secreto copiado al portapapeles.')
    }

    async function handleRevoke(client: OAuthClient) {
        if (!confirm(`¿Revocar todas las credenciales de "${client.name}"?`)) return
        try {
            setClients((prev) => prev.filter((c) => c.id !== client.id))
            setRevokeTarget(null)
            notify('Aplicación OAuth revocada.')
        } catch (err) {
            setError((err as Error).message)
        }
    }

    async function toggleEnabled(client: OAuthClient) {
        setClients((prev) =>
            prev.map((c) =>
                c.id === client.id ? { ...c, enabled: !c.enabled } : c,
            ),
        )
        notify(
            client.enabled
                ? `Aplicación "${client.name}" deshabilitada.`
                : `Aplicación "${client.name}" habilitada.`,
        )
    }

    if (tLoading || loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-72" />
                <Skeleton className="h-4 w-96" />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                </div>
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Aplicaciones OAuth</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Gestión de clientes OAuth 2.0 para ${current.name}`
                            : 'Gestión de clientes OAuth 2.0'}
                    </p>
                </div>
                <Button variant="solid" onClick={() => { setAdding(true); resetForm() }}>
                    Nueva aplicación
                </Button>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {/* Diagrama del flujo OAuth */}
            <Card className="mb-6">
                <h5 className="mb-3">Flujos OAuth 2.0 soportados</h5>
                <div className="flex gap-2 mb-4">
                    {Object.keys(OAUTH_FLOWS).map((flow) => (
                        <button
                            key={flow}
                            onClick={() => setSelectedFlow(flow)}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                                selectedFlow === flow
                                    ? 'border-primary bg-primary/10 text-primary dark:bg-primary/20'
                                    : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400'
                            }`}
                        >
                            {flow === 'authorization_code'
                                ? 'Authorization Code + PKCE'
                                : flow === 'client_credentials'
                                  ? 'Client Credentials'
                                  : flow}
                        </button>
                    ))}
                </div>
                <div className="space-y-3">
                    {OAUTH_FLOWS[selectedFlow]?.map((step, idx) => (
                        <div key={idx} className="flex gap-3">
                            <div className="flex flex-col items-center">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                                    {idx + 1}
                                </div>
                                {idx < (OAUTH_FLOWS[selectedFlow]?.length ?? 0) - 1 && (
                                    <div className="h-full w-px bg-gray-200 dark:bg-gray-700" />
                                )}
                            </div>
                            <div className="pb-4">
                                <div className="text-sm font-medium heading-text">
                                    {step.label}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {step.description}
                                </div>
                                <pre className="mt-1 rounded bg-gray-50 p-2 font-mono text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                    {step.example}
                                </pre>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>

            {/* Tabla de clientes OAuth */}
            <Card bodyClass="px-0 py-0">
                <Table>
                    <THead>
                        <Tr>
                            <Th>Nombre</Th>
                            <Th>Client ID</Th>
                            <Th>Redirect URIs</Th>
                            <Th>Scopes</Th>
                            <Th>Grant Types</Th>
                            <Th>Estado</Th>
                            <Th>Creada</Th>
                            <Th />
                        </Tr>
                    </THead>
                    <TBody>
                        {clients.length === 0 ? (
                            <Tr>
                                <Td colSpan={8} className="py-12 text-center text-sm text-gray-400">
                                    No hay aplicaciones OAuth registradas.
                                </Td>
                            </Tr>
                        ) : (
                            clients.map((client) => (
                                <Tr key={client.id}>
                                    <Td className="font-medium heading-text">
                                        {client.name}
                                    </Td>
                                    <Td className="font-mono text-xs">
                                        <div className="flex items-center gap-1">
                                            <span className="truncate">{client.clientId}</span>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onClick={() => copySecret(client.clientId)}
                                            >
                                                📋
                                            </Button>
                                        </div>
                                    </Td>
                                    <Td>
                                        <div className="max-w-[200px] space-y-0.5">
                                            {client.redirectUris.slice(0, 2).map((uri) => (
                                                <div
                                                    key={uri}
                                                    className="truncate text-xs font-mono text-gray-500"
                                                >
                                                    {uri}
                                                </div>
                                            ))}
                                            {client.redirectUris.length > 2 && (
                                                <div className="text-xs text-gray-400">
                                                    +{client.redirectUris.length - 2} más
                                                </div>
                                            )}
                                        </div>
                                    </Td>
                                    <Td>
                                        <div className="flex flex-wrap gap-1">
                                            {client.scopes.slice(0, 3).map((s) => (
                                                <Tag
                                                    key={s}
                                                    className="border-0 bg-gray-100 text-xs text-gray-600 dark:bg-gray-600 dark:text-gray-100"
                                                >
                                                    {s}
                                                </Tag>
                                            ))}
                                            {client.scopes.length > 3 && (
                                                <Tag className="border-0 bg-gray-100 text-xs text-gray-500 dark:bg-gray-600">
                                                    +{client.scopes.length - 3}
                                                </Tag>
                                            )}
                                        </div>
                                    </Td>
                                    <Td>
                                        <div className="flex flex-wrap gap-1">
                                            {client.grantTypes.slice(0, 2).map((g) => (
                                                <Tag
                                                    key={g}
                                                    className="border-0 bg-violet-100 text-xs text-violet-700 dark:bg-violet-500/20 dark:text-violet-100"
                                                >
                                                    {g === 'authorization_code'
                                                        ? 'Auth Code'
                                                        : g === 'refresh_token'
                                                          ? 'Refresh'
                                                          : g === 'client_credentials'
                                                            ? 'Client Creds'
                                                            : g}
                                                </Tag>
                                            ))}
                                        </div>
                                    </Td>
                                    <Td>
                                        <Tag
                                            className={`border-0 ${
                                                client.enabled
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                    : 'bg-gray-100 text-gray-400 dark:bg-gray-600 dark:text-gray-300'
                                            }`}
                                        >
                                            {client.enabled ? 'activo' : 'inactivo'}
                                        </Tag>
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(client.createdAt)}
                                    </Td>
                                    <Td className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => toggleSecret(client.id)}
                                            >
                                                {visibleSecrets.has(client.id) ? '🙈' : '👁️'}
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => toggleEnabled(client)}
                                            >
                                                {client.enabled ? 'Pausar' : 'Activar'}
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => openEdit(client)}
                                            >
                                                Editar
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => setRevokeTarget(client)}
                                            >
                                                Eliminar
                                            </Button>
                                        </div>
                                    </Td>
                                </Tr>
                            ))
                        )}
                    </TBody>
                </Table>
            </Card>

            {/* Crear aplicación */}
            <Dialog
                isOpen={adding}
                onClose={() => { setAdding(false); resetForm() }}
                onRequestClose={() => { setAdding(false); resetForm() }}
                width={680}
            >
                <h5 className="mb-4">Nueva aplicación OAuth</h5>
                <form onSubmit={submitCreate} className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre de la aplicación
                        </label>
                        <Input
                            value={formName}
                            placeholder="ej: Mi aplicación externa"
                            onChange={(e) => setFormName(e.target.value)}
                            required
                        />
                    </div>
                    {apps.length > 0 && (
                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                Vincular a app (opcional)
                            </label>
                            <select
                                value={formAppId}
                                onChange={(e) => setFormAppId(e.target.value)}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                            >
                                <option value="">Sin vincular</option>
                                {apps.map((app) => (
                                    <option key={app.id} value={app.id}>
                                        {app.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Redirect URIs (uno por línea)
                        </label>
                        <Input
                            value={formRedirectUris}
                            placeholder="https://mi-app.com/callback&#10;http://localhost:3000/callback"
                            onChange={(e) => setFormRedirectUris(e.target.value)}
                            className="font-mono text-xs"
                        />
                        <div className="mt-1 text-xs text-gray-400">
                            El primer URI será el predeterminado.
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Scopes (uno por línea)
                        </label>
                        <Input
                            value={formScopes}
                            onChange={(e) => setFormScopes(e.target.value)}
                            className="font-mono text-xs"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Grant Types (uno por línea)
                        </label>
                        <Input
                            value={formGrantTypes}
                            onChange={(e) => setFormGrantTypes(e.target.value)}
                            className="font-mono text-xs"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="formEnabled"
                            checked={formEnabled}
                            onChange={(e) => setFormEnabled(e.target.checked)}
                            className="rounded"
                        />
                        <label htmlFor="formEnabled" className="text-sm text-gray-600 dark:text-gray-300">
                            Aplicación habilitada
                        </label>
                    </div>
                    <div className="mt-5 flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => { setAdding(false); resetForm() }}
                        >
                            Cancelar
                        </Button>
                        <Button variant="solid" loading={busy} type="submit">
                            Registrar
                        </Button>
                    </div>
                </form>
            </Dialog>

            {/* Editar aplicación */}
            <Dialog
                isOpen={Boolean(editing)}
                onClose={() => setEditing(null)}
                onRequestClose={() => setEditing(null)}
                width={680}
            >
                <h5 className="mb-4">
                    {editing ? `Editar: ${editing.name}` : 'Editar aplicación OAuth'}
                </h5>
                <form onSubmit={submitEdit} className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre
                        </label>
                        <Input
                            value={eName}
                            onChange={(e) => setEName(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Redirect URIs (uno por línea)
                        </label>
                        <Input
                            value={eRedirectUris}
                            onChange={(e) => setERedirectUris(e.target.value)}
                            className="font-mono text-xs"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Scopes (uno por línea)
                        </label>
                        <Input
                            value={eScopes}
                            onChange={(e) => setEScopes(e.target.value)}
                            className="font-mono text-xs"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Grant Types (uno por línea)
                        </label>
                        <Input
                            value={eGrantTypes}
                            onChange={(e) => setEGrantTypes(e.target.value)}
                            className="font-mono text-xs"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="editEnabled"
                            checked={eEnabled}
                            onChange={(e) => setEEnabled(e.target.checked)}
                            className="rounded"
                        />
                        <label htmlFor="editEnabled" className="text-sm text-gray-600 dark:text-gray-300">
                            Habilitada
                        </label>
                    </div>
                    <div className="mt-5 flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => setEditing(null)}
                        >
                            Cancelar
                        </Button>
                        <Button variant="solid" loading={busy} type="submit">
                            Guardar
                        </Button>
                    </div>
                </form>
            </Dialog>

            {/* Mostrar/ocultar secret */}
            <Dialog
                isOpen={false}
                onClose={() => {}}
                onRequestClose={() => {}}
                width={560}
            >
                <div className="space-y-4">
                    <h5 className="mb-4">Gestión de tokens</h5>
                    <Alert showIcon type="info">
                        Los refresh tokens expiran después de 30 días. Los access tokens
                        expiran después de 1 hora. Regenerá el secret si sospechás que fue
                        comprometido.
                    </Alert>
                </div>
            </Dialog>

            {/* Revocar */}
            <Dialog
                isOpen={Boolean(revokeTarget)}
                onClose={() => setRevokeTarget(null)}
                onRequestClose={() => setRevokeTarget(null)}
                width={500}
            >
                <h5 className="mb-2">Revocar aplicación</h5>
                <p className="text-sm text-gray-500">
                    ¿Estás seguro de que querés revocar todas las credenciales de{' '}
                    <strong>{revokeTarget?.name}</strong>? Se invalidarán todos los
                    tokens activos y la aplicación no podrá obtener nuevos tokens.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                    <Button
                        variant="default"
                        onClick={() => setRevokeTarget(null)}
                    >
                        Cancelar
                    </Button>
                    <Button
                        variant="solid"
                        onClick={() => revokeTarget && handleRevoke(revokeTarget)}
                    >
                        Revocar
                    </Button>
                </div>
            </Dialog>
        </div>
    )
}

export default IntegrationsOAuth
