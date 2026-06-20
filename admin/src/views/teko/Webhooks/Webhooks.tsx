// Webhooks (P0 #2): destinos (suscripciones) del tenant + log de entregas.
// Crear un destino (url + eventos) muestra el secreto UNA sola vez. Permite
// habilitar/deshabilitar, probar (ping), ver el log de entregas y reenviar.
import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Dialog from '@/components/ui/Dialog'
import Input from '@/components/ui/Input'
import Table from '@/components/ui/Table'
import Tag from '@/components/ui/Tag'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Notification from '@/components/ui/Notification'
import toast from '@/components/ui/toast'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type {
    CreateWebhookEndpointResponse,
    WebhookDelivery,
    WebhookEndpoint,
    WebhookEvent,
} from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

const ALL_EVENTS: WebhookEvent[] = [
    'session.created',
    'session.status_updated',
    'session.approved',
    'session.declined',
    'session.in_review',
    'session.data_updated',
]

function notify(msg: string, type: 'success' | 'danger' = 'success') {
    toast.push(
        <Notification title="Webhooks" type={type}>
            {msg}
        </Notification>,
        { placement: 'top-center' },
    )
}

function statusTag(status: string) {
    const cls: Record<string, string> = {
        delivered:
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100',
        pending: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100',
        failed: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100',
        dead: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-100',
    }
    return (
        <Tag className={`border-0 ${cls[status] ?? 'bg-gray-100 text-gray-600'}`}>
            {status}
        </Tag>
    )
}

