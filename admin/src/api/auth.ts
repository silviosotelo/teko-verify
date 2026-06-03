// Almacenamiento del token de sesión del operador (localStorage).
import type { Operator } from './types'

const TOKEN_KEY = 'teko.admin.token'
const OPERATOR_KEY = 'teko.admin.operator'
const EXPIRES_KEY = 'teko.admin.expiresAt'

export function saveAuth(token: string, operator: Operator, expiresAt: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(OPERATOR_KEY, JSON.stringify(operator))
  localStorage.setItem(EXPIRES_KEY, expiresAt)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getOperator(): Operator | null {
  const raw = localStorage.getItem(OPERATOR_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Operator
  } catch {
    return null
  }
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(OPERATOR_KEY)
  localStorage.removeItem(EXPIRES_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
