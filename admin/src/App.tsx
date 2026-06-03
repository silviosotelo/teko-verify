import { Navigate, Route, Routes } from 'react-router-dom'
import { isAuthenticated } from './api/auth'
import { TenantProvider } from './context/TenantContext'
import Layout from './components/Layout'
import LoginPage from './pages/Login'
import DashboardPage from './pages/Dashboard'
import SessionsPage from './pages/Sessions'
import SessionDetailPage from './pages/SessionDetail'
import TenantsPage from './pages/Tenants'
import ApiKeysPage from './pages/ApiKeys'
import AuditPage from './pages/Audit'

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <TenantProvider>
              <Layout />
            </TenantProvider>
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
        <Route path="/tenants" element={<TenantsPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
