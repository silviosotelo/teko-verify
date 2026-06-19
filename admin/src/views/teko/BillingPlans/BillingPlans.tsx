import { useState } from 'react'
import { motion } from 'framer-motion'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Table from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import classNames from '@/utils/classNames'
import { PiCheck, PiX, PiArrowRight, PiStarFill, PiCreditCard } from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const PLANS: Array<{
    slug: string
    name: string
    price: number
    description: string
    features: Array<{ label: string; included: boolean; note?: string }>
    highlighted: boolean
    limit: number
}> = [
    {
        slug: 'starter',
        name: 'Starter',
        price: 29,
        description: 'Ideal para equipos pequeños que están comenzando con verificación de identidad.',
        features: [
            { label: '500 verificaciones/mes', included: true },
            { label: '1 GB almacenamiento', included: true },
            { label: '10.000 llamadas API/mes', included: true },
            { label: 'Soporte por email', included: true },
            { label: 'Verificación facial básica', included: true },
            { label: 'Screening AML', included: false },
            { label: 'Face Search 1:N', included: false },
            { label: 'API dedicada', included: false },
        ],
        highlighted: false,
        limit: 500,
    },
    {
        slug: 'professional',
        name: 'Professional',
        price: 99,
        description: 'Para empresas en crecimiento que necesitan verificación completa y soporte prioritario.',
        features: [
            { label: '5.000 verificaciones/mes', included: true },
            { label: '10 GB almacenamiento', included: true },
            { label: '100.000 llamadas API/mes', included: true },
            { label: 'Soporte prioritario 24/7', included: true },
            { label: 'Verificación facial avanzada', included: true },
            { label: 'Screening AML completo', included: true },
            { label: 'Face Search 1:N', included: true },
            { label: 'API dedicada', included: false },
        ],
        highlighted: true,
        limit: 5000,
    },
    {
        slug: 'enterprise',
        name: 'Enterprise',
        price: 299,
        description: 'Solución completa para grandes organizaciones con necesidades personalizadas.',
        features: [
            { label: 'Verificaciones ilimitadas', included: true },
            { label: '100 GB almacenamiento', included: true },
            { label: 'Llamadas API ilimitadas', included: true },
            { label: 'Soporte dedicado 24/7', included: true },
            { label: 'Verificación facial avanzada', included: true },
            { label: 'Screening AML completo', included: true },
            { label: 'Face Search 1:N', included: true },
            { label: 'API dedicada + SLA', included: true },
        ],
        highlighted: false,
        limit: 999999,
    },
]

const PLAN_LABELS: Record<string, string> = {
    starter: 'Starter',
    professional: 'Professional',
    enterprise: 'Enterprise',
}

interface BillingPlansPageProps {
    currentPlanSlug?: string
    currentUsage?: number
    totalLimit?: number
}

