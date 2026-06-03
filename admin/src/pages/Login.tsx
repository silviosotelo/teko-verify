import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { saveAuth } from '../api/auth'
import { Spinner } from '../components/ui'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await api.login(email.trim(), password)
      saveAuth(res.token, res.operator, res.expiresAt)
      navigate('/', { replace: true })
    } catch (err) {
      setError('Credenciales inválidas')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-green-50 via-white to-emerald-50 px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-soft">
            <svg className="h-8 w-8 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.29 6.8-6.8a1 1 0 011.4 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            TEKO <span className="text-primary">· identidad</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Panel de administración · Teko Verify
          </p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <label className="label">Usuario</label>
            {/* type="text" (NO email): la credencial es "admin", no un email */}
            <input
              type="text"
              autoComplete="username"
              className="input"
              placeholder="admin"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? <Spinner className="border-white/40 border-t-white" /> : 'Ingresar'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Acceso restringido a operadores autorizados.
        </p>
      </div>
    </div>
  )
}
