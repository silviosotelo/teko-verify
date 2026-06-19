import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Badge from '@/components/ui/Badge'
import Table from '@/components/ui/Table'
import Tag from '@/components/ui/Tag'
import Skeleton from '@/components/ui/Skeleton'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type {
    WebhookEndpoint,
    WebhookEvent,
    ApiKey,
    App,
} from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

interface Connector {
    id: string
    name: string
    description: string
    icon: string
    status: 'active' | 'configured' | 'coming_soon'
    detail?: string
    eventCount?: number
    keyCount?: number
}

const CONNECTORS: Connector[] = [
    {
        id: 'webhooks',
        name: 'Webhooks',
        description:
            'Notificá eventos en tiempo real a cualquier URL. Soporte para firma HMAC y reintentos automáticos.',
        icon: '🔌',
        status: 'active',
        eventCount: 6,
    },
    {
        id: 'rest-api',
        name: 'REST API',
        description:
            'API RESTful completa para gestionar sesiones, consultar estados y administrar el tenant.',
        icon: '🌐',
        status: 'configured',
        keyCount: 0,
    },
    {
        id: 'graphql',
        name: 'GraphQL',
        description:
            'Consultas flexibles con GraphQL. Permite elegir exactamente los campos que necesitás.',
        icon: '◈',
        status: 'coming_soon',
    },
    {
        id: 'zapier',
        name: 'Zapier',
        description:
            'Conectá Teko Verify con más de 6.000 aplicaciones a través de Zapier sin escribir código.',
        icon: '⚡',
        status: 'active',
    },
    {
        id: 'make',
        name: 'Make.com',
        description:
            'Automatizaciones visuales con Make.com. Integración nativa con escenarios paso a paso.',
        icon: '🔗',
        status: 'coming_soon',
    },
    {
        id: 'slack',
        name: 'Slack',
        description:
            'Envía notificaciones a canales de Slack cuando una sesión cambia de estado.',
        icon: '💬',
        status: 'active',
    },
    {
        id: 'email',
        name: 'Email',
        description:
            'Notificaciones por email para eventos críticos: aprobaciones, rechazos y revisiones.',
        icon: '✉️',
        status: 'active',
    },
    {
        id: 'database',
        name: 'Database Sync',
        description:
            'Sincronización bidireccional con bases de datos PostgreSQL y MySQL.',
        icon: '🗄️',
        status: 'coming_soon',
    },
    {
        id: 'sso-saml',
        name: 'SSO / SAML',
        description:
            'Autenticación única con proveedores SAML 2.0 como Okta, Azure AD y OneLogin.',
        icon: '🔐',
        status: 'coming_soon',
    },
    {
        id: 'oauth2',
        name: 'OAuth 2.0',
        description:
            'Gestión de aplicaciones OAuth 2.0 con flujos authorization code, PKCE y client credentials.',
        icon: '🛡️',
        status: 'configured',
        keyCount: 0,
    },
]

function statusBadge(status: Connector['status']) {
    const map: Record<Connector['status'], { label: string; color: string }> = {
        active: {
            label: 'Activo',
            color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100',
        },
        configured: {
            label: 'Configurado',
            color: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100',
        },
        coming_soon: {
            label: 'Próximamente',
            color: 'bg-gray-100 text-gray-500 dark:bg-gray-600 dark:text-gray-100',
        },
    }
    const { label, color } = map[status]
    return <Badge className={color}>{label}</Badge>
}

