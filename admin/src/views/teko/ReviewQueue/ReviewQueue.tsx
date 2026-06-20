// Cola de revisión manual (P0 #1): sesiones en estado `in_review` esperando una
// decisión humana. Cross-tenant (el operador revisa todo); al abrir una sesión se
// fija el tenant en el contexto y se navega al detalle (donde están Aprobar/Rechazar).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Table from '@/components/ui/Table'
import Tag from '@/components/ui/Tag'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { LoaBadge } from '@/teko/badges'
import { fmtDate, fmtScore } from '@/teko/format'
import type { ReviewQueueItem } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

const ReviewQueueView = () => {
    const navigate = useNavigate()
    const { setCurrentId } = useTenant()
    const [items, setItems] = useState<ReviewQueueItem[]>([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = () => {
        setLoading(true)
        setError(null)
        tekoApi
            .reviewQueue({ limit: 100 })
            .then((r) => {
                setItems(r.items)
                setTotal(r.total)
            })
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        load()
    }, [])

    function open(item: ReviewQueueItem) {
        // El detalle es por-tenant: fijamos el tenant del ítem antes de navegar.
        setCurrentId(item.tenantId)
        navigate(`/sessions/${item.sessionId}`)
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Cola de revisión</h3>
                    <p className="text-gray-500">
                        Sesiones en revisión manual esperando una decisión
                    </p>
                </div>
                <Button size="sm" variant="default" onClick={load}>
                    Refrescar
                </Button>
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
                ) : items.length === 0 ? (
                    <div className="py-16 text-center text-sm text-gray-400">
                        No hay sesiones esperando revisión.
                    </div>
                ) : (
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Tenant</Th>
                                <Th>Sugerencia</Th>
                                <Th>LoA</Th>
                                <Th>Scores</Th>
                                <Th>Ref. externa</Th>
                                <Th>Creada</Th>
                                <Th />
                            </Tr>
                        </THead>
                        <TBody>
                            {items.map((it) => {
                                const sug = it.suggestion
                                const scores = sug?.scores
                                return (
                                    <Tr
                                        key={it.sessionId}
                                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                                        onClick={() => open(it)}
                                    >
                                        <Td className="font-medium heading-text">
                                            {it.tenantName}
                                        </Td>
                                        <Td>
                                            {sug?.decision === 'verified' ? (
                                                <Tag className="border-0 bg-emerald-100 text-xs font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100">
                                                    Aprobar
                                                </Tag>
                                            ) : sug?.decision === 'rejected' ? (
                                                <Tag className="border-0 bg-red-100 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-100">
                                                    Rechazar
                                                </Tag>
                                            ) : (
                                                <span className="text-xs text-gray-400">
                                                    —
                                                </span>
                                            )}
                                        </Td>
                                        <Td>
                                            <LoaBadge
                                                loa={
                                                    sug?.loa ??
                                                    it.assuranceRequired
                                                }
                                            />
                                        </Td>
                                        <Td className="font-mono text-xs text-gray-500">
                                            {scores
                                                ? `m:${fmtScore(scores.match)} l:${fmtScore(scores.liveness)}`
                                                : '—'}
                                        </Td>
                                        <Td>{it.externalRef || '—'}</Td>
                                        <Td className="whitespace-nowrap text-gray-500">
                                            {fmtDate(it.createdAt)}
                                        </Td>
                                        <Td className="text-right">
                                            <Button
                                                size="xs"
                                                variant="solid"
                                                onClick={(
                                                    e: React.MouseEvent,
                                                ) => {
                                                    e.stopPropagation()
                                                    open(it)
                                                }}
                                            >
                                                Revisar
                                            </Button>
                                        </Td>
                                    </Tr>
                                )
                            })}
                        </TBody>
                    </Table>
                )}
            </Card>
            {!loading && items.length > 0 && (
                <div className="mt-3 text-xs text-gray-400">
                    {items.length} de {total} en revisión.
                </div>
            )}
        </div>
    )
}

export default ReviewQueueView
