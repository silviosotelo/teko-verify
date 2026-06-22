import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Notification from '@/components/ui/Notification'
import toast from '@/components/ui/toast'
import { tekoApi, type ConfigValue } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'

// Los 3 umbrales que el motor resuelve del plane (Fase 0).
const THRESHOLD_KEYS = ['matchCosine', 'livenessScore', 'qualityGlassesPct'] as const

const SCOPE_OPTS = [
    { value: 'system', label: 'Sistema (plataforma)' },
    { value: 'tenant', label: 'Tenant (organización)' },
]

export default function Configuracion() {
    const { currentId: tenantId } = useTenant()
    const [scopeType, setScopeType] = useState<'system' | 'tenant'>('tenant')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState<Record<string, string>>({})

    async function load() {
        if (!tenantId) return
        setLoading(true)
        setError(null)
        try {
            const res = await tekoApi.getConfig(tenantId, scopeType)
            const next: Record<string, string> = {}
            for (const k of THRESHOLD_KEYS) {
                const row = res.values.find(
                    (v: ConfigValue) => v.namespace === 'thresholds' && v.key === k,
                )
                next[k] = row ? String(row.value) : ''
            }
            setDraft(next)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tenantId, scopeType])

    async function save(key: string) {
        if (!tenantId) return
        const num = Number(draft[key])
        if (!Number.isFinite(num)) {
            toast.push(<Notification type="danger">Valor numérico inválido</Notification>)
            return
        }
        try {
            await tekoApi.setConfig(tenantId, {
                scopeType,
                namespace: 'thresholds',
                key,
                value: num,
            })
            toast.push(<Notification type="success">{key} guardado (nueva versión)</Notification>)
            void load()
        } catch (e) {
            toast.push(<Notification type="danger">{(e as Error).message}</Notification>)
        }
    }

    return (
        <Card>
            <div className="flex items-center justify-between mb-4">
                <h4>Configuración — Umbrales</h4>
                <Select
                    options={SCOPE_OPTS}
                    value={SCOPE_OPTS.find((o) => o.value === scopeType)}
                    onChange={(o) => setScopeType((o?.value as 'system' | 'tenant') ?? 'tenant')}
                    className="w-64"
                />
            </div>
            {error && <Alert type="danger" showIcon className="mb-4">{error}</Alert>}
            {loading ? (
                <Spinner />
            ) : (
                <div className="flex flex-col gap-4 max-w-md">
                    {THRESHOLD_KEYS.map((k) => (
                        <div key={k} className="flex items-end gap-2">
                            <div className="flex-1">
                                <label className="block mb-1 text-sm">{k}</label>
                                <Input
                                    value={draft[k] ?? ''}
                                    placeholder="(usa default del sistema)"
                                    onChange={(e) =>
                                        setDraft((d) => ({ ...d, [k]: e.target.value }))
                                    }
                                />
                            </div>
                            <Button size="sm" variant="solid" onClick={() => save(k)}>
                                Guardar
                            </Button>
                        </div>
                    ))}
                    <p className="text-xs text-gray-500">
                        Scope vacío → hereda del sistema (cascada workflow→app→tenant→system).
                        Cada guardado crea una versión nueva (auditada).
                    </p>
                </div>
            )}
        </Card>
    )
}
