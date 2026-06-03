// Estado global del tenant seleccionado. Casi todos los datos son por-tenant,
// así que el selector vive en el header y se resuelve al cargar (primer tenant).
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import type { Tenant } from '../api/types'

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

  function setCurrentId(id: string) {
    setCurrentIdState(id)
    localStorage.setItem(LS_KEY, id)
  }

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const { tenants } = await api.listTenants()
      setTenants(tenants)
      const saved = localStorage.getItem(LS_KEY)
      const valid = saved && tenants.some((t) => t.id === saved) ? saved : null
      const next = valid ?? tenants[0]?.id ?? null
      setCurrentIdState(next)
      if (next) localStorage.setItem(LS_KEY, next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = tenants.find((t) => t.id === currentId) ?? null

  return (
    <Ctx.Provider
      value={{ tenants, current, currentId, setCurrentId, loading, error, reload }}
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
