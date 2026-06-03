// Selector de tenant para el header. La data del dashboard es per-tenant; este
// control vive en el header y por defecto resuelve al primer tenant.
import Select from '@/components/ui/Select'
import { useTenant } from './TenantContext'

type Opt = { value: string; label: string }

const TenantSelector = () => {
    const { tenants, currentId, setCurrentId, loading } = useTenant()

    if (loading || tenants.length === 0) return null

    const options: Opt[] = tenants.map((t) => ({ value: t.id, label: t.name }))
    const value = options.find((o) => o.value === currentId) ?? null

    return (
        <div className="hidden w-48 sm:block">
            <Select<Opt>
                size="sm"
                isSearchable={false}
                options={options}
                value={value}
                onChange={(opt) => opt && setCurrentId(opt.value)}
            />
        </div>
    )
}

export default TenantSelector