const IntegrationsConnectors = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [search, setSearch] = useState('')
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([])
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
    const [apps, setApps] = useState<App[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [adding, setAdding] = useState(false)
    const [newName, setNewName] = useState('')
    const [newUrl, setNewUrl] = useState('')
    const [newEvents, setNewEvents] = useState<WebhookEvent[]>([
        'session.created',
        'session.status_updated',
        'session.approved',
        'session.declined',
    ])
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        Promise.all([
            tekoApi.listWebhooks(currentId).catch(() => ({ endpoints: [] })),
            tekoApi.listApiKeys(currentId).catch(() => ({ apiKeys: [] })),
            tekoApi.listApps(currentId).catch(() => ({ apps: [] })),
        ])
            .then(([wh, ak, ap]) => {
                setWebhooks((wh as { endpoints: WebhookEndpoint[] }).endpoints)
                setApiKeys((ak as { apiKeys: ApiKey[] }).apiKeys)
                setApps((ap as { apps: App[] }).apps)
            })
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId])

    const filtered = CONNECTORS.filter((c) => {
        const matchSearch =
            !search ||
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.description.toLowerCase().includes(search.toLowerCase())
        const matchStatus =
            filterStatus === 'all' || c.status === filterStatus
        return matchSearch && matchStatus
    })

    async function submitAdd(e: React.FormEvent) {
        e.preventDefault()
        if (!currentId || !newUrl.trim()) return
        setBusy(true)
        setError(null)
        try {
            await tekoApi.createWebhook(currentId, {
                url: newUrl.trim(),
                events: newEvents,
                description: newName.trim() || undefined,
            })
            setAdding(false)
            setNewName('')
            setNewUrl('')
            setNewEvents([
                'session.created',
                'session.status_updated',
                'session.approved',
                'session.declined',
            ])
            if (currentId) {
                const { endpoints } = await tekoApi.listWebhooks(currentId)
                setWebhooks(endpoints)
            }
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setBusy(false)
        }
    }

    function toggleNewEvent(ev: WebhookEvent) {
        setNewEvents((prev) =>
            prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev],
        )
    }

    const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
        'session.created',
        'session.status_updated',
        'session.approved',
        'session.declined',
        'session.in_review',
        'session.data_updated',
    ]

    if (tLoading || loading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-48" />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Conectores API</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Integraciones disponibles para ${current.name}`
                            : 'Integraciones disponibles'}
                    </p>
                </div>
                <Button variant="solid" onClick={() => setAdding(true)}>
                    Agregar conector
                </Button>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {/* Filtros */}
            <div className="mb-6 flex flex-wrap gap-3">
                <Input
                    placeholder="Buscar conectores..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-xs"
                />
                <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                >
                    <option value="all">Todos los estados</option>
                    <option value="active">Activos</option>
                    <option value="configured">Configurados</option>
                    <option value="coming_soon">Próximamente</option>
                </select>
            </div>

            {/* Grid de conectores */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((connector) => (
                    <Card key={connector.id} className="flex flex-col">
                        <div className="mb-3 flex items-start justify-between">
                            <span className="text-3xl">{connector.icon}</span>
                            {statusBadge(connector.status)}
                        </div>
                        <h5 className="mb-1 font-semibold heading-text">
                            {connector.name}
                        </h5>
                        <p className="mb-4 flex-1 text-sm text-gray-500">
                            {connector.description}
                        </p>

                        {connector.id === 'webhooks' && webhooks.length > 0 && (
                            <div className="mb-3">
                                <div className="mb-1 text-xs font-medium text-gray-400">
                                    Destinos configurados
                                </div>
                                <div className="space-y-2">
                                    {webhooks.slice(0, 3).map((wh) => (
                                        <div
                                            key={wh.id}
                                            className="flex items-center justify-between rounded bg-gray-50 px-2.5 py-1.5 dark:bg-gray-700/50"
                                        >
                                            <span className="truncate text-xs font-mono text-gray-600 dark:text-gray-300">
                                                {wh.url}
                                            </span>
                                            <Tag
                                                className={`border-0 text-[10px] ${
                                                    wh.enabled
                                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                        : 'bg-gray-100 text-gray-400 dark:bg-gray-600 dark:text-gray-300'
                                                }`}
                                            >
                                                {wh.enabled ? 'activo' : 'pausado'}
                                            </Tag>
                                        </div>
                                    ))}
                                    {webhooks.length > 3 && (
                                        <div className="text-xs text-gray-400">
                                            +{webhooks.length - 3} más
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {connector.id === 'rest-api' && apiKeys.length > 0 && (
                            <div className="mb-3">
                                <div className="mb-1 text-xs font-medium text-gray-400">
                                    API keys activas
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {apiKeys
                                        .filter((k) => k.status === 'active')
                                        .map((k) => (
                                            <Tag
                                                key={k.id}
                                                className="border-0 bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100"
                                            >
                                                {k.label}
                                            </Tag>
                                        ))}
                                </div>
                            </div>
                        )}

                        {connector.id === 'oauth2' && apps.length > 0 && (
                            <div className="mb-3">
                                <div className="mb-1 text-xs font-medium text-gray-400">
                                    Aplicaciones registradas
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {apps.map((app) => (
                                        <Tag
                                            key={app.id}
                                            className="border-0 bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-100"
                                        >
                                            {app.name}
                                        </Tag>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-gray-400">
                                {connector.eventCount
                                    ? `${connector.eventCount} eventos`
                                    : connector.keyCount != null
                                      ? `${apiKeys.filter((k) => k.status === 'active').length} keys`
                                      : ''}
                            </span>
                            {connector.status !== 'coming_soon' ? (
                                <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => {
                                        if (connector.id === 'webhooks') {
                                            setAdding(true)
                                        } else if (connector.id === 'rest-api') {
                                            window.location.hash = '#api-keys'
                                        } else if (connector.id === 'oauth2') {
                                            window.location.hash = '#oauth'
                                        } else {
                                            // Slack, Email, etc.
                                        }
                                    }}
                                >
                                    Configurar
                                </Button>
                            ) : (
                                <Button size="sm" variant="default" disabled>
                                    Próximamente
                                </Button>
                            )}
                        </div>
                    </Card>
                ))}
            </div>

            {/* Agregar conector (webhook) */}
            <Dialog
                isOpen={adding}
                onClose={() => {
                    setAdding(false)
                    setNewName('')
                    setNewUrl('')
                    setNewEvents([
                        'session.created',
                        'session.status_updated',
                        'session.approved',
                        'session.declined',
                    ])
                }}
                onRequestClose={() => setAdding(false)}
                width={620}
            >
                <h5 className="mb-4">Agregar conector webhook</h5>
                <form onSubmit={submitAdd} className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre (opcional)
                        </label>
                        <Input
                            value={newName}
                            placeholder="ej: backend de producción"
                            onChange={(e) => setNewName(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            URL de destino (https)
                        </label>
                        <Input
                            value={newUrl}
                            placeholder="https://tu-servidor/webhooks/teko"
                            onChange={(e) => setNewUrl(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Eventos a suscribir
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {ALL_WEBHOOK_EVENTS.map((ev) => {
                                const on = newEvents.includes(ev)
                                return (
                                    <button
                                        key={ev}
                                        type="button"
                                        onClick={() => toggleNewEvent(ev)}
                                        className={`rounded-full border px-3 py-1 text-xs transition ${
                                            on
                                                ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                : 'border-gray-200 text-gray-500 dark:border-gray-600'
                                        }`}
                                    >
                                        {ev.replace('session.', '')}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                    <div className="mt-5 flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => setAdding(false)}
                        >
                            Cancelar
                        </Button>
                        <Button variant="solid" loading={busy} type="submit">
                            Agregar
                        </Button>
                    </div>
                </form>
            </Dialog>

            {/* Resumen rápido de webhooks */}
            {webhooks.length > 0 && (
                <Card className="mt-8">
                    <h5 className="mb-4">
                        Resumen de webhooks — {webhooks.length} destinos
                    </h5>
                    <Table>
                        <THead>
                            <Tr>
                                <Th>URL</Th>
                                <Th>Eventos</Th>
                                <Th>Estado</Th>
                                <Th>Creado</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {webhooks.map((wh) => (
                                <Tr key={wh.id}>
                                    <Td className="max-w-xs truncate font-mono text-xs heading-text">
                                        {wh.url}
                                    </Td>
                                    <Td>
                                        <div className="flex flex-wrap gap-1">
                                            {wh.events.map((ev) => (
                                                <Tag
                                                    key={ev}
                                                    className="border-0 bg-gray-100 text-xs text-gray-600 dark:bg-gray-600 dark:text-gray-100"
                                                >
                                                    {ev.replace('session.', '')}
                                                </Tag>
                                            ))}
                                        </div>
                                    </Td>
                                    <Td>
                                        <Tag
                                            className={`border-0 ${
                                                wh.enabled
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                    : 'bg-gray-100 text-gray-400 dark:bg-gray-600 dark:text-gray-300'
                                            }`}
                                        >
                                            {wh.enabled ? 'activo' : 'pausado'}
                                        </Tag>
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(wh.createdAt)}
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                </Card>
            )}
        </div>
    )
}

export default IntegrationsConnectors
