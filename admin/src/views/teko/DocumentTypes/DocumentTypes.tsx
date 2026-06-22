import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Alert from '@/components/ui/Alert'
import Skeleton from '@/components/ui/Skeleton'
import Switcher from '@/components/ui/Switcher'
import Dialog from '@/components/ui/Dialog'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import type { DocumentTypeDef, DocFieldDef } from '@/teko/types'

const DocumentTypes = () => {
    const [types, setTypes]                 = useState<DocumentTypeDef[]>([])
    const [loading, setLoading]             = useState(true)
    const [error, setError]                 = useState<string | null>(null)
    const [fieldsDoc, setFieldsDoc]         = useState<DocumentTypeDef | null>(null)
    const [fields, setFields]               = useState<DocFieldDef[]>([])
    const [fieldsLoading, setFieldsLoading] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState<DocumentTypeDef | null>(null)

    useEffect(() => {
        tekoApi.getDocumentTypes()
            .then(setTypes)
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [])

    async function handleToggle(dt: DocumentTypeDef) {
        try {
            const updated = await tekoApi.putDocumentType(dt.key, { enabled: !dt.enabled })
            setTypes((prev) => prev.map((t) => t.key === updated.key ? updated : t))
            toast.push(
                <Notification title={updated.label} type="success">
                    {updated.enabled ? 'Habilitado' : 'Deshabilitado'}
                </Notification>,
                { placement: 'top-center' }
            )
        } catch (e) {
            toast.push(
                <Notification title="Error" type="danger">{(e as Error).message}</Notification>,
                { placement: 'top-center' }
            )
        }
    }

    async function handleDelete(dt: DocumentTypeDef) {
        try {
            await tekoApi.deleteDocumentType(dt.key)
            setTypes((prev) => prev.filter((t) => t.key !== dt.key))
            toast.push(
                <Notification title="Tipo eliminado" type="success">Eliminado correctamente</Notification>,
                { placement: 'top-center' }
            )
        } catch (e) {
            // 409 → ApiError con mensaje "cannot_delete_system_doc_type"
            toast.push(
                <Notification title="Error" type="danger">{(e as Error).message}</Notification>,
                { placement: 'top-center' }
            )
        } finally {
            setConfirmDelete(null)
        }
    }

    async function openFields(dt: DocumentTypeDef) {
        setFieldsDoc(dt)
        setFieldsLoading(true)
        try {
            setFields(await tekoApi.getDocumentTypeFields(dt.key))
        } catch (e) {
            toast.push(
                <Notification title="Error" type="danger">{(e as Error).message}</Notification>,
                { placement: 'top-center' }
            )
        } finally {
            setFieldsLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-64" />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Tipos de documento</h3>
                <p className="text-gray-500">
                    Definición DB-driven de tipos de documento y sus campos de extracción OCR.
                </p>
            </div>
            {error && <Alert type="danger" showIcon className="mb-4">{error}</Alert>}
            <Card>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-left text-gray-500 dark:text-gray-400">
                            <th className="py-2 pr-4">Clave</th>
                            <th className="py-2 pr-4">Etiqueta</th>
                            <th className="py-2 pr-4">País</th>
                            <th className="py-2 pr-4">MRZ</th>
                            <th className="py-2 pr-4">Habilitado</th>
                            <th className="py-2">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {types.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="py-8 text-center text-gray-400">
                                    No hay tipos de documento configurados.
                                </td>
                            </tr>
                        ) : (
                            types.map((dt) => (
                                <tr key={dt.key} className="border-b">
                                    <td className="py-2 pr-4 font-mono text-xs">{dt.key}</td>
                                    <td className="py-2 pr-4">{dt.label}</td>
                                    <td className="py-2 pr-4">{dt.country}</td>
                                    <td className="py-2 pr-4">{dt.mrzFormat ?? '—'}</td>
                                    <td className="py-2 pr-4">
                                        <Switcher checked={dt.enabled} onChange={() => handleToggle(dt)} />
                                    </td>
                                    <td className="py-2 flex gap-2">
                                        <Button size="xs" variant="default" onClick={() => openFields(dt)}>
                                            Campos
                                        </Button>
                                        {dt.scopeType !== 'system' && (
                                            <Button size="xs" variant="plain" onClick={() => setConfirmDelete(dt)}>
                                                Eliminar
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </Card>

            {/* Dialog de confirmación de borrado */}
            <Dialog isOpen={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
                <div className="p-6">
                    <h5 className="mb-2 font-semibold">Eliminar tipo de documento</h5>
                    <p className="text-sm mb-4">
                        ¿Eliminar <span className="font-mono">{confirmDelete?.key}</span>? Esta acción no se puede deshacer.
                    </p>
                    <div className="flex gap-2 justify-end">
                        <Button variant="default" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
                        <Button variant="solid" onClick={() => confirmDelete && handleDelete(confirmDelete)}>
                            Eliminar
                        </Button>
                    </div>
                </div>
            </Dialog>

            {/* Panel de campos */}
            <Dialog isOpen={fieldsDoc !== null} onClose={() => setFieldsDoc(null)}>
                <div className="p-6 min-w-[480px]">
                    <h5 className="mb-4 font-semibold">Campos — {fieldsDoc?.label}</h5>
                    {fieldsLoading ? (
                        <Skeleton className="h-32" />
                    ) : (
                        <div className="space-y-2">
                            {fields.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-4">
                                    No hay campos de extracción configurados para este tipo.
                                </p>
                            ) : (
                                fields.map((f) => (
                                    <div key={f.id} className="flex items-center justify-between border rounded p-3">
                                        <div>
                                            <p className="font-mono text-xs text-gray-500">{f.path}</p>
                                            <p className="text-sm font-medium">{f.label}</p>
                                            <p className="text-xs text-gray-400">
                                                {f.type}
                                                {f.validation.required ? ' · requerido' : ' · opcional'}
                                                {f.validation.regex ? ` · regex: ${f.validation.regex}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                    <div className="mt-4 flex justify-end">
                        <Button variant="default" onClick={() => setFieldsDoc(null)}>Cerrar</Button>
                    </div>
                </div>
            </Dialog>
        </div>
    )
}

export default DocumentTypes
