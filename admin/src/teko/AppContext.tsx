// Estado global de la App seleccionada (scope tenant → app).
// null currentAppId = "todas / scope global" (válido: muestra data de todas las apps del tenant).
import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react'
import { tekoApi } from './client'
import { useTenant } from './TenantContext'
import type { App } from './types'

interface AppCtx {
    apps: App[]
    currentApp: App | null
    currentAppId: string | null
    setCurrentAppId: (id: string | null) => void
    loading: boolean
}

const AppContext = createContext<AppCtx | null>(null)

const LS_KEY = 'teko.admin.appId'

export function AppProvider({ children }: { children: ReactNode }) {
    const { currentId: tenantId } = useTenant()
    const [apps, setApps] = useState<App[]>([])
    const [currentAppId, setCurrentAppIdState] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    function setCurrentAppId(id: string | null) {
        setCurrentAppIdState(id)
        if (id) localStorage.setItem(LS_KEY, id)
        else localStorage.removeItem(LS_KEY)
    }

    useEffect(() => {
        if (!tenantId) {
            setApps([])
            setCurrentAppIdState(null)
            return
        }
        setLoading(true)
        tekoApi
            .listApps(tenantId)
            .then(({ apps: fetched }) => {
                setApps(fetched)
                const saved = localStorage.getItem(LS_KEY)
                const valid =
                    saved && fetched.some((a) => a.id === saved) ? saved : null
                setCurrentAppIdState(valid)
            })
            .catch(() => {
                setApps([])
                setCurrentAppIdState(null)
            })
            .finally(() => setLoading(false))
    }, [tenantId])

    const currentApp = apps.find((a) => a.id === currentAppId) ?? null

    return (
        <AppContext.Provider
            value={{ apps, currentApp, currentAppId, setCurrentAppId, loading }}
        >
            {children}
        </AppContext.Provider>
    )
}

export function useApp(): AppCtx {
    const ctx = useContext(AppContext)
    if (!ctx) throw new Error('useApp fuera de AppProvider')
    return ctx
}
