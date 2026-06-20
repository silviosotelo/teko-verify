// Estado global del tenant seleccionado. Casi todos los datos son por-tenant,
// así que el selector vive en el header y se resuelve al cargar (primer tenant).
import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react'
import { tekoApi } from './client'
import { TOKEN_NAME_IN_STORAGE } from '@/constants/api.constant'
import { useSessionUser } from '@/store/authStore'
import type { Tenant } from './types'

interface TenantCtx {
    tenants: Tenant[]
    current: Tenant | null
    currentId: string | null
    setCurrentId: (id: string) => void
    loading: boolean
    error: string | null
    reload: () => Promise<void>
}

const Ctx = createContext<TenantCtx | null>(null)

const LS_KEY = 'teko.admin.tenantId'

export function TenantProvider({ children }: { children: ReactNode }) {
    const [tenants, setTenants] = useState<Tenant[]>([])
    const [currentId, setCurrentIdState] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // El login client-side no remonta el provider: re-disparamos al cambiar la
    // sesión para que el fetch corra cuando el token ya está en storage.
    const signedIn = useSessionUser((s) => s.session.signedIn)

    function setCurrentId(id: string) {
        setCurrentIdState(id)
        localStorage.setItem(LS_KEY, id)
    }

    async function reload() {
        // Sin token todavía (ej. en /sign-in): no consultamos la API.
        if (!localStorage.getItem(TOKEN_NAME_IN_STORAGE)) {
            setLoading(false)
            return
        }
        setLoading(true)
        setError(null)
        // Un fallo transitorio del backend (ej. proceso reiniciándose) NO debe
        // dejar el selector vacío para siempre: reintentamos una vez con backoff.
        let lastErr: unknown = null
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const { tenants } = await tekoApi.listTenants()
                setTenants(tenants)
                const saved = localStorage.getItem(LS_KEY)
                const valid =
                    saved && tenants.some((t) => t.id === saved) ? saved : null
                const next = valid ?? tenants[0]?.id ?? null
                setCurrentIdState(next)
                if (next) localStorage.setItem(LS_KEY, next)
                setLoading(false)
                return
            } catch (e) {
                lastErr = e
                if (attempt === 0) await new Promise((r) => setTimeout(r, 800))
            }
        }
        setError((lastErr as Error)?.message ?? 'Error')
        setLoading(false)
    }

    // 1) Carga inicial + cambios de `signedIn` (returning user / logout).
    useEffect(() => {
        reload()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signedIn])

    // 2) Login en la MISMA carga de página: `signedIn` puede estar ya en `true`
    //    (persistido) cuando el usuario se loguea, así que el efecto de arriba no
    //    se re-dispara y el selector quedaría vacío hasta recargar. El AuthProvider
    //    emite `teko:signed-in` al setear el token → recargamos los tenants ya.
    useEffect(() => {
        const onSignedIn = () => reload()
        window.addEventListener('teko:signed-in', onSignedIn)
        return () => window.removeEventListener('teko:signed-in', onSignedIn)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const current = tenants.find((t) => t.id === currentId) ?? null

    return (
        <Ctx.Provider
            value={{
                tenants,
                current,
                currentId,
                setCurrentId,
                loading,
                error,
                reload,
            }}
        >
            {children}
        </Ctx.Provider>
    )
}

export function useTenant(): TenantCtx {
    const ctx = useContext(Ctx)
    if (!ctx) throw new Error('useTenant fuera de TenantProvider')
    return ctx
}
