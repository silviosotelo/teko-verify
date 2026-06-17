import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Table from '@/components/ui/Table'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { App } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

// Vista Apps (Pieza 2 — App-scoping): proyectos bajo la org. La app Default es el
// fallback y NO se puede borrar. Crear/renombrar/borrar exige permiso manage_apps
// (el backend lo enforced; si falta, devuelve 403 y lo mostramos como error).
const AppsView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [apps, setApps] = useState<App[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)
    const [editId, setEditId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')

    async function load() {
        if (!currentId) return
        setLoading(true)
        setError(null)
        try {
            const { apps } = await tekoApi.listApps(currentId)
            setApps(apps)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId])

    async function createApp(e: React.FormEvent) {
        e.preventDefault()
        if (!currentId || !name.trim()) return
        setBusy(true)
        setError(null)
        try {
            await tekoApi.createApp(currentId, name.trim())
            setName('')
            await load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function saveRename(appId: string) {
        if (!currentId || !editName.trim()) return
        setError(null)
        try {
            await tekoApi.updateApp(currentId, appId, editName.trim())
            setEditId(null)
            await load()
        } catch (e) {
            setError((e as Error).message)
        }
    }

    async function remove(app: App) {
        if (!currentId) return
        if (!confirm(`¿Borrar la app "${app.name}"?`)) return
        setError(null)
        try {
            await tekoApi.deleteApp(currentId, app.id)
            await load()
        } catch (e) {
            setError((e as Error).message)
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
            <div className="mb-6">
                <h3 className="mb-1">Apps</h3>
                <p className="text-gray-500">
                    {current
                        ? `Proyectos bajo ${current.name}. La app Default es el fallback.`
                        : 'Proyectos bajo la org'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            <Card className="mb-6">
                <form
                    onSubmit={createApp}
                    className="flex flex-wrap items-end gap-3"
                >
                    <div className="min-w-[200px] flex-1">
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre de la nueva app
                        </label>
                        <Input
                            placeholder="ej: App Móvil"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <Button
                        type="submit"
                        variant="solid"
                        loading={busy}
                        disabled={!currentId || !name.trim()}
                    >
                        Crear app
                    </Button>
                </form>
            </Card>

            <Card bodyClass="px-0 py-0">
                {loading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size={40} />
                    </div>
                ) : apps.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay apps para esta org.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Nombre</Th>
                                <Th>ID</Th>
                                <Th>Default</Th>
                                <Th>Creada</Th>
                                <Th />
                            </Tr>
                        </THead>
                        <TBody>
                            {apps.map((a) => (
                                <Tr key={a.id}>
                                    <Td className="font-medium heading-text">
                                        {editId === a.id ? (
                                            <Input
                                                size="sm"
                                                value={editName}
                                                onChange={(e) =>
                                                    setEditName(e.target.value)
                                                }
                                            />
                                        ) : (
                                            a.name
                                        )}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-500">
                                        {a.id}
                                    </Td>
                                    <Td>
                                        {a.isDefault ? (
                                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                                                Default
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">
                                                —
                                            </span>
                                        )}
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(a.createdAt)}
                                    </Td>
                                    <Td className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {editId === a.id ? (
                                                <>
                                                    <Button
                                                        size="xs"
                                                        variant="solid"
                                                        onClick={() =>
                                                            saveRename(a.id)
                                                        }
                                                    >
                                                        Guardar
                                                    </Button>
                                                    <Button
                                                        size="xs"
                                                        variant="default"
                                                        onClick={() =>
                                                            setEditId(null)
                                                        }
                                                    >
                                                        Cancelar
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        size="xs"
                                                        variant="default"
                                                        onClick={() => {
                                                            setEditId(a.id)
                                                            setEditName(a.name)
                                                        }}
                                                    >
                                                        Renombrar
                                                    </Button>
                                                    {!a.isDefault && (
                                                        <Button
                                                            size="xs"
                                                            variant="default"
                                                            onClick={() =>
                                                                remove(a)
                                                            }
                                                        >
                                                            Borrar
                                                        </Button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>
        </div>
    )
}

export default AppsView
