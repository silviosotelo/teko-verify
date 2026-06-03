// Layout principal: sidebar + header (con selector de tenant y operador).
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { clearAuth, getOperator } from '../api/auth'
import { useTenant } from '../context/TenantContext'

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-sm">
        <svg className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.29 6.8-6.8a1 1 0 011.4 0z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-bold tracking-tight text-gray-900">TEKO</div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-primary">
          identidad
        </div>
      </div>
    </div>
  )
}

const NAV = [
  { to: '/', label: 'Dashboard', exact: true, icon: IconGrid },
  { to: '/sessions', label: 'Sesiones', icon: IconShield },
  { to: '/tenants', label: 'Tenants', icon: IconBuilding },
  { to: '/api-keys', label: 'API Keys', icon: IconKey },
  { to: '/audit', label: 'Auditoría', icon: IconList },
]

function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-gray-200 bg-white md:flex md:flex-col">
      <Brand />
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-primary-subtle text-primary-deep'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <item.icon />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-gray-100 px-5 py-4 text-[11px] text-gray-400">
        Teko Verify · KYC
      </div>
    </aside>
  )
}

function TenantSelector() {
  const { tenants, currentId, setCurrentId, loading } = useTenant()
  if (loading) {
    return <div className="h-9 w-44 animate-pulse rounded-lg bg-gray-100" />
  }
  if (tenants.length === 0) {
    return <span className="text-sm text-gray-400">Sin tenants</span>
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
        Tenant
      </span>
      <select
        value={currentId ?? ''}
        onChange={(e) => setCurrentId(e.target.value)}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function Header() {
  const navigate = useNavigate()
  const op = getOperator()
  function logout() {
    clearAuth()
    navigate('/login', { replace: true })
  }
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-gray-200 bg-white/80 px-5 backdrop-blur">
      <TenantSelector />
      <div className="flex items-center gap-4">
        <div className="text-right leading-tight">
          <div className="text-sm font-semibold text-gray-800">{op?.email ?? '—'}</div>
          <div className="text-[11px] uppercase tracking-wide text-gray-400">
            {op?.role ?? ''}
          </div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-subtle text-sm font-bold text-primary-deep">
          {(op?.email ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <button onClick={logout} className="btn-secondary !px-3 !py-1.5 text-xs">
          Salir
        </button>
      </div>
    </header>
  )
}

export default function Layout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// ---- íconos inline (sin dependencia externa) ----
function IconGrid() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zm9.75 0A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zm-9.75 9.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zm9.75 0a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  )
}
function IconShield() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 5.25-4.5 9-9 9s-9-3.75-9-9c0-4.5 1.5-6.75 9-9.75 7.5 3 9 5.25 9 9.75z" />
    </svg>
  )
}
function IconBuilding() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
    </svg>
  )
}
function IconKey() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H9v1.5H7.5v1.5H6v1.5H3.375a1.125 1.125 0 01-1.125-1.125v-2.378c0-.298.119-.585.33-.796l5.048-5.048c.405-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  )
}
function IconList() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 17.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM7.5 6.75h12M7.5 12h12m-12 5.25h12" />
    </svg>
  )
}
