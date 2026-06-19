import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import Spinner from '@/components/ui/Spinner'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { PiUser, PiTrash, PiPlus } from 'react-icons/pi'

const FaceGalleryView = () => {
    const { currentId, loading: tLoading } = useTenant()
    const [identityId, setIdentityId] = useState('')
    const [adding, setAdding] = useState(false)
    const [message, setMessage] = useState('')
    const [removing, setRemoving] = useState('')

    const handleAdd = async () => {
        if (!currentId || !identityId.trim()) return
        setAdding(true)
        setMessage('')
        try {
            const res = await tekoApi.addFaceToGallery(currentId, { identityId: identityId.trim() })
            setMessage(`Identidad ${res.identityId} agregada a la galería`)
            setIdentityId('')
        } catch (e: unknown) {
            setMessage(`Error: ${(e as Error).message}`)
        } finally { setAdding(false) }
    }

    const handleRemove = async () => {
        if (!currentId || !identityId.trim()) return
        setRemoving(identityId)
        try {
            await tekoApi.removeFaceFromGallery(currentId, identityId.trim())
            toast.push(<Notification title="Eliminado" type="success">Identidad removida de la galería</Notification>, { placement: 'top-center' })
            setIdentityId('')
        } catch (e: unknown) {
            toast.push(<Notification title="Error" type="danger">{(e as Error).message}</Notification>, { placement: 'top-center' })
        } finally { setRemoving('') }
    }

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div><h3 className="font-semibold">Galería Facial</h3><p className="text-sm text-gray-500 mt-1">Administra las identidades registradas para detección de fraude y reincidencia</p></div>

            <Card>
                <h5 className="font-semibold mb-2">Agregar / Remover identidad</h5>
                <p className="text-xs text-gray-400 mb-4">Ingresá el número de CI/DNI de la identidad a gestionar</p>
                <div className="flex gap-3 max-w-md">
                    <Input value={identityId} onChange={(e) => setIdentityId(e.target.value)} placeholder="Nº de documento" />
                    <Button variant="solid" icon={<PiPlus />} loading={adding} onClick={handleAdd}>Agregar</Button>
                    <Button variant="default" icon={<PiTrash />} loading={Boolean(removing)} onClick={handleRemove}>Remover</Button>
                </div>
                {message && <Alert showIcon type={message.startsWith('Error') ? 'danger' : 'success'} className="mt-3">{message}</Alert>}
            </Card>

            <Card>
                <div className="text-center py-12 text-gray-400">
                    <PiUser className="mx-auto mb-3 text-5xl" />
                    <p className="text-base font-medium">Galería facial 1:N</p>
                    <p className="text-sm mt-1">Usá esta función para administrar el deduplicado facial y detección de fraudes</p>
                    <div className="mt-4 text-left max-w-md mx-auto space-y-2 text-xs text-gray-400">
                        <p>• Al agregar un documento, la próxima vez que ese CI intente verificarse, el sistema detectará que ya existe en la galería</p>
                        <p>• Si la foto de la nueva verificación NO coincide con la de la galería, se marca como sospechoso de fraude</p>
                        <p>• Si coincide, se trata de un usuario recurrente (returning user)</p>
                    </div>
                </div>
            </Card>
        </div>
    )
}

export default FaceGalleryView