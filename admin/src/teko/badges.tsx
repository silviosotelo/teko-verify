// Badges de dominio Teko construidos sobre el componente Tag de ecme.
import Tag from '@/components/ui/Tag'
import type { LoA, SessionState } from './types'

const STATE_LABEL: Record<SessionState, string> = {
    created: 'Creada',
    capturing: 'Capturando',
    processing: 'Procesando',
    review: 'Revisión',
    in_review: 'En revisión',
    verified: 'Verificada',
    rejected: 'Rechazada',
    needs_recapture: 'Recaptura',
    expired: 'Expirada',
    error: 'Error',
}

const STATE_CLASS: Record<SessionState, string> = {
    verified:
        'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100',
    needs_recapture:
        'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100',
    error: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-100',
    expired: 'bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-100',
    processing:
        'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-100',
    review: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-100',
    in_review:
        'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-100',
    capturing:
        'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-100',
    created: 'bg-slate-100 text-slate-600 dark:bg-slate-600 dark:text-slate-100',
}

export function StateBadge({ state }: { state: SessionState }) {
    return (
        <Tag className={`border-0 ${STATE_CLASS[state] ?? ''}`}>
            {STATE_LABEL[state] ?? state}
        </Tag>
    )
}

const LOA_CLASS: Record<LoA, string> = {
    L0: 'bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-100',
    L1: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-100',
    L2: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-100',
    L3: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100',
    L4: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-500/30 dark:text-emerald-50',
}

export function LoaBadge({ loa }: { loa: LoA }) {
    return (
        <Tag className={`border-0 font-mono ${LOA_CLASS[loa] ?? ''}`}>
            {loa}
        </Tag>
    )
}

export function PassPill({ passed }: { passed: boolean }) {
    return (
        <Tag
            className={`border-0 ${
                passed
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                    : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100'
            }`}
        >
            {passed ? 'Pasó' : 'Falló'}
        </Tag>
    )
}
