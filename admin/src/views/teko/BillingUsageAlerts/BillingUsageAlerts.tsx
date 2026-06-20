import { useState, useEffect, useCallback } from 'react'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Switcher from '@/components/ui/Switcher'
import Tag from '@/components/ui/Tag'
import Dialog from '@/components/ui/Dialog'
import Alert from '@/components/ui/Alert'
import Spinner from '@/components/ui/Spinner'
import Table from '@/components/ui/Table'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type {
    UsageAlert,
    UsageAlertChannel,
    UsageAlertInput,
} from '@/teko/types'
import {
    PiBellRinging,
    PiPlus,
    PiPencil,
    PiTrash,
    PiEnvelope,
    PiPhone,
    PiShareNetwork,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const CHANNELS: Array<{ value: UsageAlertChannel; label: string }> = [
    { value: 'email', label: 'Email' },
    { value: 'webhook', label: 'Webhook' },
]

const CHANNEL_META: Record<
    UsageAlertChannel,
    { label: string; icon: typeof PiEnvelope; targetLabel: string; placeholder: string }
> = {
    email: {
        label: 'Email',
        icon: PiEnvelope,
        targetLabel: 'Correo electrónico',
        placeholder: 'admin@empresa.com',
    },
    webhook: {
        label: 'Webhook',
        icon: PiShareNetwork,
        targetLabel: 'URL del webhook',
        placeholder: 'https://api.tu-servicio.com/webhooks/alertas',
    },
}

const EMPTY_FORM: UsageAlertInput = {
    thresholdPct: 80,
    channel: 'email',
    target: '',
    enabled: true,
}

function BillingUsageAlerts() {
    const { current, currentId, loading: tLoading } = useTenant()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [alerts, setAlerts] = useState<UsageAlert[]>([])

    const [editOpen, setEditOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<UsageAlertInput>(EMPTY_FORM)
    const [saving, setSaving] = useState(false)

    const [deleteTarget, setDeleteTarget] = useState<UsageAlert | null>(null)
    const [deleting, setDeleting] = useState(false)

    const load = useCallback(async () => {
        if (!currentId) {
            setLoading(false)
            return
        }
        setLoading(true)
        setError(null)
        try {
            const res = await tekoApi.listUsageAlerts(currentId)
            setAlerts(res.alerts || [])
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }, [currentId])

    useEffect(() => {
        load()
    }, [load])

    function openCreate() {
        setEditingId(null)
        setForm(EMPTY_FORM)
        setEditOpen(true)
    }

    function openEdit(alert: UsageAlert) {
        setEditingId(alert.id)
        setForm({
            thresholdPct: alert.thresholdPct,
            channel: alert.channel,
            target: alert.target,
            enabled: alert.enabled,
        })
        setEditOpen(true)
    }

    async function handleSave() {
        if (!currentId) return
        const pct = Number(form.thresholdPct)
        if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
            toast.push(
                <Notification title="Datos inválidos" type="warning">
                    El umbral debe estar entre 1 y 100.
                </Notification>,
                { placement: 'top-center' },
            )
            return
        }
        if (!form.target.trim()) {
            toast.push(
                <Notification title="Datos inválidos" type="warning">
                    El destino de la notificación es obligatorio.
                </Notification>,
                { placement: 'top-center' },
            )
            return
        }
        setSaving(true)
        try {
            const body: UsageAlertInput = {
                thresholdPct: pct,
                channel: form.channel,
                target: form.target.trim(),
                enabled: form.enabled,
            }
            if (editingId) {
                await tekoApi.updateUsageAlert(currentId, editingId, body)
            } else {
                await tekoApi.createUsageAlert(currentId, body)
            }
            toast.push(
                <Notification title="Guardado" type="success">
                    {editingId ? 'Alerta actualizada.' : 'Alerta creada.'}
                </Notification>,
                { placement: 'top-center' },
            )
            setEditOpen(false)
            await load()
        } catch (e) {
            toast.push(
                <Notification title="Error" type="danger">
                    {(e as Error).message}
                </Notification>,
                { placement: 'top-center' },
            )
        } finally {
            setSaving(false)
        }
    }

    async function handleToggle(alert: UsageAlert) {
        if (!currentId) return
        try {
            await tekoApi.updateUsageAlert(currentId, alert.id, {
                enabled: !alert.enabled,
            })
            await load()
        } catch (e) {
            toast.push(
                <Notification title="Error" type="danger">
                    {(e as Error).message}
                </Notification>,
                { placement: 'top-center' },
            )
        }
    }

    async function handleDelete() {
        if (!currentId || !deleteTarget) return
        setDeleting(true)
        try {
            await tekoApi.deleteUsageAlert(currentId, deleteTarget.id)
            toast.push(
                <Notification title="Eliminada" type="success">
                    Alerta eliminada.
                </Notification>,
                { placement: 'top-center' },
            )
            setDeleteTarget(null)
            await load()
        } catch (e) {
            toast.push(
                <Notification title="Error" type="danger">
                    {(e as Error).message}
                </Notification>,
                { placement: 'top-center' },
            )
        } finally {
            setDeleting(false)
        }
    }

    if (tLoading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    const channelMeta = CHANNEL_META[form.channel]

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="mb-1">Alertas de Uso</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Notificaciones automáticas de consumo para ${current.name}`
                            : 'Notificaciones automáticas de consumo'}
                    </p>
                </div>
                <Button
                    variant="solid"
                    size="sm"
                    icon={<PiPlus />}
                    onClick={openCreate}
                >
                    Nueva alerta
                </Button>
            </div>

            {error && (
                <Alert showIcon type="danger">
                    {error}
                </Alert>
            )}

            <Card bodyClass="p-0">
                {loading ? (
                    <div className="flex justify-center p-8">
                        <Spinner size={40} />
                    </div>
                ) : alerts.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                        <PiBellRinging className="mx-auto mb-2 text-4xl" />
                        <p>No hay alertas configuradas</p>
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Umbral</Th>
                                <Th>Canal</Th>
                                <Th>Destino</Th>
                                <Th>Estado</Th>
                                <Th className="text-right">Acciones</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {alerts.map((alert) => {
                                const meta = CHANNEL_META[alert.channel]
                                const Icon = meta?.icon ?? PiEnvelope
                                return (
                                    <Tr key={alert.id}>
                                        <Td className="font-medium">
                                            {alert.thresholdPct}%
                                        </Td>
                                        <Td>
                                            <span className="inline-flex items-center gap-1.5">
                                                <Icon className="text-gray-500" />
                                                {meta?.label ?? alert.channel}
                                            </span>
                                        </Td>
                                        <Td className="text-gray-600">
                                            {alert.target}
                                        </Td>
                                        <Td>
                                            <div className="flex items-center gap-2">
                                                <Switcher
                                                    checked={alert.enabled}
                                                    onChange={() =>
                                                        handleToggle(alert)
                                                    }
                                                />
                                                <Tag
                                                    className={
                                                        alert.enabled
                                                            ? 'bg-emerald-100 text-emerald-700'
                                                            : 'bg-gray-100 text-gray-500'
                                                    }
                                                >
                                                    {alert.enabled
                                                        ? 'Activa'
                                                        : 'Inactiva'}
                                                </Tag>
                                            </div>
                                        </Td>
                                        <Td className="text-right">
                                            <div className="inline-flex gap-1">
                                                <Button
                                                    size="xs"
                                                    variant="plain"
                                                    icon={<PiPencil />}
                                                    onClick={() =>
                                                        openEdit(alert)
                                                    }
                                                />
                                                <Button
                                                    size="xs"
                                                    variant="plain"
                                                    icon={<PiTrash />}
                                                    onClick={() =>
                                                        setDeleteTarget(alert)
                                                    }
                                                />
                                            </div>
                                        </Td>
                                    </Tr>
                                )
                            })}
                        </TBody>
                    </Table>
                )}
            </Card>

            <Dialog
                isOpen={editOpen}
                onClose={() => setEditOpen(false)}
                width={520}
            >
                <h5 className="font-semibold mb-4">
                    {editingId ? 'Editar alerta' : 'Nueva alerta'}
                </h5>
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Umbral de uso (%)
                        </label>
                        <Input
                            type="number"
                            min={1}
                            max={100}
                            value={form.thresholdPct}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    thresholdPct: Number(e.target.value),
                                }))
                            }
                            placeholder="80"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Canal
                        </label>
                        <Select
                            options={CHANNELS}
                            value={CHANNELS.find(
                                (c) => c.value === form.channel,
                            )}
                            onChange={(opt) =>
                                setForm((f) => ({
                                    ...f,
                                    channel:
                                        (opt?.value as UsageAlertChannel) ??
                                        'email',
                                }))
                            }
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            {channelMeta.targetLabel}
                        </label>
                        <Input
                            value={form.target}
                            onChange={(e) =>
                                setForm((f) => ({
                                    ...f,
                                    target: e.target.value,
                                }))
                            }
                            placeholder={channelMeta.placeholder}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Switcher
                            checked={form.enabled}
                            onChange={(checked) =>
                                setForm((f) => ({ ...f, enabled: checked }))
                            }
                        />
                        <span className="text-sm">Alerta activa</span>
                    </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <Button
                        variant="default"
                        onClick={() => setEditOpen(false)}
                    >
                        Cancelar
                    </Button>
                    <Button
                        variant="solid"
                        loading={saving}
                        onClick={handleSave}
                    >
                        Guardar
                    </Button>
                </div>
            </Dialog>

            <ConfirmDialog
                isOpen={!!deleteTarget}
                type="danger"
                title="Eliminar alerta"
                confirmText="Eliminar"
                cancelText="Cancelar"
                confirmButtonProps={{
                    loading: deleting,
                    className: 'bg-red-600 hover:bg-red-600',
                }}
                onClose={() => setDeleteTarget(null)}
                onRequestClose={() => setDeleteTarget(null)}
                onCancel={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
            >
                ¿Eliminar la alerta del {deleteTarget?.thresholdPct}% (
                {deleteTarget?.target})? Esta acción no se puede deshacer.
            </ConfirmDialog>
        </div>
    )
}

export default BillingUsageAlerts
