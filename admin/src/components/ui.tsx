// Componentes UI compartidos: estética card/badge/botón trust-driven, verde Teko.
import type { ReactNode } from 'react'
import type { SessionState } from '../api/types'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`card p-5 ${className}`}>{children}</div>
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-primary ${className}`}
    />
  )
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-gray-500">
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-16 text-center text-sm text-gray-400">{message}</div>
  )
}

const STATE_STYLES: Record<string, string> = {
  verified: 'bg-green-100 text-green-700 ring-green-600/20',
  rejected: 'bg-red-100 text-red-700 ring-red-600/20',
  needs_recapture: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  error: 'bg-rose-100 text-rose-700 ring-rose-600/20',
  expired: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  processing: 'bg-blue-100 text-blue-700 ring-blue-600/20',
  capturing: 'bg-indigo-100 text-indigo-700 ring-indigo-600/20',
  created: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

const STATE_LABEL: Record<string, string> = {
  verified: 'Verificada',
  rejected: 'Rechazada',
  needs_recapture: 'Recaptura',
  error: 'Error',
  expired: 'Expirada',
  processing: 'Procesando',
  capturing: 'Capturando',
  created: 'Creada',
}

export function StateBadge({ state }: { state: SessionState | string }) {
  const cls = STATE_STYLES[state] ?? 'bg-gray-100 text-gray-600 ring-gray-500/20'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {STATE_LABEL[state] ?? state}
    </span>
  )
}

export function Badge({
  children,
  tone = 'gray',
}: {
  children: ReactNode
  tone?: 'gray' | 'green' | 'red' | 'amber' | 'blue'
}) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-600 ring-gray-500/20',
    green: 'bg-green-100 text-green-700 ring-green-600/20',
    red: 'bg-red-100 text-red-700 ring-red-600/20',
    amber: 'bg-amber-100 text-amber-700 ring-amber-600/20',
    blue: 'bg-blue-100 text-blue-700 ring-blue-600/20',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

export function LoaBadge({ loa }: { loa: string }) {
  const tone =
    loa === 'L3' || loa === 'L4'
      ? 'green'
      : loa === 'L0'
        ? 'red'
        : loa === 'L1'
          ? 'amber'
          : 'blue'
  return <Badge tone={tone as any}>{loa}</Badge>
}

export function PassPill({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.29 6.8-6.8a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
      OK
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500">
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.7 7.3a1 1 0 00-1.4 1.4L8.6 10l-1.3 1.3a1 1 0 101.4 1.4L10 11.4l1.3 1.3a1 1 0 001.4-1.4L11.4 10l1.3-1.3a1 1 0 00-1.4-1.4L10 8.6 8.7 7.3z"
          clipRule="evenodd"
        />
      </svg>
      Falla
    </span>
  )
}
