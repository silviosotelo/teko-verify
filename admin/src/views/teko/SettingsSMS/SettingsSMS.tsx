import Card from '@/components/ui/Card'
import Alert from '@/components/ui/Alert'
import Spinner from '@/components/ui/Spinner'
import { useTenant } from '@/teko/TenantContext'
import { PiPhone } from 'react-icons/pi'

const SettingsSMS = () => {
    const { current: tenant, loading: tLoading } = useTenant()

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div>
                <h3 className="font-semibold">SMS</h3>
                <p className="text-sm text-gray-500 mt-1">Configuración de notificaciones SMS</p>
            </div>

            <Card>
                <h5 className="font-semibold mb-4">Proveedor SMS</h5>
                <Alert showIcon type="info" className="mb-4">
                    Las notificaciones SMS se enviarán a través del proveedor configurado para el envío de links de verificación.
                </Alert>
                <div className="text-center py-12 text-gray-400">
                    <PiPhone className="mx-auto mb-3 text-5xl" />
                    <p className="text-base font-medium">SMS no configurado</p>
                    <p className="text-sm mt-1">El envío de SMS requiere configuración adicional a nivel de servidor.</p>
                    <p className="text-xs mt-2 text-gray-300">
                        Tenant: {tenant?.name || '—'}
                    </p>
                </div>
            </Card>
        </div>
    )
}

export default SettingsSMS