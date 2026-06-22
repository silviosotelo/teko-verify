import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import Card from '@/components/ui/Card'
import Progress from '@/components/ui/Progress'
import Button from '@/components/ui/Button'
import Tag from '@/components/ui/Tag'
import { useTenant } from '@/teko/TenantContext'
import { tekoApi } from '@/teko/client'
import {
    ONBOARDING_STEPS,
    countCompleted,
    type ConfigCheckState,
} from './checklist'

const DEFAULT_STATE: ConfigCheckState = {
    workflowCount: 0,
    hasBranding: false,
    apiKeyCount: 0,
    webhookCount: 0,
}

const ConfigCenter = () => {
    const { currentId: tenantId, current: tenant } = useTenant()
    const navigate = useNavigate()
    const [state, setState] = useState<ConfigCheckState>(DEFAULT_STATE)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!tenantId) return
        setLoading(true)
        Promise.all([
            tekoApi.listWorkflows(tenantId),
            tekoApi.listApiKeys(tenantId),
            tekoApi.listWebhooks(tenantId),
            tekoApi.getTenant(tenantId),
        ])
            .then(([wf, keys, hooks, t]) => {
                setState({
                    workflowCount: wf.workflows.length,
                    hasBranding: !!(
                        t.branding?.logoUrl ||
                        t.branding?.primaryColor ||
                        t.branding?.displayName
                    ),
                    apiKeyCount: keys.apiKeys.length,
                    webhookCount: hooks.endpoints.length,
                })
            })
            .catch(() => setState(DEFAULT_STATE))
            .finally(() => setLoading(false))
    }, [tenantId])

    const completed = countCompleted(state)
    const total = ONBOARDING_STEPS.length
    const pct = Math.round((completed / total) * 100)

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-semibold">
                Centro de Configuración
                {tenant ? ` — ${tenant.name}` : ''}
            </h2>

            <Card>
                <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                        <span className="font-medium">
                            Progreso de configuración inicial
                        </span>
                        <span className="text-sm text-gray-500">
                            {completed} / {total} completados
                        </span>
                    </div>
                    <Progress percent={pct} />
                </div>
            </Card>

            <div className="space-y-3">
                {ONBOARDING_STEPS.map((step) => {
                    const done = step.isComplete(state)
                    return (
                        <Card key={step.id}>
                            <div className="flex items-start justify-between p-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{step.label}</span>
                                        {done ? (
                                            <Tag className="bg-emerald-100 text-emerald-700 text-xs">
                                                Completado
                                            </Tag>
                                        ) : (
                                            <Tag className="bg-amber-100 text-amber-700 text-xs">
                                                Pendiente
                                            </Tag>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-500">
                                        {step.description}
                                    </p>
                                </div>
                                {!done && (
                                    <Button
                                        size="sm"
                                        variant="plain"
                                        onClick={() => navigate(step.path)}
                                    >
                                        Configurar →
                                    </Button>
                                )}
                            </div>
                        </Card>
                    )
                })}
            </div>

            {loading && (
                <p className="text-center text-sm text-gray-400">
                    Verificando estado de configuración…
                </p>
            )}
        </div>
    )
}

export default ConfigCenter
