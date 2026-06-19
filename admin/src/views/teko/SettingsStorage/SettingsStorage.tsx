import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import Spinner from '@/components/ui/Spinner'
import Switcher from '@/components/ui/Switcher'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { PiHardDrive, PiWarning } from 'react-icons/pi'
import type { TenantPolicy } from '@/teko/types'

const SettingsStorage = () => {
    const { currentId, current: tenant, loading: tLoading } = useTenant()
    const [retentionDays, setRetentionDays] = useState(
        String(tenant?.policies?.retentionDays ?? 365),
    )
    const [saving, setSaving] = useState(false)

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    const handleSave = async () => {
        if (!currentId) return
        setSaving(true)
        try {
            await tekoApi.updateTenant(currentId, {
                policies: { retentionDays: Number(retentionDays) || 365 } as TenantPolicy,
            })
            toast.push(
                <Notification title="Guardado" type="success">Configuración actualizada</Notification>,
                { placement: 'top-center' },
            )
        } catch (e: unknown) {
            toast.push(
                <Notification title="Error" type="danger">{e instanceof Error ? e.message : 'Error al guardar'}</Notification>,
                { placement: 'top-center' },
            )
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h3 className="font-semibold">Almacenamiento</h3>
                <p className="text-sm text-gray-500 mt-1">Configuración de retención de datos y almacenamiento de evidencia</p>
            </div>

            <Card>
                <h5 className="font-semibold mb-4">Retención de datos</h5>
                <Alert showIcon type="info" className="mb-4">
                    <PiWarning className="inline mr-1" />
                    Los datos de sesiones vencidas se eliminan automáticamente según el período de retención configurado.
                </Alert>
                <div className="max-w-md space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium">Días de retención</label>
                        <Input
                            type="number"
                            min={1}
                            max={3650}
                            value={retentionDays}
                            onChange={(e) => setRetentionDays(e.target.value)}
                        />
                        <p className="text-xs text-gray-400 mt-1">Las sesiones completadas se eliminan después de este período (1-3650 días)</p>
                    </div>
                    <Button variant="solid" loading={saving} onClick={handleSave}>
                        Guardar configuración
                    </Button>
                </div>
            </Card>

            <Card>
                <h5 className="font-semibold mb-4">Ubicación del almacenamiento</h5>
                <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b">
                        <span className="text-gray-500">Directorios de evidencia</span>
                        <span className="font-mono">/data/evidence</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                        <span className="text-gray-500">Tipo de almacenamiento</span>
                        <span className="font-mono">Disco local (bind mount)</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                        <span className="text-gray-500">Formato de imagen</span>
                        <span className="font-mono">JPEG normalizado</span>
                    </div>
                </div>
            </Card>
        </div>
    )
}

export default SettingsStorage