const WebhooksView = () => {
    const { currentId, current, loading: tLoading } = useTenant()
    const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    // Crear destino.
    const [creating, setCreating] = useState(false)
    const [url, setUrl] = useState('')
    const [description, setDescription] = useState('')
    const [events, setEvents] = useState<WebhookEvent[]>([...ALL_EVENTS])
    const [created, setCreated] =
        useState<CreateWebhookEndpointResponse | null>(null)
    const [copied, setCopied] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(
        null,
    )

    // Log de entregas.
    const [logEndpoint, setLogEndpoint] = useState<WebhookEndpoint | null>(null)
    const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
    const [logLoading, setLogLoading] = useState(false)

    const load = () => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .listWebhooks(currentId)
            .then((r) => setEndpoints(r.endpoints))
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId])

    function toggleEvent(ev: WebhookEvent) {
        setEvents((cur) =>
            cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev],
        )
    }

    async function submitCreate() {
        if (!currentId) return
        if (!url.trim()) {
            setError('La URL es obligatoria.')
            return
        }
        if (events.length === 0) {
            setError('Seleccioná al menos un evento.')
            return
        }
        setBusy(true)
        setError(null)
        try {
            const res = await tekoApi.createWebhook(currentId, {
                url: url.trim(),
                events,
                description: description.trim() || undefined,
            })
            setCreated(res)
            setCreating(false)
            setUrl('')
            setDescription('')
            setEvents([...ALL_EVENTS])
            load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function toggleEnabled(ep: WebhookEndpoint) {
        if (!currentId) return
        try {
            await tekoApi.updateWebhook(currentId, ep.id, {
                enabled: !ep.enabled,
            })
            notify(ep.enabled ? 'Destino deshabilitado.' : 'Destino habilitado.')
            load()
        } catch (e) {
            notify((e as Error).message, 'danger')
        }
    }

    async function remove(ep: WebhookEndpoint) {
        if (!currentId) return
        try {
            await tekoApi.deleteWebhook(currentId, ep.id)
            notify('Destino eliminado.')
            load()
        } catch (e) {
            notify((e as Error).message, 'danger')
        }
    }

    async function test(ep: WebhookEndpoint) {
        if (!currentId) return
        try {
            const { delivery } = await tekoApi.testWebhook(currentId, ep.id)
            if (delivery && delivery.status === 'delivered') {
                notify(`Ping OK (HTTP ${delivery.responseCode}).`)
            } else {
                notify(
                    `Ping enviado: estado=${delivery?.status ?? '?'} código=${delivery?.responseCode ?? '—'}`,
                    delivery?.status === 'delivered' ? 'success' : 'danger',
                )
            }
        } catch (e) {
            notify((e as Error).message, 'danger')
        }
    }

    async function openLog(ep: WebhookEndpoint) {
        if (!currentId) return
        setLogEndpoint(ep)
        setLogLoading(true)
        try {
            const { deliveries } = await tekoApi.listWebhookDeliveries(
                currentId,
                ep.id,
                { limit: 100 },
            )
            setDeliveries(deliveries)
        } catch (e) {
            notify((e as Error).message, 'danger')
        } finally {
            setLogLoading(false)
        }
    }

    async function resend(d: WebhookDelivery) {
        if (!currentId || !logEndpoint) return
        try {
            await tekoApi.resendWebhookDelivery(currentId, logEndpoint.id, d.id)
            notify('Reenvío disparado.')
            openLog(logEndpoint)
        } catch (e) {
            notify((e as Error).message, 'danger')
        }
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
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Webhooks</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Destinos de eventos de ${current.name}`
                            : 'Destinos de eventos del tenant'}
                    </p>
                </div>
                <Button variant="solid" onClick={() => setCreating(true)}>
                    Nuevo destino
                </Button>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            <Card bodyClass="px-0 py-0">
                {loading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size={40} />
                    </div>
                ) : endpoints.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay destinos configurados.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>URL</Th>
                                <Th>Eventos</Th>
                                <Th>Estado</Th>
                                <Th>Creado</Th>
                                <Th />
                            </Tr>
                        </THead>
                        <TBody>
                            {endpoints.map((ep) => (
                                <Tr key={ep.id}>
                                    <Td className="max-w-xs truncate font-mono text-xs heading-text">
                                        {ep.url}
                                        {ep.description && (
                                            <div className="mt-0.5 font-sans text-xs text-gray-400">
                                                {ep.description}
                                            </div>
                                        )}
                                    </Td>
                                    <Td>
                                        <div className="flex flex-wrap gap-1">
                                            {ep.events.map((e) => (
                                                <Tag
                                                    key={e}
                                                    className="border-0 bg-gray-100 text-xs text-gray-600 dark:bg-gray-600 dark:text-gray-100"
                                                >
                                                    {e.replace('session.', '')}
                                                </Tag>
                                            ))}
                                        </div>
                                    </Td>
                                    <Td>
                                        {ep.enabled ? (
                                            <Tag className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100">
                                                activo
                                            </Tag>
                                        ) : (
                                            <Tag className="border-0 bg-gray-100 text-gray-500">
                                                pausado
                                            </Tag>
                                        )}
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(ep.createdAt)}
                                    </Td>
                                    <Td className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => test(ep)}
                                            >
                                                Test
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => openLog(ep)}
                                            >
                                                Entregas
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => toggleEnabled(ep)}
                                            >
                                                {ep.enabled
                                                    ? 'Pausar'
                                                    : 'Activar'}
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() =>
                                                    setDeleteTarget(ep)
                                                }
                                            >
                                                Eliminar
                                            </Button>
                                        </div>
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>

            {/* Crear destino */}
            <Dialog
                isOpen={creating}
                onClose={() => setCreating(false)}
                onRequestClose={() => setCreating(false)}
                width={620}
            >
                <h5 className="mb-4">Nuevo destino</h5>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            URL (https)
                        </label>
                        <Input
                            value={url}
                            placeholder="https://tu-backend/webhooks/teko"
                            onChange={(e) => setUrl(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Descripción (opcional)
                        </label>
                        <Input
                            value={description}
                            placeholder="ej: backend de producción"
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Eventos suscritos
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {ALL_EVENTS.map((ev) => {
                                const on = events.includes(ev)
                                return (
                                    <Button
                                        key={ev}
                                        type="button"
                                        size="xs"
                                        variant={on ? 'solid' : 'default'}
                                        onClick={() => toggleEvent(ev)}
                                    >
                                        {ev.replace('session.', '')}
                                    </Button>
                                )
                            })}
                        </div>
                    </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="default"
                        onClick={() => setCreating(false)}
                    >
                        Cancelar
                    </Button>
                    <Button variant="solid" loading={busy} onClick={submitCreate}>
                        Crear
                    </Button>
                </div>
            </Dialog>

            {/* Secreto recién creado (se muestra UNA vez) */}
            <Dialog
                isOpen={Boolean(created)}
                onClose={() => {
                    setCreated(null)
                    setCopied(false)
                }}
                onRequestClose={() => {
                    setCreated(null)
                    setCopied(false)
                }}
                width={620}
            >
                <h5 className="mb-1">Destino creado</h5>
                <Alert showIcon className="mb-3" type="warning">
                    Este secreto NO se vuelve a mostrar. Guardalo: con él tu
                    backend verifica la firma <code>X-Signature</code>.
                </Alert>
                {created && (
                    <>
                        <div className="mb-2 break-all rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                            {created.secret}
                        </div>
                        <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                                navigator.clipboard.writeText(created.secret)
                                setCopied(true)
                            }}
                        >
                            {copied ? 'Copiado' : 'Copiar secreto'}
                        </Button>
                        <p className="mt-3 text-xs text-gray-400">
                            Verificación (cliente):{' '}
                            <code>
                                X-Signature = sha256= + HMAC_SHA256(secret,
                                X-Timestamp + &quot;.&quot; + rawBody)
                            </code>{' '}
                            comparado en tiempo constante; rechazá si{' '}
                            <code>|now − X-Timestamp| &gt; 300s</code>.
                        </p>
                    </>
                )}
                <div className="mt-4 flex justify-end">
                    <Button
                        variant="solid"
                        onClick={() => {
                            setCreated(null)
                            setCopied(false)
                        }}
                    >
                        Entendido
                    </Button>
                </div>
            </Dialog>

            {/* Log de entregas */}
            <Dialog
                isOpen={Boolean(logEndpoint)}
                onClose={() => setLogEndpoint(null)}
                onRequestClose={() => setLogEndpoint(null)}
                width={820}
            >
                <h5 className="mb-1">Entregas</h5>
                <p className="mb-4 break-all font-mono text-xs text-gray-400">
                    {logEndpoint?.url}
                </p>
                {logLoading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size={32} />
                    </div>
                ) : deliveries.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-400">
                        Sin entregas todavía.
                    </div>
                ) : (
                    <div className="max-h-96 overflow-auto">
                        <Table>
                            <THead>
                                <Tr>
                                    <Th>Evento</Th>
                                    <Th>Estado</Th>
                                    <Th>Código</Th>
                                    <Th>Intentos</Th>
                                    <Th>Fecha</Th>
                                    <Th />
                                </Tr>
                            </THead>
                            <TBody>
                                {deliveries.map((d) => (
                                    <Tr key={d.id}>
                                        <Td className="font-mono text-xs">
                                            {d.eventType.replace('session.', '')}
                                        </Td>
                                        <Td>{statusTag(d.status)}</Td>
                                        <Td className="text-gray-500">
                                            {d.responseCode ?? '—'}
                                        </Td>
                                        <Td className="text-gray-500">
                                            {d.attempts}/{d.maxAttempts}
                                        </Td>
                                        <Td className="text-gray-500">
                                            {fmtDate(d.createdAt)}
                                        </Td>
                                        <Td className="text-right">
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => resend(d)}
                                            >
                                                Reenviar
                                            </Button>
                                        </Td>
                                    </Tr>
                                ))}
                            </TBody>
                        </Table>
                    </div>
                )}
                <div className="mt-4 flex justify-end">
                    <Button
                        variant="default"
                        onClick={() => setLogEndpoint(null)}
                    >
                        Cerrar
                    </Button>
                </div>
            </Dialog>

            {/* Confirmación de borrado */}
            <ConfirmDialog
                isOpen={!!deleteTarget}
                type="danger"
                title="Eliminar destino"
                confirmText="Eliminar"
                cancelText="Cancelar"
                confirmButtonProps={{
                    className: 'bg-red-600 hover:bg-red-600',
                }}
                onClose={() => setDeleteTarget(null)}
                onRequestClose={() => setDeleteTarget(null)}
                onCancel={() => setDeleteTarget(null)}
                onConfirm={async () => {
                    if (deleteTarget) {
                        await remove(deleteTarget)
                        setDeleteTarget(null)
                    }
                }}
            >
                ¿Eliminar el destino {deleteTarget?.url}? Esta acción no se puede
                deshacer.
            </ConfirmDialog>
        </div>
    )
}

export default WebhooksView
