import { useState, useEffect } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Spinner from '@/components/ui/Spinner'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { PiGauge, PiInfo } from 'react-icons/pi'

const RateLimitsView = () => {
    const { currentId, current, loading: tLoading } = useTenant()
    const [v1, setV1] = useState('100')
    const [verify, setVerify] = useState('50')
    const [admin, setAdmin] = useState('30')
    const [saving, setSaving] = useState(false)

    // Cargar los límites actuales del tenant (si el backend los expone en policies).
    useEffect(() => {
        const p = current?.policies
        if (!p) return
        if (typeof p.rateLimitV1 === 'number') setV1(String(p.rateLimitV1))
        if (typeof p.rateLimitVerify === 'number') setVerify(String(p.rateLimitVerify))
        if (typeof p.rateLimitAdmin === 'number') setAdmin(String(p.rateLimitAdmin))
    }, [current])

    const handleSave = async () => {
        if (!currentId) return
        setSaving(true)
        try {
            await tekoApi.updateTenantRateLimits(currentId, {
                rateLimitV1: parseInt(v1) || 100,
                rateLimitVerify: parseInt(verify) || 50,
                rateLimitAdmin: parseInt(admin) || 30,
            })
            toast.push(<Notification title="Guardado" type="success">Límites actualizados</Notification>, { placement: 'top-center' })
        } catch (e: unknown) {
            toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
        } finally { setSaving(false) }
    }

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div>
                <h3 className="font-semibold">Límites de tasa (Rate Limits)</h3>
                <p className="text-sm text-gray-500 mt-1">Controla el número máximo de requests por minuto para cada endpoint</p>
            </div>

            <Card>
                <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
                    <PiInfo className="text-primary" />
                    <span>Configuración para: <strong>{current?.name || '—'}</strong></span>
                </div>
                <div className="space-y-4 max-w-md">
                    {[
                        { label: 'API Tenant (/v1)', val: v1, set: setV1, hint: 'Requests por minuto para endpoints de tenant (crear sesión, consultar estado)' },
                        { label: 'Captura (/verify)', val: verify, set: setVerify, hint: 'Requests por minuto para la página de captura y subida de evidencia' },
                        { label: 'Admin (/admin)', val: admin, set: setAdmin, hint: 'Requests por minuto para el panel de administración' },
                    ].map(({ label, val, set, hint }) => (
                        <div key={label}>
                            <label className="mb-1 block text-sm font-medium">{label}</label>
                            <div className="flex items-center gap-3">
                                <Input type="number" min={1} max={10000} value={val} onChange={(e) => set(e.target.value)} className="w-32" />
                                <span className="text-xs text-gray-400">req/min</span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">{hint}</p>
                        </div>
                    ))}
                </div>
                <Button variant="solid" loading={saving} onClick={handleSave} className="mt-6" icon={<PiGauge />}>
                    Actualizar límites
                </Button>
            </Card>

            <Card>
                <h5 className="font-semibold mb-2">Notas</h5>
                <ul className="text-xs text-gray-400 space-y-1 list-disc pl-4">
                    <li>Los límites se aplican por IP de origen</li>
                    <li>Si no se configura un límite, se usa el valor por defecto del servidor</li>
                    <li>Un límite muy bajo puede afectar la experiencia del usuario final</li>
                    <li>Un límite muy alto puede exponer el sistema a abusos</li>
                </ul>
            </Card>
        </div>
    )
}

export default RateLimitsView