function PlanCard({
    plan,
    isCurrent,
    onUpgrade,
}: {
    plan: (typeof PLANS)[0]
    isCurrent: boolean
    onUpgrade: (slug: string) => void
}) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <Card
                className={classNames(
                    'relative flex flex-col',
                    plan.highlighted && 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/10',
                    isCurrent && 'ring-2 ring-emerald-500',
                )}
            >
                {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge variant="solid" color="emerald">
                            Plan Actual
                        </Badge>
                    </div>
                )}

                {plan.highlighted && !isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge variant="solid" color="primary">
                            Más Popular
                        </Badge>
                    </div>
                )}

                <div className="flex flex-col flex-1">
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            {plan.highlighted && <PiStarFill className="text-yellow-500" />}
                            <h4 className="text-lg font-semibold heading-text">{plan.name}</h4>
                        </div>
                        <p className="text-sm text-gray-500">{plan.description}</p>
                    </div>

                    <div className="mb-6">
                        <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-bold heading-text">
                                ${plan.price}
                            </span>
                            <span className="text-gray-500 text-sm">/mes</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                            {plan.limit < 999999
                                ? `${plan.limit} verificaciones incluidas`
                                : 'Verificaciones ilimitadas'}
                        </div>
                    </div>

                    <ul className="space-y-3 mb-8 flex-1">
                        {plan.features.map((feature) => (
                            <li key={feature.label} className="flex items-start gap-3">
                                <span
                                    className={classNames(
                                        'mt-0.5 flex-shrink-0',
                                        feature.included
                                            ? 'text-emerald-500'
                                            : 'text-gray-300 dark:text-gray-600',
                                    )}
                                >
                                    {feature.included ? (
                                        <PiCheck className="w-5 h-5" />
                                    ) : (
                                        <PiX className="w-5 h-5" />
                                    )}
                                </span>
                                <span
                                    className={classNames(
                                        'text-sm',
                                        feature.included
                                            ? 'text-gray-700 dark:text-gray-200'
                                            : 'text-gray-400 dark:text-gray-500',
                                    )}
                                >
                                    {feature.label}
                                    {feature.note && (
                                        <span className="block text-xs text-gray-400">
                                            {feature.note}
                                        </span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>

                    <Button
                        variant={isCurrent ? 'outline' : plan.highlighted ? 'solid' : 'outline'}
                        fullWidth
                        disabled={isCurrent}
                        onClick={() => onUpgrade(plan.slug)}
                    >
                        {isCurrent ? (
                            <>
                                <PiCheck className="w-4 h-4" />
                                <span>Plan Actual</span>
                            </>
                        ) : (
                            <>
                                <span>
                                    {plan.slug === 'starter'
                                        ? 'Comenzar'
                                        : plan.slug === 'professional'
                                            ? 'Actualizar'
                                            : 'Contactar'}
                                </span>
                                <PiArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </Button>
                </div>
            </Card>
        </motion.div>
    )
}

function BillingPlans({
    currentPlanSlug = 'professional',
    currentUsage = 342,
    totalLimit = 5000,
}: BillingPlansPageProps) {
    const { current, currentId, loading: tLoading } = useTenant()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [upgrading, setUpgrading] = useState<string | null>(null)
    const [usageData, setUsageData] = useState<{ used: number; limit: number } | null>(null)

    const usagePct = totalLimit > 0 ? Math.round((currentUsage / totalLimit) * 100) : 0

    useEffect(() => {
        if (!currentId) {
            setLoading(false)
            return
        }
        setLoading(true)
        tekoApi
            .usage(currentId)
            .then((res) => {
                setUsageData({ used: res.total, limit: totalLimit })
            })
            .catch((e) => {
                setError((e as Error).message)
            })
            .finally(() => setLoading(false))
    }, [currentId, totalLimit])

    function handleUpgrade(slug: string) {
        setUpgrading(slug)
        setTimeout(() => {
            setUpgrading(null)
        }, 1500)
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

                {usageData && (
                    <div className="mt-3 flex items-center gap-3">
                        <div className="flex-1">
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                                <span>Uso del mes</span>
                                <span>
                                    {usageData.used} / {usageData.limit}
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
                                    style={{ width: `${Math.min(usagePct, 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {error && (
                <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="grid gap-6 md:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <Card key={i}>
                            <Skeleton className="h-6 w-32 mb-4" />
                            <Skeleton className="h-10 w-24 mb-6" />
                            <Skeleton className="h-4 w-full mb-2" />
                            <Skeleton className="h-4 w-full mb-2" />
                            <Skeleton className="h-4 w-4/5 mb-2" />
                            <Skeleton className="h-4 w-3/5 mb-6" />
                            <Skeleton className="h-10 w-full" />
                        </Card>
                    ))}
                </div>
            ) : (
                <>
                    <div className="grid gap-6 md:grid-cols-3 mb-12">
                        {PLANS.map((plan) => (
                            <PlanCard
                                key={plan.slug}
                                plan={plan}
                                isCurrent={plan.slug === currentPlanSlug}
                                onUpgrade={handleUpgrade}
                            />
                        ))}
                    </div>

                    {upgrading && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                        >
                            <div className="flex items-center gap-2">
                                <PiCreditCard className="w-5 h-5" />
                                <span>
                                    Solicitud de actualización a{' '}
                                    {PLAN_LABELS[upgrading] || upgrading} enviada. Se procesará
                                    en breve.
                                </span>
                            </div>
                        </motion.div>
                    )}

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                    >
                        <h4 className="mb-4 text-lg font-semibold heading-text">
                            Comparación de Planes
                        </h4>
                        <Card bodyClass="px-0 py-0 overflow-x-auto">
                            <Table className="min-w-[700px]">
                                <THead>
                                    <Tr>
                                        <Th>Característica</Th>
                                        <Th className="text-center">Starter</Th>
                                        <Th className="text-center">Professional</Th>
                                        <Th className="text-center">Enterprise</Th>
                                    </Tr>
                                </THead>
                                <TBody>
                                    <Tr>
                                        <Td className="font-medium">Precio/mes</Td>
                                        <Td className="text-center">$29</Td>
                                        <Td className="text-center text-emerald-600 font-semibold">
                                            $99
                                        </Td>
                                        <Td className="text-center">$299</Td>
                                    </Tr>
                                    <Tr>
                                        <Td className="font-medium">Verificaciones/mes</Td>
                                        <Td className="text-center">500</Td>
                                        <Td className="text-center">5.000</Td>
                                        <Td className="text-center">Ilimitadas</Td>
                                    </Tr>
                                    <Tr>
                                        <Td className="font-medium">Almacenamiento</Td>
                                        <Td className="text-center">1 GB</Td>
                                        <Td className="text-center">10 GB</Td>
                                        <Td className="text-center">100 GB</Td>
                                    </Tr>
                                    <Tr>
                                        <Td className="font-medium">Llamadas API/mes</Td>
                                        <Td className="text-center">10.000</Td>
                                        <Td className="text-center">100.000</Td>
                                        <Td className="text-center">Ilimitadas</Td>
                                    </Tr>
                                    <Tr>
                                        <Td className="font-medium">Soporte</Td>
                                        <Td className="text-center">Email</Td>
                                        <Td className="text-center">24/7 prioritario</Td>
                                        <Td className="text-center">Dedicado</Td>
                                    </Tr>
                                    <Tr>
                                        <Td className="font-medium">Screening AML</Td>
                                        <Td className="text-center">
                                            <span className="text-gray-400">No</span>
                                        </Td>
                                        <Td className="text-center text-emerald-600">Sí</Td>
                                        <Td className="text-center text-emerald-600">Sí</Td>
                                    </Tr>
                                    <Tr>
                                        <Td className="font-medium">Face Search 1:N</Td>
                                        <Td className="text-center">
                                            <span className="text-gray-400">No</span>
                                        </Td>
                                        <Td className="text-center text-emerald-600">Sí</Td>
                                        <Td className="text-center text-emerald-600">Sí</Td>
                                    </Tr>
                                    <Tr>
                                        <Td className="font-medium">API dedicada + SLA</Td>
                                        <Td className="text-center">
                                            <span className="text-gray-400">No</span>
                                        </Td>
                                        <Td className="text-center">
                                            <span className="text-gray-400">No</span>
                                        </Td>
                                        <Td className="text-center text-emerald-600">Sí</Td>
                                    </Tr>
                                </TBody>
                            </Table>
                        </Card>
                    </motion.div>
                </>
            )}
        </div>
    )
}

export default BillingPlans
