import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Table from '@/components/ui/Table'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { fmtDate } from '@/teko/format'
import type { AuditEntry } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

function actorClass(actor: string): string {
    if (actor.startsWith('admin:'))
        return 'bg-primary-subtle text-primary'
    if (actor.startsWith('tenant:'))
        return 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100'
    if (actor.startsWith('subject'))
        return 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100'
    return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200'
}

const AuditView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [entries, setEntries] = useState<AuditEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .audit(currentId, { limit: 500 })
            .then((r) => setEntries(r.entries))
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
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
                <h3 className="mb-1">Auditoría</h3>
                <p className="text-gray-500">
                    {current
                        ? `Registro de eventos de ${current.name}`
                        : 'Audit log'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            <Card bodyClass="px-0 py-0">
                {loading ? (
                    <div className="flex h-40 items-center justify-center">
                        <Spinner size={40} />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay eventos registrados.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Fecha</Th>
                                <Th>Actor</Th>
                                <Th>Evento</Th>
                                <Th>Detalle</Th>
                                <Th>IP</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {entries.map((e) => (
                                <Tr key={e.id} className="align-top">
                                    <Td className="whitespace-nowrap text-gray-500">
                                        {fmtDate(e.createdAt)}
                                    </Td>
                                    <Td>
                                        <span
                                            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${actorClass(
                                                e.actor,
                                            )}`}
                                        >
                                            {e.actor}
                                        </span>
                                    </Td>
                                    <Td className="font-mono text-xs font-medium heading-text">
                                        {e.event}
                                    </Td>
                                    <Td className="max-w-md">
                                        {e.detail &&
                                        Object.keys(e.detail).length > 0 ? (
                                            <code className="block overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-gray-500">
                                                {JSON.stringify(e.detail)}
                                            </code>
                                        ) : (
                                            <span className="text-gray-300">
                                                —
                                            </span>
                                        )}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-400">
                                        {e.ip ?? '—'}
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>
            {!loading && entries.length > 0 && (
                <div className="mt-3 text-xs text-gray-400">
                    {entries.length} eventos.
                </div>
            )}
        </div>
    )
}

export default AuditView
