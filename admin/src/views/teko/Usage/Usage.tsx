import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Table from '@/components/ui/Table'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { UsageResponse } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

// Vista Usage (Pieza 3): verificaciones por app (y estado) en un período. Deriva
// de verification_sessions en el backend (sessions.usageByApp). Permiso view_usage.
const UsageView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [data, setData] = useState<UsageResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')

    async function load() {
        if (!currentId) return
        setLoading(true)
        setError(null)
        try {
            const res = await tekoApi.usage(currentId, {
                from: from || undefined,
                to: to || undefined,
            })
            setData(res)
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
                <h3 className="mb-1">Uso</h3>
                <p className="text-gray-500">
                    {current
                        ? `Verificaciones por app de ${current.name}`
                        : 'Verificaciones por app'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            <Card className="mb-6">
                <div className="flex flex-wrap items-end gap-3">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Desde (ISO)
                        </label>
                        <Input
                            placeholder="2026-01-01"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Hasta (ISO)
                        </label>
                        <Input
                            placeholder="2026-12-31"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                    </div>
                    <Button variant="solid" onClick={load} disabled={!currentId}>
                        Aplicar
                    </Button>
                </div>
            </Card>

            {loading ? (
                <div className="flex h-40 items-center justify-center">
                    <Spinner size={40} />
                </div>
            ) : data ? (
                <>
                    <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <Card>
                            <div className="text-sm text-gray-500">
                                Verificaciones (total)
                            </div>
                            <div className="text-2xl font-bold heading-text">
                                {data.total}
                            </div>
                        </Card>
                        <Card>
                            <div className="text-sm text-gray-500">
                                Verificadas
                            </div>
                            <div className="text-2xl font-bold text-emerald-600">
                                {data.verified}
                            </div>
                        </Card>
                        <Card>
                            <div className="text-sm text-gray-500">Apps</div>
                            <div className="text-2xl font-bold heading-text">
                                {data.apps.length}
                            </div>
                        </Card>
                    </div>

                    <Card bodyClass="px-0 py-0">
                        {data.apps.length === 0 ? (
                            <div className="py-16 text-center text-sm text-gray-400">
                                Sin verificaciones en el período.
                            </div>
                        ) : (
                            <Table>
                                <THead>
                                    <Tr>
                                        <Th>App</Th>
                                        <Th>Total</Th>
                                        <Th>Verificadas</Th>
                                        <Th>Rechazadas</Th>
                                        <Th>Por estado</Th>
                                    </Tr>
                                </THead>
                                <TBody>
                                    {data.apps.map((a) => (
                                        <Tr key={a.appId ?? '_none'}>
                                            <Td className="font-medium heading-text">
                                                {a.appName}
                                            </Td>
                                            <Td>{a.total}</Td>
                                            <Td className="text-emerald-600">
                                                {a.verified}
                                            </Td>
                                            <Td className="text-gray-500">
                                                {a.rejected}
                                            </Td>
                                            <Td>
                                                <div className="flex flex-wrap gap-1">
                                                    {Object.entries(
                                                        a.byState,
                                                    ).map(([s, n]) => (
                                                        <span
                                                            key={s}
                                                            className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-200"
                                                        >
                                                            {s}: {n}
                                                        </span>
                                                    ))}
                                                </div>
                                            </Td>
                                        </Tr>
                                    ))}
                                </TBody>
                            </Table>
                        )}
                    </Card>
                </>
            ) : null}
        </div>
    )
}

export default UsageView
