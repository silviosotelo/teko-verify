import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Tag from '@/components/ui/Tag'
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import classNames from '@/utils/classNames'
import type {
    BillingPlan,
    TenantSubscriptionResponse,
} from '@/teko/types'
import { PiCheck, PiArrowRight, PiStarFill } from 'react-icons/pi'

function formatPrice(cents: number, currency: string): string {
    const amount = (cents ?? 0) / 100
    try {
        return new Intl.NumberFormat('es-PY', {
            style: 'currency',
            currency: currency || 'USD',
            minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
        }).format(amount)
    } catch {
        return `${amount} ${currency || ''}`.trim()
    }
}

function formatQuota(quota: number | null): string {
    if (quota == null || quota >= 1_000_000) return 'Ilimitadas'
    return new Intl.NumberFormat('es-PY').format(quota)
}

function PlanCard({
    plan,
    isCurrent,
    highlighted,
    changing,
    disabled,
    onSelect,
}: {
    plan: BillingPlan
    isCurrent: boolean
    highlighted: boolean
    changing: boolean
    disabled: boolean
    onSelect: (slug: string) => void
}) {
    const features = Array.isArray(plan.features) ? plan.features : []
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <Card
                className={classNames(
                    'relative flex flex-col h-full',
                    (highlighted || isCurrent) &&
                        'ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/10',
                )}
            >
                {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Tag className="bg-emerald-500 text-white">Plan Actual</Tag>
                    </div>
                )}
                {highlighted && !isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Tag className="bg-primary text-white">Más Popular</Tag>
                    </div>
                )}

                <div className="flex flex-col flex-1">
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            {highlighted && (
                                <PiStarFill className="text-yellow-500" />
                            )}
                            <h4 className="text-lg font-semibold heading-text">
                                {plan.name}
                            </h4>
                        </div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-bold heading-text">
                                {formatPrice(plan.priceCents, plan.currency)}
                            </span>
                            <span className="text-gray-500 text-sm">/mes</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                            {formatQuota(plan.monthlyQuota)} verificaciones
                            incluidas
                        </div>
                    </div>

                    {features.length > 0 && (
                        <ul className="space-y-3 mb-8 flex-1">
                            {features.map((feature) => (
                                <li
                                    key={feature}
                                    className="flex items-start gap-3"
                                >
                                    <span className="mt-0.5 flex-shrink-0 text-emerald-500">
                                        <PiCheck className="w-5 h-5" />
                                    </span>
                                    <span className="text-sm text-gray-700 dark:text-gray-200">
                                        {feature}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    <Button
                        variant={isCurrent || highlighted ? 'solid' : 'default'}
                        block
                        loading={changing}
                        disabled={isCurrent || disabled}
                        onClick={() => onSelect(plan.slug)}
                    >
                        {isCurrent ? (
                            <span className="flex items-center gap-2 justify-center">
                                <PiCheck className="w-4 h-4" />
                                Plan Actual
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 justify-center">
                                Cambiar a {plan.name}
                                <PiArrowRight className="w-4 h-4" />
                            </span>
                        )}
                    </Button>
                </div>
            </Card>
        </motion.div>
    )
}

function BillingPlans() {
    const { current, currentId, loading: tLoading } = useTenant()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [plans, setPlans] = useState<BillingPlan[]>([])
    const [sub, setSub] = useState<TenantSubscriptionResponse | null>(null)
    const [changing, setChanging] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (!currentId) {
            setLoading(false)
            return
        }
        setLoading(true)
        setError(null)
        try {
            const [plansRes, subRes] = await Promise.all([
                tekoApi.listPlans(),
                tekoApi.getSubscription(currentId),
            ])
            const sorted = [...(plansRes.plans || [])].sort(
                (a, b) => a.sortOrder - b.sortOrder,
            )
            setPlans(sorted)
            setSub(subRes)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }, [currentId])

    useEffect(() => {
        load()
    }, [load])

    const currentSlug = sub?.subscription?.planSlug ?? sub?.plan?.slug ?? null
    const usage = sub?.usage
    const usagePct =
        usage && usage.quota != null && usage.quota > 0
            ? Math.min(Math.round((usage.used / usage.quota) * 100), 100)
            : 0

    async function handleSelect(slug: string) {
        if (!currentId) return
        setChanging(slug)
        try {
            await tekoApi.setPlan(currentId, slug)
            toast.push(
                <Notification title="Plan actualizado" type="success">
                    Tu plan fue cambiado correctamente.
                </Notification>,
                { placement: 'top-center' },
            )
            await load()
        } catch (e) {
            toast.push(
                <Notification title="Error" type="danger">
                    {(e as Error).message}
                </Notification>,
                { placement: 'top-center' },
            )
        } finally {
            setChanging(null)
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
                <h3 className="mb-1">Planes de Facturación</h3>
                <p className="text-gray-500">
                    {current
                        ? `Gestiona el plan de facturación de ${current.name}`
                        : 'Gestiona tu plan de facturación'}
                </p>

                {usage && (
                    <div className="mt-4 max-w-md">
                        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                            <span>Uso del período</span>
                            <span>
                                {new Intl.NumberFormat('es-PY').format(
                                    usage.used,
                                )}{' '}
                                / {formatQuota(usage.quota)}
                            </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                            <div
                                className={classNames(
                                    'h-full rounded-full transition-all duration-500',
                                    usagePct >= 90
                                        ? 'bg-red-500'
                                        : usagePct >= 75
                                          ? 'bg-amber-500'
                                          : 'bg-emerald-500',
                                )}
                                style={{ width: `${usagePct}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {error && (
                <Alert showIcon type="danger" className="mb-6">
                    {error}
                </Alert>
            )}

            {!error && !loading && sub && !sub.subscription && (
                <Alert showIcon type="info" className="mb-6">
                    Este tenant no tiene un plan activo. Elegí uno para comenzar.
                </Alert>
            )}

            {loading ? (
                <div className="grid gap-6 md:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <Card key={i}>
                            <Skeleton className="h-6 w-32 mb-4" />
                            <Skeleton className="h-10 w-24 mb-6" />
                            <Skeleton className="h-4 w-full mb-2" />
                            <Skeleton className="h-4 w-4/5 mb-2" />
                            <Skeleton className="h-4 w-3/5 mb-6" />
                            <Skeleton className="h-10 w-full" />
                        </Card>
                    ))}
                </div>
            ) : plans.length === 0 ? (
                <Card>
                    <div className="text-center py-12 text-gray-400">
                        No hay planes configurados.
                    </div>
                </Card>
            ) : (
                <div className="grid gap-6 md:grid-cols-3">
                    {plans.map((plan, idx) => (
                        <PlanCard
                            key={plan.slug}
                            plan={plan}
                            isCurrent={plan.slug === currentSlug}
                            highlighted={plans.length >= 2 && idx === 1}
                            changing={changing === plan.slug}
                            disabled={changing !== null}
                            onSelect={handleSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export default BillingPlans
