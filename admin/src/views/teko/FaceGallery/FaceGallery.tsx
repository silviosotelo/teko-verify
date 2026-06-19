import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { PiUser, PiTrash } from 'react-icons/pi'

const FaceGalleryView = () => {
    const { currentId, loading: tLoading } = useTenant()
    const [identityId, setIdentityId] = useState('')
    const [removing, setRemoving] = useState(false)
    const [message, setMessage] = useState('')

    const handleRemove = async () => {
        if (!currentId || !identityId.trim()) return
        setRemoving(true)
        try {
            await tekoApi.removeFaceFromGallery(currentId, identityId.trim())
            toast.push(<Notification title="Eliminado" type="success">Identidad removida de la galería</Notification>, { placement: 'top-center' })
            setIdentityId('')
        } catch (e: unknown) {
            setMessage(`Error: ${(e as Error).message}`)
        } finally { setRemoving(false) }
    }

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div>
                <h3 className="font-semibold">Galería Facial</h3>
                <p className="text-sm text-gray-500 mt-1">Administra identidades registradas para detección de reincidencia y fraude</p>
            </div>

            <Card>
                <h5 className="font-semibold mb-2">Remover identidad de la galería</h5>
                <p className="text-xs text-gray-400 mb-4">Ingresá el N° de documento (CI) de la identidad a remover</p>
                <div className="flex gap-3 max-w-md">
                    <Input value={identityId} onChange={(e) => setIdentityId(e.target.value)} placeholder="N° de documento" />
                    <Button variant="default" icon={<PiTrash />} loading={removing} onClick={handleRemove}>Remover</Button>
                </div>
                {message && <Alert showIcon type={message.startsWith('Error') ? 'danger' : 'success'} className="mt-3">{message}</Alert>}
            </Card>

            <Card>
                <div className="text-center py-12 text-gray-400">
                    <PiUser className="mx-auto mb-3 text-5xl" />
                    <p className="text-base font-medium">Deduplicado facial 1:N</p>
                    <p className="text-sm mt-1">Las identidades se agregan automáticamente durante la verificación</p>
                    <div className="mt-4 text-left max-w-md mx-auto space-y-2 text-xs text-gray-400">
                        <p>• Cuando un usuario completa la verificación, su embedding facial se guarda en la galería automáticamente</p>
                        <p>• Si el mismo CI intenta verificarse de nuevo, el sistema detecta reincidencia</p>
                        <p>• Si la foto NO coincide con la de la galería, se marca como sospechoso de fraude (suplantación)</p>
                        <p>• Para agregar una identidad manualmente, se requiere el embedding facial generado por el ML — opera desde el backend</p>
                        <p>• Usá "Remover" para borrar una identidad fraudulenta o errónea de la galería</p>
                    </div>
                </div>
            </Card>
        </div>
    )
}

export default FaceGalleryView