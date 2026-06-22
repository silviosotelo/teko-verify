// Muestra el selector de tenant + selector de app + badge de scope activo.
// Reemplaza <TenantSelector /> en el header del layout.
import Badge from '@/components/ui/Badge'
import TenantSelector from './TenantSelector'
import AppSelector from './AppSelector'
import { useTenant } from './TenantContext'
import { useApp } from './AppContext'

// Exported for unit testing
export function buildScopeLabel(
    tenantName: string | null,
    appName: string | null,
): string | null {
    if (!tenantName) return null
    return `${tenantName} / ${appName ?? 'Global'}`
}

const ScopeHeader = () => {
    const { current: tenant } = useTenant()
    const { currentApp } = useApp()

    const scopeLabel = buildScopeLabel(
        tenant?.name ?? null,
        currentApp?.name ?? null,
    )

    return (
        <div className="flex items-center gap-2">
            <TenantSelector />
            <span className="hidden text-gray-400 sm:block">/</span>
            <AppSelector />
            {scopeLabel && (
                <Badge
                    className="hidden text-xs sm:block"
                    innerClass="bg-indigo-100 text-indigo-700"
                >
                    {scopeLabel}
                </Badge>
            )}
        </div>
    )
}

export default ScopeHeader
