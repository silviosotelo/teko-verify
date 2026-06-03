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
import type { ApiKey, CreateApiKeyResponse } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

const ApiKeysView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [keys, setKeys] = useState<ApiKey[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [label, setLabel] = useState('')
    const [busy, setBusy] = useState(false)
    const [created, setCreated] = useState<CreateApiKeyResponse | null>(null)
    const [copied, setCopied] = useState(false)

    async function load() {
        if (!currentId) return
        setLoading(true)
        setError(null)
        try {
            const { apiKeys } = await tekoApi.listApiKeys(currentId)
            setKeys(apiKeys)
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

    async function createKey(e: React.FormEvent) {
        e.preventDefault()
        if (!currentId) return
        setBusy(true)
        setError(null)
        try {
            const res = await tekoApi.createApiKey(currentId, {
                label: label || 'default',
            })
            setCreated(res)
            setLabel('')
            await load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function revoke(keyId: string) {
        if (!currentId) return
        if (!confirm('¿Revocar esta API key? La acción es irreversible.')) return
        try {
            await tekoApi.revokeApiKey(currentId, keyId)
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
                <h3 className="mb-1">API Keys</h3>
                <p className="text-gray-500">
                    {current
                        ? `Claves de acceso de ${current.name}`
                        : 'Claves del tenant'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {/* Secreto recién creado — visible UNA sola vez */}
            {created && (
                <Alert
                    showIcon
                    type="success"
                    className="mb-6"
                    closable
                    onClose={() => setCreated(null)}
                >
                    <div className="font-semibold">
                        API key creada — copiala ahora
                    </div>
                    <div className="mt-1 text-xs">
                        Este secreto NO se vuelve a mostrar. Guardalo en un lugar
                        seguro.
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <code className="flex-1 overflow-x-auto rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-sm text-gray-800 dark:bg-gray-900 dark:text-gray-100">
                            {created.apiKey}
                        </code>
                        <Button
                            size="sm"
                            variant="solid"
                            onClick={() => {
                                navigator.clipboard.writeText(created.apiKey)
                                setCopied(true)
                                setTimeout(() => setCopied(false), 1500)
                            }}
                        >
                            {copied ? 'Copiado' : 'Copiar'}
                        </Button>
                    </div>
                </Alert>
            )}

            {/* Crear */}
            <Card className="mb-6">
                <form
                    onSubmit={createKey}
                    className="flex flex-wrap items-end gap-3"
                >
                    <div className="min-w-[200px] flex-1">
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Etiqueta de la nueva key
                        </label>
                        <Input
                            placeholder="ej: backend-produccion"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                        />
                    </div>
                    <Button
                        type="submit"
                        variant="solid"
                        loading={busy}
                        disabled={!currentId}
                    >
                        Generar API key
                    </Button>
                </form>
            </Card>

            {/* Listado */}
            <Card bodyClass="px-0 py-0">
                {loading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size={40} />
                    </div>
                ) : keys.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay API keys para este tenant.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Etiqueta</Th>
                                <Th>Prefijo</Th>
                                <Th>Scopes</Th>
                                <Th>Estado</Th>
                                <Th>Último uso</Th>
                                <Th>Creada</Th>
                                <Th />
                            </Tr>
                        </THead>
                        <TBody>
                            {keys.map((k) => (
                                <Tr key={k.id}>
                                    <Td className="font-medium heading-text">
                                        {k.label}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-500">
                                        {k.prefix}…
                                    </Td>
                                    <Td>
                                        <div className="flex flex-wrap gap-1">
                                            {k.scopes.map((s) => (
                                                <span
                                                    key={s}
                                                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-200"
                                                >
                                                    {s}
                                                </span>
                                            ))}
                                        </div>
                                    </Td>
                                    <Td>
                                        <span
                                            className={
                                                k.status === 'active'
                                                    ? 'text-emerald-600'
                                                    : 'text-gray-400'
                                            }
                                        >
                                            {k.status}
                                        </span>
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(k.lastUsedAt)}
                                    </Td>
                                    <Td className="text-gray-500">
                                        {fmtDate(k.createdAt)}
                                    </Td>
                                    <Td className="text-right">
                                        {k.status === 'active' && (
                                            <Button
                                                size="xs"
                                                variant="default"
                                                onClick={() => revoke(k.id)}
                                            >
                                                Revocar
                                            </Button>
                                        )}
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

export default ApiKeysView
