import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Select from '@/components/ui/Select'
import Table from '@/components/ui/Table'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { StateBadge, LoaBadge } from '@/teko/badges'
import { fmtDate } from '@/teko/format'
import type { SessionRow, SessionState } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

const STATE_OPTIONS: { value: SessionState | ''; label: string }[] = [
    { value: '', label: 'Todos los estados' },
    { value: 'created', label: 'Creada' },
    { value: 'capturing', label: 'Capturando' },
    { value: 'processing', label: 'Procesando' },
    { value: 'in_review', label: 'En revisión' },
    { value: 'verified', label: 'Verificada' },
    { value: 'rejected', label: 'Rechazada' },
    { value: 'needs_recapture', label: 'Recaptura' },
    { value: 'expired', label: 'Expirada' },
    { value: 'error', label: 'Error' },
]

const SessionsView = () => {
    const navigate = useNavigate()
    const { current, currentId, loading: tLoading } = useTenant()
    const [rows, setRows] = useState<SessionRow[]>([])
    const [total, setTotal] = useState(0)
    const [stateFilter, setStateFilter] = useState<SessionState | ''>('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!currentId) return
        setLoading(true)
        setError(null)
        tekoApi
            .listSessions(currentId, {
                state: stateFilter || undefined,
                limit: 100,
            })
            .then((r) => {
                setRows(r.sessions)
                setTotal(r.total)
            })
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId, stateFilter])

    if (tLoading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Sesiones</h3>
                    <p className="text-gray-500">
                        {current
                            ? `Verificaciones de ${current.name}`
                            : 'Verificaciones del tenant'}
                    </p>
                </div>
                <div className="w-56">
                    <Select
                        size="sm"
                        options={STATE_OPTIONS}
                        value={STATE_OPTIONS.find(
                            (o) => o.value === stateFilter,
                        )}
                        onChange={(opt) =>
                            setStateFilter(
                                (opt?.value as SessionState | '') ?? '',
                            )
                        }
                    />
                </div>
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
                ) : rows.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay sesiones para este filtro.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Estado</Th>
                                <Th>LoA</Th>
                                <Th>Ref. externa</Th>
                                <Th>Creada</Th>
                                <Th>Sesión</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {rows.map((s) => (
                                <Tr
                                    key={s.id}
                                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                                    onClick={() =>
                                        navigate(`/sessions/${s.id}`)
                                    }
                                >
                                    <Td>
                                        <StateBadge state={s.state} />
                                    </Td>
                                    <Td>
                                        <LoaBadge
                                            loa={
                                                s.result?.loa ??
                                                s.assuranceRequired
                                            }
                                        />
                                    </Td>
                                    <Td>{s.externalRef || '—'}</Td>
                                    <Td className="whitespace-nowrap text-gray-500">
                                        {fmtDate(s.createdAt)}
                                    </Td>
                                    <Td className="font-mono text-xs text-gray-400">
                                        {s.id.slice(0, 8)}…
                                    </Td>
                                </Tr>
                            ))}
                        </TBody>
                    </Table>
                )}
            </Card>
            {!loading && rows.length > 0 && (
                <div className="mt-3 text-xs text-gray-400">
                    {rows.length} de {total} sesiones.
                </div>
            )}
        </div>
    )
}

export default SessionsView
