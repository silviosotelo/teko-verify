// Detalle de verificación — réplica del Business Console de Didit con marca Teko.
// Layout: header (avatar + nombre + badge de estado + cerrar + menú "…"),
// fila de módulos con checks (Overview · ID Verification · Liveness · Face Match
// · Calidad · Device & IP atenuado), tira de miniaturas con lightbox, y la
// sección "Datos personales" colapsable en 2 columnas con campos editables.
//
// Toda la data se reusa del detalle que ya devuelve el backend: la identidad
// rica vive en checks[document].detail.extracted (no en result.extracted). El
// guardar es local (stub) — no existe endpoint para mutar lo extraído y no se
// cambia el contrato del backend.
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import {
    TbCheck,
    TbX,
    TbDots,
    TbChevronDown,
    TbChevronRight,
    TbCopy,
    TbDownload,
    TbEdit,
    TbDeviceMobile,
    TbShieldCheck,
    TbClock,
    TbWorld,
    TbAlertTriangle,
    TbFileText,
    TbCamera,
    TbScan,
    TbGavel,
    TbActivity,
    TbCircleCheck,
    TbDeviceDesktop,
    TbRobot,
    TbUsers,
    TbExternalLink,
} from 'react-icons/tb'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Avatar from '@/components/ui/Avatar'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Dialog from '@/components/ui/Dialog'
import Dropdown from '@/components/ui/Dropdown'
import Notification from '@/components/ui/Notification'
import toast from '@/components/ui/toast'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { LoaBadge, PassPill } from '@/teko/badges'
import { fmtDate, fmtScore } from '@/teko/format'
import type {
    AgeEstimationResult,
    AmlResult,
    CheckType,
    DeviceIpAnalysis,
    EvidenceType,
    ExtractedDocument,
    FaceSearchResult,
    ParsedDevice,
    ProofOfAddressResult,
    RiskSeverity,
    SessionDetail,
    SessionEvent,
    SessionState,
} from '@/teko/types'

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Estado de la sesión → semáforo del header tipo Didit (APROBADO / RECHAZADO / …). */
const STATUS_META: Record<
    SessionState,
    { label: string; cls: string; dot: string }
> = {
    verified: {
        label: 'APROBADO',
        cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
        dot: 'bg-emerald-500',
    },
    rejected: {
        label: 'RECHAZADO',
        cls: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30',
        dot: 'bg-red-500',
    },
    review: {
        label: 'EN REVISIÓN',
        cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
        dot: 'bg-amber-500',
    },
    in_review: {
        label: 'REVISIÓN MANUAL',
        cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
        dot: 'bg-amber-500',
    },
    needs_recapture: {
        label: 'RECAPTURA',
        cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
        dot: 'bg-amber-500',
    },
    processing: {
        label: 'PROCESANDO',
        cls: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30',
        dot: 'bg-blue-500',
    },
    capturing: {
        label: 'CAPTURANDO',
        cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30',
        dot: 'bg-indigo-500',
    },
    created: {
        label: 'CREADA',
        cls: 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600',
        dot: 'bg-gray-400',
    },
    expired: {
        label: 'EXPIRADA',
        cls: 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600',
        dot: 'bg-gray-400',
    },
    error: {
        label: 'ERROR',
        cls: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
        dot: 'bg-rose-500',
    },
}

function StatusBadge({ state }: { state: SessionState }) {
    const m = STATUS_META[state] ?? STATUS_META.created
    return (
        <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ring-1 ${m.cls}`}
        >
            <span className={`h-2 w-2 rounded-full ${m.dot}`} />
            {m.label}
        </span>
    )
}

/** Bandera emoji por país/nacionalidad (sin librerías). Default: bandera neutra. */
const FLAGS: Record<string, string> = {
    paraguay: '🇵🇾',
    py: '🇵🇾',
    pry: '🇵🇾',
    argentina: '🇦🇷',
    ar: '🇦🇷',
    arg: '🇦🇷',
    brasil: '🇧🇷',
    brazil: '🇧🇷',
    br: '🇧🇷',
    bra: '🇧🇷',
    uruguay: '🇺🇾',
    bolivia: '🇧🇴',
    chile: '🇨🇱',
}
function flagFor(country?: string | null): string {
    if (!country) return ''
    const k = country.trim().toLowerCase()
    if (FLAGS[k]) return FLAGS[k]
    // Coincidencia por substring: "REPÚBLICA DEL PARAGUAY", "PARAGUAYA", etc.
    for (const [name, flag] of Object.entries(FLAGS)) {
        if (name.length > 2 && k.includes(name)) return flag
    }
    if (k.includes('paragua')) return '🇵🇾'
    return '🏳️'
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** "YYYY-MM-DD" → Date local (sin corrimiento de zona horaria). */
function parseDateOnly(s?: string | null): Date | null {
    if (!s) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim())
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
}
function dateToInput(d: Date | null): string {
    if (!d) return ''
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

type Option = { value: string; label: string }
const opt = (v?: string | null): Option | null =>
    v ? { value: v, label: v } : null

const GENDER_OPTIONS: Option[] = [
    { value: 'Masculino', label: 'Masculino' },
    { value: 'Femenino', label: 'Femenino' },
    { value: 'M', label: 'M' },
    { value: 'F', label: 'F' },
]
const MARITAL_OPTIONS: Option[] = [
    { value: 'Soltero/a', label: 'Soltero/a' },
    { value: 'Casado/a', label: 'Casado/a' },
    { value: 'Divorciado/a', label: 'Divorciado/a' },
    { value: 'Viudo/a', label: 'Viudo/a' },
]
const COUNTRY_OPTIONS: Option[] = [
    { value: 'Paraguay', label: 'Paraguay' },
    { value: 'Argentina', label: 'Argentina' },
    { value: 'Brasil', label: 'Brasil' },
    { value: 'Uruguay', label: 'Uruguay' },
    { value: 'Bolivia', label: 'Bolivia' },
    { value: 'Chile', label: 'Chile' },
]

function notify(msg: string) {
    toast.push(
        <Notification title="Datos personales" type="success">
            {msg}
        </Notification>,
        { placement: 'top-center' },
    )
}

// ----------------------------------------------------------------------------
// Miniatura de evidencia + lightbox
// ----------------------------------------------------------------------------

const EVIDENCE_LABEL: Record<string, string> = {
    doc_front: 'Documento · frente',
    doc_back: 'Documento · dorso',
    selfie: 'Selfie',
    frames: 'Frames',
    proof_of_address: 'Comprobante de domicilio',
}

function EvidenceThumb({
    tenantId,
    sessionId,
    type,
    onOpen,
}: {
    tenantId: string
    sessionId: string
    type: EvidenceType
    onOpen: (url: string, label: string) => void
}) {
    const [url, setUrl] = useState<string | null>(null)
    const [error, setError] = useState(false)
    const [loading, setLoading] = useState(true)
    const label = EVIDENCE_LABEL[type] ?? type

    useEffect(() => {
        let revoked: string | null = null
        let alive = true
        setLoading(true)
        setError(false)
        tekoApi
            .evidenceBlob(tenantId, sessionId, type)
            .then((blob) => {
                if (!alive) return
                const u = URL.createObjectURL(blob)
                revoked = u
                setUrl(u)
            })
            .catch(() => alive && setError(true))
            .finally(() => alive && setLoading(false))
        return () => {
            alive = false
            if (revoked) URL.revokeObjectURL(revoked)
        }
    }, [tenantId, sessionId, type])

    return (
        <button
            type="button"
            title={label}
            disabled={!url}
            onClick={() => url && onOpen(url, label)}
            className="group relative h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition hover:border-emerald-400 hover:ring-2 hover:ring-emerald-200 disabled:cursor-default dark:border-gray-700 dark:bg-gray-700"
        >
            {loading ? (
                <span className="flex h-full items-center justify-center">
                    <Spinner size={20} />
                </span>
            ) : error || !url ? (
                <span className="flex h-full items-center justify-center px-1 text-center text-[10px] text-gray-400">
                    No disponible
                </span>
            ) : (
                <>
                    <img
                        src={url}
                        alt={label}
                        className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {label}
                    </span>
                </>
            )}
        </button>
    )
}

/**
 * Reproductor del VIDEO de liveness activo. Carga el binario con Authorization:
 * Bearer (igual que las imágenes; un <video src> no manda el header) → Blob URL →
 * <video controls>. Es la evidencia de que el titular ejecutó los desafíos en vivo.
 */
function LivenessVideoCard({
    tenantId,
    sessionId,
}: {
    tenantId: string
    sessionId: string
}) {
    const [url, setUrl] = useState<string | null>(null)
    const [error, setError] = useState(false)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let revoked: string | null = null
        let alive = true
        setLoading(true)
        setError(false)
        tekoApi
            .evidenceBlob(tenantId, sessionId, 'liveness_video')
            .then((blob) => {
                if (!alive) return
                const u = URL.createObjectURL(blob)
                revoked = u
                setUrl(u)
            })
            .catch(() => alive && setError(true))
            .finally(() => alive && setLoading(false))
        return () => {
            alive = false
            if (revoked) URL.revokeObjectURL(revoked)
        }
    }, [tenantId, sessionId])

    return (
        <Card className="mb-4">
            <h6 className="mb-3 text-sm font-semibold heading-text">
                Video de liveness activo
            </h6>
            <div className="flex min-h-[10rem] items-center justify-center overflow-hidden rounded-lg bg-gray-900/90">
                {loading ? (
                    <Spinner />
                ) : error || !url ? (
                    <span className="py-8 text-xs text-gray-400">
                        No disponible
                    </span>
                ) : (
                    <video
                        src={url}
                        controls
                        playsInline
                        className="max-h-[60vh] w-full object-contain"
                    />
                )}
            </div>
            <p className="mt-2 text-xs text-gray-400">
                Grabación de los desafíos guiados (girar la cabeza · parpadear ·
                sonreír). Señal anti-spoof fuerte que respalda el liveness activo.
            </p>
        </Card>
    )
}

// ----------------------------------------------------------------------------
// Fila de módulos con checks (Overview · ID Verification · …)
// ----------------------------------------------------------------------------

// Pestañas navegables del detalle (P0 #3 añade Eventos + Device & IP funcionales;
// P1 #1 añade AML / Sanciones).
type TabKey =
    | 'overview'
    | 'events'
    | 'device'
    | 'aml'
    | 'face_search'
    | 'proof_of_address'
    | 'questionnaire'

type ModuleDef = {
    key: string
    label: string
    type: CheckType | null
    /** Pestaña navegable a la que salta el tab (overview/events/device). */
    tab?: TabKey
    /** Badge numérico opcional (nº de eventos / señales de riesgo). */
    badge?: number
    danger?: boolean
}
const MODULE_ROW: ModuleDef[] = [
    { key: 'overview', label: 'Overview', type: null, tab: 'overview' },
    { key: 'document', label: 'ID Verification', type: 'document' },
    { key: 'liveness', label: 'Liveness', type: 'liveness' },
    { key: 'match', label: 'Face Match', type: 'match' },
    { key: 'quality', label: 'Calidad', type: 'quality' },
    { key: 'aml', label: 'AML / Sanciones', type: null, tab: 'aml' },
    {
        key: 'face_search',
        label: 'Coincidencias faciales',
        type: null,
        tab: 'face_search',
    },
    {
        key: 'proof_of_address',
        label: 'Comprobante de domicilio',
        type: null,
        tab: 'proof_of_address',
    },
    {
        key: 'questionnaire',
        label: 'Cuestionario',
        type: null,
        tab: 'questionnaire',
    },
    { key: 'events', label: 'Eventos', type: null, tab: 'events' },
    { key: 'device', label: 'Device & IP', type: null, tab: 'device' },
]

function ModuleTab({
    def,
    check,
    active,
    onSelect,
}: {
    def: ModuleDef
    check?: { passed: boolean } | undefined
    active: boolean
    onSelect: () => void
}) {
    // Tabs navegables (overview/events/device): botón con underline activo + badge.
    if (def.tab) {
        const Icon =
            def.tab === 'events'
                ? TbClock
                : def.tab === 'device'
                  ? TbDeviceMobile
                  : def.tab === 'aml'
                    ? TbGavel
                    : def.tab === 'face_search'
                      ? TbUsers
                      : def.tab === 'questionnaire'
                        ? TbFileText
                        : TbShieldCheck
        return (
            <button
                type="button"
                onClick={onSelect}
                className={`inline-flex items-center gap-1.5 px-1 pb-2 text-sm transition ${
                    active
                        ? 'border-b-2 border-emerald-500 font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
            >
                <Icon className="text-base" />
                {def.label}
                {typeof def.badge === 'number' && def.badge > 0 && (
                    <span
                        className={`ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                            def.danger
                                ? 'bg-red-500 text-white'
                                : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-100'
                        }`}
                    >
                        {def.badge}
                    </span>
                )}
            </button>
        )
    }
    // Tabs de módulo (document/liveness/…): informativos; al click llevan a Overview.
    const ran = !!check
    const passed = check?.passed
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`inline-flex items-center gap-1.5 px-1 pb-2 text-sm font-medium transition ${
                ran
                    ? 'text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100'
                    : 'text-gray-300 dark:text-gray-600'
            }`}
        >
            {ran ? (
                passed ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <TbCheck className="text-[11px]" strokeWidth={3} />
                    </span>
                ) : (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white">
                        <TbX className="text-[11px]" strokeWidth={3} />
                    </span>
                )
            ) : (
                <span className="h-4 w-4 rounded-full border border-dashed border-gray-300 dark:border-gray-600" />
            )}
            {def.label}
        </button>
    )
}

// ----------------------------------------------------------------------------
// Timeline de eventos (P0 #3) + panel Device & IP
// ----------------------------------------------------------------------------

/** Bandera emoji desde un código ISO alpha-2 (CF-IPCountry, p.ej. "PY"). */
function cc2flag(cc?: string | null): string {
    if (!cc) return ''
    const up = cc.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(up)) return ''
    const base = 0x1f1e6
    return String.fromCodePoint(
        base + (up.charCodeAt(0) - 65),
        base + (up.charCodeAt(1) - 65),
    )
}

/** Metadatos visuales por tipo de evento del timeline forense. */
function eventMeta(type: string): {
    icon: React.ComponentType<{ className?: string }>
    label: string
    color: string
} {
    const map: Record<
        string,
        {
            icon: React.ComponentType<{ className?: string }>
            label: string
            color: string
        }
    > = {
        'session.created': {
            icon: TbActivity,
            label: 'Sesión creada',
            color: 'bg-gray-400',
        },
        'consent.accepted': {
            icon: TbCircleCheck,
            label: 'Consentimiento aceptado',
            color: 'bg-emerald-500',
        },
        'document.front.captured': {
            icon: TbFileText,
            label: 'Documento · frente capturado',
            color: 'bg-blue-500',
        },
        'document.back.captured': {
            icon: TbFileText,
            label: 'Documento · dorso capturado',
            color: 'bg-blue-500',
        },
        'selfie.captured': {
            icon: TbCamera,
            label: 'Selfie capturada',
            color: 'bg-indigo-500',
        },
        'liveness.video_uploaded': {
            icon: TbCamera,
            label: 'Video de liveness subido',
            color: 'bg-indigo-500',
        },
        'liveness.completed': {
            icon: TbScan,
            label: 'Liveness completado',
            color: 'bg-indigo-500',
        },
        'checks.computed': {
            icon: TbScan,
            label: 'Checks computados',
            color: 'bg-violet-500',
        },
        'decision.made': {
            icon: TbGavel,
            label: 'Decisión emitida',
            color: 'bg-amber-500',
        },
        'review.decided': {
            icon: TbGavel,
            label: 'Revisión manual decidida',
            color: 'bg-amber-500',
        },
    }
    return (
        map[type] ?? {
            icon: TbActivity,
            label: type,
            color: 'bg-gray-400',
        }
    )
}

function deviceLabel(d: ParsedDevice | Record<string, never> | null): string {
    if (!d || !('type' in d)) return ''
    const parts = [d.browser, d.os].filter(Boolean)
    return parts.length ? parts.join(' · ') : d.type
}

const SEVERITY_STYLE: Record<RiskSeverity, string> = {
    high: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30',
    medium: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
    low: 'bg-yellow-50 text-yellow-700 ring-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:ring-yellow-500/30',
    info: 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-600',
}

/** Timeline cronológico de eventos forenses con device/IP/país/meta por paso. */
function EventsTimeline({ events }: { events: SessionEvent[] }) {
    if (events.length === 0) {
        return (
            <Card>
                <p className="text-sm text-gray-400">
                    Sin eventos registrados para esta sesión.
                </p>
            </Card>
        )
    }
    return (
        <Card>
            <h6 className="mb-4 text-sm font-semibold heading-text">
                Timeline de eventos
            </h6>
            <ol className="relative ml-2 border-l border-gray-200 dark:border-gray-700">
                {events.map((e) => {
                    const m = eventMeta(e.type)
                    const Icon = m.icon
                    const dev = deviceLabel(e.device)
                    const metaKeys = Object.keys(e.meta || {})
                    return (
                        <li key={e.id} className="mb-6 ml-6">
                            <span
                                className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full text-white ring-4 ring-white dark:ring-gray-800 ${m.color}`}
                            >
                                <Icon className="text-sm" />
                            </span>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-sm font-semibold heading-text">
                                    {m.label}
                                </span>
                                <span className="font-mono text-[11px] text-gray-400">
                                    {fmtDate(e.createdAt)}
                                </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                {e.ip && (
                                    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 font-mono dark:bg-gray-700">
                                        <TbWorld className="text-[11px]" />
                                        {e.ip}
                                    </span>
                                )}
                                {e.country && (
                                    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
                                        {cc2flag(e.country)} {e.country}
                                    </span>
                                )}
                                {dev && (
                                    <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
                                        <TbDeviceMobile className="text-[11px]" />
                                        {dev}
                                    </span>
                                )}
                                {'type' in e.device && e.device.suspicious && (
                                    <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-500/10 dark:text-red-300">
                                        <TbRobot className="text-[11px]" />
                                        UA sospechoso
                                    </span>
                                )}
                            </div>
                            {metaKeys.length > 0 && (
                                <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                                    {JSON.stringify(e.meta, null, 2)}
                                </pre>
                            )}
                        </li>
                    )
                })}
            </ol>
        </Card>
    )
}

/** Panel Device & IP: IP, país (bandera), device parseado, señales de riesgo. */
function DeviceIpPanel({ analysis }: { analysis: DeviceIpAnalysis | null }) {
    if (!analysis) {
        return (
            <Card>
                <p className="text-sm text-gray-400">
                    Sin datos de dispositivo/IP en esta sesión.
                </p>
            </Card>
        )
    }
    const d = analysis.device
    const DeviceIcon =
        d?.type === 'desktop'
            ? TbDeviceDesktop
            : d?.type === 'bot'
              ? TbRobot
              : TbDeviceMobile
    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
                <Card>
                    <h6 className="mb-3 text-sm font-semibold heading-text">
                        Dispositivo e IP
                    </h6>
                    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                        <div className="flex items-center justify-between">
                            <dt className="text-gray-400">IP</dt>
                            <dd className="font-mono font-medium heading-text">
                                {analysis.ip ?? '—'}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-gray-400">País</dt>
                            <dd className="font-medium heading-text">
                                {analysis.country
                                    ? `${cc2flag(analysis.country)} ${analysis.country}`
                                    : '—'}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-gray-400">Dispositivo</dt>
                            <dd className="inline-flex items-center gap-1.5 font-medium heading-text">
                                <DeviceIcon className="text-base text-gray-400" />
                                {d?.type ?? '—'}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-gray-400">SO</dt>
                            <dd className="font-medium heading-text">
                                {d?.os ?? '—'}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-gray-400">Navegador</dt>
                            <dd className="font-medium heading-text">
                                {d?.browser ?? '—'}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-gray-400">IPs vistas</dt>
                            <dd className="font-medium heading-text">
                                {analysis.ips.length || 0}
                            </dd>
                        </div>
                    </dl>
                    {analysis.userAgent && (
                        <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                                User-Agent
                            </div>
                            <p className="break-all font-mono text-[11px] text-gray-500 dark:text-gray-400">
                                {analysis.userAgent}
                            </p>
                        </div>
                    )}
                </Card>
            </div>
            <div className="space-y-4">
                <Card>
                    <div className="mb-3 flex items-center justify-between">
                        <h6 className="text-sm font-semibold heading-text">
                            Señales de riesgo
                        </h6>
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ring-1 ${
                                analysis.riskScore >= 50
                                    ? SEVERITY_STYLE.high
                                    : analysis.riskScore >= 25
                                      ? SEVERITY_STYLE.medium
                                      : analysis.riskScore > 0
                                        ? SEVERITY_STYLE.low
                                        : SEVERITY_STYLE.info
                            }`}
                        >
                            <TbAlertTriangle className="text-[11px]" />
                            {analysis.riskScore}
                        </span>
                    </div>
                    {analysis.signals.length === 0 ? (
                        <p className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                            <TbCircleCheck className="text-base" />
                            Sin señales de riesgo detectadas.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {analysis.signals.map((s) => (
                                <li
                                    key={s.code}
                                    className={`rounded-lg px-3 py-2 ring-1 ${SEVERITY_STYLE[s.severity]}`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold uppercase tracking-wide">
                                            {s.code}
                                        </span>
                                        <span className="text-[10px] font-semibold uppercase opacity-70">
                                            {s.severity}
                                        </span>
                                    </div>
                                    <p className="mt-0.5 text-xs">{s.detail}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </div>
    )
}

// ----------------------------------------------------------------------------
// Panel AML / Sanciones (P1 #1)
// ----------------------------------------------------------------------------

/** Color del badge por etiqueta de lista (OFAC/UN/EU/PEP...). */
function listBadgeCls(list: string): string {
    const k = list.toUpperCase()
    if (k.includes('PEP'))
        return 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300'
    if (k.includes('OFAC') || k.includes('US'))
        return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300'
    if (k.includes('UN'))
        return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300'
    if (k.includes('EU'))
        return 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300'
    return 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-700 dark:text-gray-300'
}

/**
 * Panel "AML / Sanciones": resultado del screening LOCAL (clear / potential match),
 * lista de hits (nombre, listas con badges, score, campos que matchearon). On-prem:
 * el cruce se hizo contra el dataset local; el nombre nunca salió a un tercero.
 */
function AmlPanel({ aml }: { aml: AmlResult | undefined }) {
    if (!aml) {
        return (
            <Card>
                <p className="text-sm text-gray-400">
                    El screening AML no corrió en esta sesión (el workflow no tiene
                    el check <span className="font-mono">aml</span> activo).
                </p>
            </Card>
        )
    }
    const match = aml.decision === 'potential_match'
    return (
        <div className="space-y-4">
            <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h6 className="text-sm font-semibold heading-text">
                            Screening AML / Sanciones / PEP
                        </h6>
                        <p className="mt-1 text-xs text-gray-400">
                            Cruce LOCAL (on-prem) contra{' '}
                            {aml.provider || 'dataset local'}
                            {aml.datasetVersion
                                ? ` · v${aml.datasetVersion}`
                                : ''}
                            . El nombre del titular no se envió a terceros.
                        </p>
                    </div>
                    <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ring-1 ${
                            match
                                ? 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
                                : 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
                        }`}
                    >
                        {match ? (
                            <TbAlertTriangle className="text-sm" />
                        ) : (
                            <TbCircleCheck className="text-sm" />
                        )}
                        {match ? 'COINCIDENCIA POTENCIAL' : 'SIN COINCIDENCIAS'}
                    </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                    <div>
                        <dt className="text-gray-400">Top score</dt>
                        <dd className="font-mono font-semibold heading-text">
                            {aml.topScore.toFixed(3)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Umbral</dt>
                        <dd className="font-mono font-semibold heading-text">
                            {aml.threshold.toFixed(2)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Hits</dt>
                        <dd className="font-semibold heading-text">
                            {aml.hits.length}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Consulta</dt>
                        <dd
                            className="truncate font-medium heading-text"
                            title={aml.query.normalized}
                        >
                            {aml.query.normalized || '—'}
                        </dd>
                    </div>
                </dl>
                {aml.error && (
                    <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                        Screening no disponible ({aml.error}). Por seguridad
                        (fail-closed) se trató como coincidencia potencial.
                    </div>
                )}
            </Card>

            {aml.hits.length > 0 && (
                <Card>
                    <h6 className="mb-3 text-sm font-semibold heading-text">
                        Coincidencias
                    </h6>
                    <ul className="space-y-3">
                        {aml.hits.map((h) => (
                            <li
                                key={h.entityId}
                                className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-sm font-semibold heading-text">
                                        {h.name}
                                    </span>
                                    <span className="font-mono text-xs font-semibold text-gray-500">
                                        score {h.score.toFixed(3)}
                                    </span>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    {h.lists.map((l) => (
                                        <span
                                            key={l}
                                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ${listBadgeCls(l)}`}
                                        >
                                            {l}
                                        </span>
                                    ))}
                                    {h.matchedFields.map((f) => (
                                        <span
                                            key={f}
                                            className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                                        >
                                            {f}
                                        </span>
                                    ))}
                                </div>
                                {(h.countries?.length || h.entityId) && (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                                        {h.countries &&
                                            h.countries.length > 0 && (
                                                <span>
                                                    {h.countries.join(', ')}
                                                </span>
                                            )}
                                        <span className="font-mono">
                                            {h.entityId}
                                        </span>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    )
}

// ----------------------------------------------------------------------------
// Panel Comprobante de domicilio (P1 #4)
// ----------------------------------------------------------------------------

/** Badge verde/rojo de una validación del comprobante (nombre/reciente/domicilio). */
function PoaCheck({ ok, label }: { ok: boolean; label: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${
                ok
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
                    : 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
            }`}
        >
            {ok ? (
                <TbCircleCheck className="text-sm" />
            ) : (
                <TbAlertTriangle className="text-sm" />
            )}
            {label}
        </span>
    )
}

/**
 * Panel del comprobante de domicilio: miniatura del comprobante, domicilio extraído,
 * fecha, emisor y los badges de validación (nombre coincide / reciente / dirección).
 */
function ProofOfAddressPanel({
    poa,
    tenantId,
    sessionId,
    hasEvidence,
    onOpen,
}: {
    poa: ProofOfAddressResult | undefined
    tenantId: string
    sessionId: string
    hasEvidence: boolean
    onOpen: (url: string, label: string) => void
}) {
    if (!poa) {
        return (
            <Card>
                <p className="text-sm text-gray-400">
                    El comprobante de domicilio no corrió en esta sesión (el workflow
                    no tiene el check{' '}
                    <span className="font-mono">proof_of_address</span> activo).
                </p>
            </Card>
        )
    }
    return (
        <div className="space-y-4">
            <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h6 className="text-sm font-semibold heading-text">
                            Comprobante de domicilio
                        </h6>
                        <p className="mt-1 text-xs text-gray-400">
                            Extracción heurística por OCR (on-prem). Validado contra
                            la identidad verificada del documento.
                        </p>
                    </div>
                    <PassPill passed={poa.passed} />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <PoaCheck ok={poa.nameMatch} label="Nombre coincide" />
                    <PoaCheck ok={poa.recent} label="Reciente" />
                    <PoaCheck ok={poa.hasAddress} label="Dirección" />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                    <div className="col-span-2 sm:col-span-3">
                        <dt className="text-gray-400">Domicilio extraído</dt>
                        <dd className="font-medium heading-text">
                            {poa.address || '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Titular del comprobante</dt>
                        <dd className="font-medium heading-text">
                            {poa.holderName || '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Fecha del documento</dt>
                        <dd className="font-mono font-semibold heading-text">
                            {poa.documentDate || '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Emisor</dt>
                        <dd className="font-medium heading-text">
                            {poa.issuer || '—'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Similitud de nombre</dt>
                        <dd className="font-mono font-semibold heading-text">
                            {poa.nameSimilarity.toFixed(3)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Antigüedad máx.</dt>
                        <dd className="font-semibold heading-text">
                            {poa.maxAgeMonths} meses
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Identidad esperada</dt>
                        <dd className="font-medium heading-text">
                            {poa.identityName || '—'}
                        </dd>
                    </div>
                </dl>

                {poa.error && (
                    <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                        Comprobante no procesado ({poa.error}). Por seguridad
                        (fail-closed) el check no pasó.
                    </div>
                )}
            </Card>

            {hasEvidence && (
                <Card>
                    <h6 className="mb-3 text-sm font-semibold heading-text">
                        Comprobante subido
                    </h6>
                    <EvidenceThumb
                        tenantId={tenantId}
                        sessionId={sessionId}
                        type={'proof_of_address' as EvidenceType}
                        onOpen={onOpen}
                    />
                </Card>
            )}
        </div>
    )
}

// ----------------------------------------------------------------------------
// Panel Coincidencias faciales 1:N (P1 #2)
// ----------------------------------------------------------------------------

/** Miniatura de la selfie de una identidad encontrada en la galería (1:N). */
function MatchThumb({
    tenantId,
    sessionId,
}: {
    tenantId: string
    sessionId: string
}) {
    const [url, setUrl] = useState<string | null>(null)
    const [error, setError] = useState(false)

    useEffect(() => {
        let revoked: string | null = null
        let alive = true
        setError(false)
        // Intenta la selfie; si no, la foto del documento de esa identidad.
        tekoApi
            .evidenceBlob(tenantId, sessionId, 'selfie')
            .catch(() => tekoApi.evidenceBlob(tenantId, sessionId, 'doc_front'))
            .then((blob) => {
                if (!alive) return
                const u = URL.createObjectURL(blob)
                revoked = u
                setUrl(u)
            })
            .catch(() => alive && setError(true))
        return () => {
            alive = false
            if (revoked) URL.revokeObjectURL(revoked)
        }
    }, [tenantId, sessionId])

    return (
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-700">
            {error || !url ? (
                <span className="flex h-full items-center justify-center px-1 text-center text-[9px] text-gray-400">
                    s/foto
                </span>
            ) : (
                <img src={url} alt="match" className="h-full w-full object-cover" />
            )}
        </div>
    )
}

/**
 * Panel "Coincidencias faciales (1:N)": resultado de la búsqueda contra la galería
 * de identidades verificadas (P1 #2). Muestra el estado (duplicado / usuario
 * recurrente / sin coincidencias) y la lista de matches con miniatura, coseno,
 * CI/nombre, badge de duplicado-CI-distinto vs usuario recurrente, y link a la
 * sesión encontrada. On-prem: la biometría nunca salió del server.
 */
function FaceMatchesPanel({
    fs,
    tenantId,
}: {
    fs: FaceSearchResult | undefined
    tenantId: string
}) {
    if (!fs) {
        return (
            <Card>
                <p className="text-sm text-gray-400">
                    La búsqueda facial 1:N no corrió en esta sesión (el workflow no
                    tiene el check{' '}
                    <span className="font-mono">face_search</span> activo).
                </p>
            </Card>
        )
    }
    const banner = fs.duplicateSuspected
        ? {
              label: 'POSIBLE DUPLICADO',
              cls: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30',
              icon: <TbAlertTriangle className="text-sm" />,
          }
        : fs.returningUser
          ? {
                label: 'USUARIO RECURRENTE',
                cls: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30',
                icon: <TbUsers className="text-sm" />,
            }
          : {
                label: 'SIN COINCIDENCIAS',
                cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
                icon: <TbCircleCheck className="text-sm" />,
            }
    return (
        <div className="space-y-4">
            <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h6 className="text-sm font-semibold heading-text">
                            Búsqueda facial 1:N (dedup / anti-fraude)
                        </h6>
                        <p className="mt-1 text-xs text-gray-400">
                            La cara se comparó contra {fs.gallerySize} identidad
                            {fs.gallerySize === 1 ? '' : 'es'} verificada
                            {fs.gallerySize === 1 ? '' : 's'} del tenant (excluida
                            esta sesión). On-prem: la biometría no salió del server.
                        </p>
                    </div>
                    <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide ring-1 ${banner.cls}`}
                    >
                        {banner.icon}
                        {banner.label}
                    </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                    <div>
                        <dt className="text-gray-400">Top coseno</dt>
                        <dd className="font-mono font-semibold heading-text">
                            {fs.topCosine.toFixed(3)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Umbral</dt>
                        <dd className="font-mono font-semibold heading-text">
                            {fs.threshold.toFixed(2)}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Matches</dt>
                        <dd className="font-semibold heading-text">
                            {fs.matches.length}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">CI consultado</dt>
                        <dd className="font-mono font-medium heading-text">
                            {fs.queryCi || '—'}
                        </dd>
                    </div>
                </dl>
                {fs.error && (
                    <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                        Búsqueda no disponible ({fs.error}). Por seguridad
                        (fail-closed) se trató como posible duplicado.
                    </div>
                )}
            </Card>

            {fs.matches.length > 0 && (
                <Card>
                    <h6 className="mb-3 text-sm font-semibold heading-text">
                        Coincidencias
                    </h6>
                    <ul className="space-y-3">
                        {fs.matches.map((m) => (
                            <li
                                key={m.identityId}
                                className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                            >
                                <MatchThumb
                                    tenantId={tenantId}
                                    sessionId={m.sessionId}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-sm font-semibold heading-text">
                                            {m.name || '—'}
                                        </span>
                                        {m.ciMismatch ? (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300">
                                                <TbAlertTriangle className="text-[11px]" />
                                                CI distinto
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-700 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300">
                                                <TbUsers className="text-[11px]" />
                                                Usuario recurrente
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                        <span className="font-mono">
                                            CI {m.ci || '—'}
                                        </span>
                                        <span className="font-mono">
                                            coseno {m.cosine.toFixed(3)}
                                        </span>
                                    </div>
                                </div>
                                <Link
                                    to={`/sessions/${m.sessionId}`}
                                    title="Abrir la sesión de esta identidad"
                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:border-emerald-400 hover:text-emerald-600 dark:border-gray-700 dark:text-gray-300"
                                >
                                    Ver sesión
                                    <TbExternalLink className="text-sm" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    )
}

// ----------------------------------------------------------------------------
// Campo editable de "Datos personales"
// ----------------------------------------------------------------------------

function FieldShell({
    label,
    flag,
    children,
}: {
    label: string
    flag?: string
    children: React.ReactNode
}) {
    return (
        <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                {label}
            </label>
            <div className="relative">
                {flag ? (
                    <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-base">
                        {flag}
                    </span>
                ) : null}
                {children}
            </div>
        </div>
    )
}

// ----------------------------------------------------------------------------
// Vista principal
// ----------------------------------------------------------------------------

type FormState = {
    docType: string
    docNumber: string
    personalNumber: string
    issuingState: string
    nationality: string
    firstName: string
    lastName: string
    dob: Date | null
    expiration: Date | null
    issue: Date | null
    gender: string
    marital: string
    placeOfBirth: string
}

// ----------------------------------------------------------------------------
// Panel "Cuestionario" (P2): preguntas del workflow + respuestas del solicitante.
// ----------------------------------------------------------------------------
function fmtAnswer(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'boolean') return v ? 'Sí' : 'No'
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—'
    return String(v)
}

function QuestionnairePanel({
    data,
}: {
    data: NonNullable<SessionDetail['questionnaire']> | null
}) {
    if (!data) {
        return (
            <Card>
                <p className="py-8 text-center text-sm text-gray-400">
                    Este workflow no incluyó cuestionario.
                </p>
            </Card>
        )
    }
    const answers = data.answers ?? {}
    const answeredCount = Object.keys(answers).length
    // Si tenemos las preguntas (def vigente), mostramos label→respuesta en orden;
    // si no (questionnaire borrado), caemos a las claves crudas de las respuestas.
    const rows: Array<{ id: string; label: string; value: unknown }> =
        data.questions.length > 0
            ? data.questions.map((q) => ({
                  id: q.id,
                  label: q.label,
                  value: answers[q.id],
              }))
            : Object.keys(answers).map((k) => ({
                  id: k,
                  label: k,
                  value: answers[k],
              }))

    return (
        <Card>
            <div className="mb-4 flex items-center justify-between">
                <h6 className="text-sm font-semibold heading-text">
                    {data.name || 'Cuestionario'}
                </h6>
                <span className="text-xs text-gray-400">
                    {answeredCount} respuesta{answeredCount === 1 ? '' : 's'}
                </span>
            </div>
            {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                    El solicitante aún no respondió el cuestionario.
                </p>
            ) : (
                <dl className="divide-y divide-gray-100 dark:divide-gray-700">
                    {rows.map((r) => (
                        <div
                            key={r.id}
                            className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                        >
                            <dt className="text-sm text-gray-500">{r.label}</dt>
                            <dd className="text-sm font-medium heading-text sm:max-w-[60%] sm:text-right">
                                {fmtAnswer(r.value)}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </Card>
    )
}

const SessionDetailView = () => {
    const { sessionId } = useParams()
    const { currentId } = useTenant()
    const [data, setData] = useState<SessionDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [pdOpen, setPdOpen] = useState(true)
    // Timeline forense + Device & IP (P0 #3).
    const [activeTab, setActiveTab] = useState<TabKey>('overview')
    const [events, setEvents] = useState<SessionEvent[]>([])
    const [deviceIp, setDeviceIp] = useState<DeviceIpAnalysis | null>(null)
    const [lightbox, setLightbox] = useState<{
        url: string
        label: string
    } | null>(null)
    const [form, setForm] = useState<FormState | null>(null)
    // Revisión manual (cola in_review) — P0 #1.
    const [reviewReason, setReviewReason] = useState('')
    const [reviewBusy, setReviewBusy] = useState<null | 'approve' | 'decline'>(
        null,
    )

    const loadSession = () => {
        if (!currentId || !sessionId) return
        setLoading(true)
        setError(null)
        tekoApi
            .getSession(currentId, sessionId)
            .then(setData)
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }

    useEffect(() => {
        loadSession()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId, sessionId])

    // Carga el timeline forense + análisis Device & IP (fail-soft: un fallo aquí no
    // rompe el detalle principal; las pestañas simplemente quedan vacías).
    useEffect(() => {
        if (!currentId || !sessionId) return
        let alive = true
        tekoApi
            .getSessionEvents(currentId, sessionId)
            .then((r) => {
                if (!alive) return
                setEvents(r.events)
                setDeviceIp(r.deviceIp)
            })
            .catch(() => undefined)
        return () => {
            alive = false
        }
    }, [currentId, sessionId])

    async function decideReview(decision: 'approve' | 'decline') {
        if (!sessionId) return
        setReviewBusy(decision)
        try {
            await tekoApi.decideReview(
                sessionId,
                decision,
                reviewReason.trim() || undefined,
            )
            notify(
                decision === 'approve'
                    ? 'Sesión aprobada.'
                    : 'Sesión rechazada.',
            )
            setReviewReason('')
            loadSession()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setReviewBusy(null)
        }
    }

    const extracted: ExtractedDocument | undefined = useMemo(() => {
        return data?.checks.find((c) => c.type === 'document')?.detail
            ?.extracted as ExtractedDocument | undefined
    }, [data])

    // Inicializa el formulario editable desde lo extraído por el backend.
    useEffect(() => {
        const t = extracted?.titular
        const d = extracted?.documento
        const f = extracted?.documentoFisico
        const r = extracted?.registroInterno
        setForm({
            docType: d?.tipo ?? 'Cédula de Identidad',
            docNumber: r?.ic ?? '',
            personalNumber: d?.numeroCedula ?? '',
            issuingState: d?.pais ?? t?.nacionalidad ?? '',
            nationality: t?.nacionalidad ?? '',
            firstName: t?.nombres ?? '',
            lastName: t?.apellidos ?? '',
            dob: parseDateOnly(t?.fechaNacimiento),
            expiration: parseDateOnly(f?.fechaVencimiento),
            issue: parseDateOnly(f?.fechaEmision),
            gender: t?.sexo ?? '',
            marital: t?.estadoCivil ?? '',
            placeOfBirth: [
                t?.lugarNacimiento?.ciudad,
                t?.lugarNacimiento?.departamento,
            ]
                .filter(Boolean)
                .join(', '),
        })
    }, [extracted])

    if (loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }
    if (error) {
        return (
            <Alert showIcon type="danger">
                {error}
            </Alert>
        )
    }
    if (!data || !form) {
        return (
            <Alert showIcon type="danger">
                Sesión no encontrada.
            </Alert>
        )
    }

    const checkByType = (t: CheckType) => data.checks.find((c) => c.type === t)
    const docCheck = checkByType('document')
    const amlResult = checkByType('aml')?.detail as AmlResult | undefined
    const faceSearchResult = checkByType('face_search')?.detail as
        | FaceSearchResult
        | undefined
    const proofOfAddressResult = checkByType('proof_of_address')?.detail as
        | ProofOfAddressResult
        | undefined
    const ageResult = checkByType('age_estimation')?.detail as
        | AgeEstimationResult
        | undefined
    const reasons = data.result?.reasons ?? []
    const fullName =
        [form.firstName, form.lastName].filter(Boolean).join(' ').trim() ||
        data.externalRef ||
        'Sin identidad extraída'

    const hasLivenessVideo = data.evidence.some(
        (e) => e.type === 'liveness_video',
    )
    const evidenceTypes = data.evidence
        .map((e) => e.type)
        .filter((t) => t !== 'frames' && t !== 'liveness_video') as EvidenceType[]

    // Liveness activo (desafíos guiados) reportado por el cliente — vive en el
    // detail del check liveness. Lo mostramos como chips junto al módulo Liveness.
    const livenessActive = checkByType('liveness')?.detail?.activeLiveness as
        | { challenges?: string[]; passed?: boolean }
        | undefined

    const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
        setForm((p) => (p ? { ...p, [k]: v } : p))

    const onSave = () => notify('Cambios guardados en la UI (no persistidos).')

    const inputCls =
        'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'

    return (
        <div className="mx-auto max-w-5xl">
            {/* ---------- Header ---------- */}
            <Card className="mb-4" bodyClass="p-0">
                <div className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
                    <Avatar
                        size={56}
                        shape="circle"
                        className="bg-emerald-500 font-semibold text-white"
                    >
                        {initials(fullName)}
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <h4 className="truncate font-bold heading-text">
                            {fullName}
                        </h4>
                        <p className="mt-0.5 font-mono text-xs text-gray-400">
                            {data.sessionId}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <StatusBadge state={data.state} />
                        <Dropdown
                            placement="bottom-end"
                            renderTitle={
                                <Button
                                    size="sm"
                                    shape="circle"
                                    variant="plain"
                                    icon={<TbDots />}
                                />
                            }
                        >
                            <Dropdown.Item
                                eventKey="copy"
                                onClick={() => {
                                    navigator.clipboard
                                        ?.writeText(data.sessionId)
                                        .then(() =>
                                            notify('ID de sesión copiado.'),
                                        )
                                        .catch(() => undefined)
                                }}
                            >
                                <TbCopy className="text-base" />
                                <span>Copiar ID de sesión</span>
                            </Dropdown.Item>
                            <Dropdown.Item
                                eventKey="export"
                                onClick={() => {
                                    const blob = new Blob(
                                        [JSON.stringify(data, null, 2)],
                                        { type: 'application/json' },
                                    )
                                    const u = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = u
                                    a.download = `sesion-${data.sessionId}.json`
                                    a.click()
                                    URL.revokeObjectURL(u)
                                }}
                            >
                                <TbDownload className="text-base" />
                                <span>Exportar JSON</span>
                            </Dropdown.Item>
                        </Dropdown>
                        <Link to="/sessions" title="Cerrar">
                            <Button
                                size="sm"
                                shape="circle"
                                variant="plain"
                                icon={<TbX />}
                            />
                        </Link>
                    </div>
                </div>

                {/* ---------- Fila de módulos con checks ---------- */}
                <div className="overflow-x-auto border-t border-gray-100 px-4 dark:border-gray-700 sm:px-5">
                    <div className="flex min-w-max items-center gap-6 pt-3">
                        {MODULE_ROW.map((def) => {
                            // Badges: nº de eventos (tab Eventos) / nº de señales de
                            // riesgo (tab Device & IP, en rojo si las hay).
                            const withBadge: ModuleDef =
                                def.tab === 'events'
                                    ? { ...def, badge: events.length }
                                    : def.tab === 'device'
                                      ? {
                                            ...def,
                                            badge:
                                                deviceIp?.signals.length ?? 0,
                                            danger:
                                                (deviceIp?.signals.length ??
                                                    0) > 0,
                                        }
                                      : def.tab === 'aml'
                                        ? {
                                              ...def,
                                              badge: amlResult?.hits.length ?? 0,
                                              danger:
                                                  amlResult?.decision ===
                                                  'potential_match',
                                          }
                                        : def.tab === 'face_search'
                                          ? {
                                                ...def,
                                                badge:
                                                    faceSearchResult?.matches
                                                        .length ?? 0,
                                                danger:
                                                    faceSearchResult?.duplicateSuspected ===
                                                    true,
                                            }
                                          : def
                            return (
                                <ModuleTab
                                    key={def.key}
                                    def={withBadge}
                                    check={
                                        def.type
                                            ? checkByType(def.type)
                                            : undefined
                                    }
                                    active={
                                        !!def.tab && def.tab === activeTab
                                    }
                                    onSelect={() =>
                                        setActiveTab(def.tab ?? 'overview')
                                    }
                                />
                            )
                        })}
                    </div>
                </div>
            </Card>

            {/* ---------- Acciones de revisión manual (cola in_review) ---------- */}
            {data.state === 'in_review' && (
                <Card className="mb-4 border border-amber-300 dark:border-amber-500/40">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                            <h6 className="text-sm font-semibold heading-text">
                                Revisión manual requerida
                            </h6>
                            <p className="mt-1 text-xs text-gray-500">
                                Esta sesión espera una decisión humana. El motor
                                sugiere:{' '}
                                <span className="font-semibold">
                                    {data.result?.decision === 'verified'
                                        ? 'aprobar'
                                        : data.result?.decision === 'rejected'
                                          ? 'rechazar'
                                          : '—'}
                                </span>
                                {data.result?.loa
                                    ? ` (LoA sugerido ${data.result.loa})`
                                    : ''}
                                .
                            </p>
                        </div>
                    </div>
                    <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                            Motivo (opcional, se registra en auditoría)
                        </label>
                        <Input
                            value={reviewReason}
                            placeholder="Ej: documento legible, match dudoso revisado manualmente…"
                            onChange={(e) => setReviewReason(e.target.value)}
                        />
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                        <Button
                            variant="solid"
                            customColorClass={() =>
                                'bg-red-500 hover:bg-red-600 text-white border-0'
                            }
                            loading={reviewBusy === 'decline'}
                            disabled={reviewBusy !== null}
                            onClick={() => decideReview('decline')}
                        >
                            Rechazar
                        </Button>
                        <Button
                            variant="solid"
                            loading={reviewBusy === 'approve'}
                            disabled={reviewBusy !== null}
                            onClick={() => decideReview('approve')}
                        >
                            Aprobar
                        </Button>
                    </div>
                </Card>
            )}

            {/* ---------- Pestaña Eventos (timeline forense) ---------- */}
            {activeTab === 'events' && <EventsTimeline events={events} />}

            {/* ---------- Pestaña Device & IP ---------- */}
            {activeTab === 'device' && <DeviceIpPanel analysis={deviceIp} />}

            {/* ---------- Pestaña AML / Sanciones ---------- */}
            {activeTab === 'aml' && <AmlPanel aml={amlResult} />}

            {/* ---------- Pestaña Coincidencias faciales (1:N) ---------- */}
            {activeTab === 'face_search' && (
                <FaceMatchesPanel
                    fs={faceSearchResult}
                    tenantId={data.tenantId}
                />
            )}

            {/* ---------- Pestaña Comprobante de domicilio (P1 #4) ---------- */}
            {activeTab === 'proof_of_address' && (
                <ProofOfAddressPanel
                    poa={proofOfAddressResult}
                    tenantId={data.tenantId}
                    sessionId={data.sessionId}
                    hasEvidence={data.evidence.some(
                        (e) => e.type === 'proof_of_address',
                    )}
                    onOpen={(url, label) => setLightbox({ url, label })}
                />
            )}

            {/* ---------- Pestaña Cuestionario (P2) ---------- */}
            {activeTab === 'questionnaire' && (
                <QuestionnairePanel data={data.questionnaire ?? null} />
            )}

            {/* ---------- Pestaña Overview (contenido por defecto) ---------- */}
            {activeTab === 'overview' && (
              <>
            {/* ---------- Tira de miniaturas ---------- */}
            <Card className="mb-4">
                <h6 className="mb-3 text-sm font-semibold heading-text">
                    Evidencia capturada
                </h6>
                {evidenceTypes.length === 0 ? (
                    <p className="text-sm text-gray-400">
                        Sin evidencia almacenada.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-3">
                        {evidenceTypes.map((t) => (
                            <EvidenceThumb
                                key={t}
                                tenantId={data.tenantId}
                                sessionId={data.sessionId}
                                type={t}
                                onOpen={(url, label) =>
                                    setLightbox({ url, label })
                                }
                            />
                        ))}
                    </div>
                )}
            </Card>

            {/* ---------- Estimación de edad (P2) ---------- */}
            {ageResult && (
                <Card className="mb-4">
                    <div className="flex items-center justify-between">
                        <h6 className="text-sm font-semibold heading-text">
                            Estimación de edad
                        </h6>
                        <PassPill passed={ageResult.passed} />
                    </div>
                    {ageResult.error ? (
                        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
                            No disponible ({ageResult.error}). Por seguridad el
                            check no acredita una edad (fail-closed).
                        </p>
                    ) : (
                        <div className="mt-3 flex flex-wrap items-end gap-6">
                            <div>
                                <div className="text-3xl font-semibold heading-text">
                                    {Math.round(ageResult.estimatedAge)}
                                    <span className="ml-1 text-base font-normal text-gray-400">
                                        años (est.)
                                    </span>
                                </div>
                                <div className="text-xs text-gray-400">
                                    Rango {ageResult.range || '—'} · confianza{' '}
                                    {(ageResult.confidence * 100).toFixed(0)}%
                                </div>
                            </div>
                            {ageResult.minAge !== undefined && (
                                <div className="text-sm">
                                    <span className="text-gray-400">
                                        Edad mínima
                                    </span>{' '}
                                    <span className="font-mono">
                                        {ageResult.minAge}
                                    </span>
                                    {ageResult.underage && (
                                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                            menor de edad estimado
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <p className="mt-3 text-[11px] text-gray-400">
                        Estimado estadístico (FairFace, CC BY 4.0) sobre el
                        rostro del selfie — no es una prueba legal de edad.
                    </p>
                </Card>
            )}

            {/* ---------- Video de liveness activo ---------- */}
            {hasLivenessVideo && (
                <LivenessVideoCard
                    tenantId={data.tenantId}
                    sessionId={data.sessionId}
                />
            )}

            {/* ---------- Liveness activo (desafíos guiados) ---------- */}
            {livenessActive &&
                Array.isArray(livenessActive.challenges) &&
                livenessActive.challenges.length > 0 && (
                    <Card className="mb-4">
                        <div className="flex items-center justify-between">
                            <h6 className="text-sm font-semibold heading-text">
                                Liveness activo · desafíos
                            </h6>
                            <PassPill passed={livenessActive.passed === true} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {livenessActive.challenges.map((c, i) => (
                                <span
                                    key={`${c}-${i}`}
                                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                                >
                                    <TbCheck
                                        className="text-[11px]"
                                        strokeWidth={3}
                                    />
                                    {c}
                                </span>
                            ))}
                        </div>
                    </Card>
                )}

            {/* ---------- Datos personales (colapsable, 2 columnas, editable) --- */}
            <Card className="mb-4" bodyClass="p-0">
                <button
                    type="button"
                    onClick={() => setPdOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                    <span className="flex items-center gap-2 text-base font-semibold heading-text">
                        {pdOpen ? (
                            <TbChevronDown className="text-gray-400" />
                        ) : (
                            <TbChevronRight className="text-gray-400" />
                        )}
                        Datos personales
                    </span>
                    <span className="text-xs text-gray-400">
                        Extraído del documento · editable
                    </span>
                </button>

                {pdOpen && (
                    <div className="border-t border-gray-100 p-5 dark:border-gray-700">
                        {!extracted ? (
                            <p className="text-sm text-gray-400">
                                Sin datos de documento extraídos en esta sesión.
                            </p>
                        ) : (
                            <>
                                <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
                                    {/* Document type */}
                                    <FieldShell label="Tipo de documento">
                                        <Select<Option>
                                            isClearable
                                            placeholder="Tipo"
                                            options={[
                                                {
                                                    value: 'Cédula de Identidad',
                                                    label: 'Cédula de Identidad',
                                                },
                                                {
                                                    value: 'Pasaporte',
                                                    label: 'Pasaporte',
                                                },
                                            ]}
                                            value={opt(form.docType)}
                                            onChange={(o) =>
                                                set('docType', o?.value ?? '')
                                            }
                                        />
                                    </FieldShell>
                                    {/* Document Number */}
                                    <FieldShell label="Número de documento">
                                        <Input
                                            value={form.docNumber}
                                            placeholder="—"
                                            onChange={(e) =>
                                                set(
                                                    'docNumber',
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </FieldShell>
                                    {/* Personal number (CI) */}
                                    <FieldShell label="Número personal (CI)">
                                        <Input
                                            value={form.personalNumber}
                                            placeholder="—"
                                            onChange={(e) =>
                                                set(
                                                    'personalNumber',
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </FieldShell>
                                    {/* Issuing state (con bandera) */}
                                    <FieldShell
                                        label="Estado emisor"
                                        flag={flagFor(form.issuingState)}
                                    >
                                        <Select<Option>
                                            isClearable
                                            className="[&_.select-value-container]:!pl-7"
                                            placeholder="País"
                                            options={COUNTRY_OPTIONS}
                                            value={opt(form.issuingState)}
                                            onChange={(o) =>
                                                set(
                                                    'issuingState',
                                                    o?.value ?? '',
                                                )
                                            }
                                        />
                                    </FieldShell>
                                    {/* Nationality */}
                                    <FieldShell
                                        label="Nacionalidad"
                                        flag={flagFor(form.nationality)}
                                    >
                                        <Select<Option>
                                            isClearable
                                            className="[&_.select-value-container]:!pl-7"
                                            placeholder="Nacionalidad"
                                            options={COUNTRY_OPTIONS}
                                            value={opt(form.nationality)}
                                            onChange={(o) =>
                                                set(
                                                    'nationality',
                                                    o?.value ?? '',
                                                )
                                            }
                                        />
                                    </FieldShell>
                                    {/* First name */}
                                    <FieldShell label="Nombres">
                                        <Input
                                            value={form.firstName}
                                            placeholder="—"
                                            onChange={(e) =>
                                                set(
                                                    'firstName',
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </FieldShell>
                                    {/* Last name */}
                                    <FieldShell label="Apellidos">
                                        <Input
                                            value={form.lastName}
                                            placeholder="—"
                                            onChange={(e) =>
                                                set('lastName', e.target.value)
                                            }
                                        />
                                    </FieldShell>
                                    {/* Date of birth */}
                                    <FieldShell label="Fecha de nacimiento">
                                        <DatePicker
                                            inputtable
                                            placeholder="—"
                                            value={form.dob}
                                            onChange={(d) => set('dob', d)}
                                        />
                                    </FieldShell>
                                    {/* Expiration date */}
                                    <FieldShell label="Fecha de vencimiento">
                                        <DatePicker
                                            inputtable
                                            placeholder="—"
                                            value={form.expiration}
                                            onChange={(d) =>
                                                set('expiration', d)
                                            }
                                        />
                                    </FieldShell>
                                    {/* Date of issue */}
                                    <FieldShell label="Fecha de emisión">
                                        <DatePicker
                                            inputtable
                                            placeholder="—"
                                            value={form.issue}
                                            onChange={(d) => set('issue', d)}
                                        />
                                    </FieldShell>
                                    {/* Gender */}
                                    <FieldShell label="Sexo">
                                        <Select<Option>
                                            isClearable
                                            placeholder="Sexo"
                                            options={GENDER_OPTIONS}
                                            value={opt(form.gender)}
                                            onChange={(o) =>
                                                set('gender', o?.value ?? '')
                                            }
                                        />
                                    </FieldShell>
                                    {/* Marital status */}
                                    <FieldShell label="Estado civil">
                                        <Select<Option>
                                            isClearable
                                            placeholder="Estado civil"
                                            options={MARITAL_OPTIONS}
                                            value={opt(form.marital)}
                                            onChange={(o) =>
                                                set('marital', o?.value ?? '')
                                            }
                                        />
                                    </FieldShell>
                                    {/* Place of birth */}
                                    <FieldShell label="Lugar de nacimiento">
                                        <Input
                                            value={form.placeOfBirth}
                                            placeholder="—"
                                            onChange={(e) =>
                                                set(
                                                    'placeOfBirth',
                                                    e.target.value,
                                                )
                                            }
                                        />
                                    </FieldShell>
                                </div>
                                <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
                                    <Button
                                        size="sm"
                                        variant="solid"
                                        icon={<TbEdit />}
                                        onClick={onSave}
                                    >
                                        Guardar cambios
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </Card>

            {/* ---------- Resultados de módulos + meta ---------- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                    <Card>
                        <h6 className="mb-3 text-sm font-semibold heading-text">
                            Resultados de módulos
                        </h6>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {MODULE_ROW.filter((m) => m.type).map((m) => {
                                const c = checkByType(m.type as CheckType)
                                return (
                                    <div
                                        key={m.key}
                                        className={`rounded-lg border p-3 ${
                                            c
                                                ? 'border-gray-200 dark:border-gray-700'
                                                : 'border-dashed border-gray-200 opacity-60 dark:border-gray-700'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-semibold heading-text">
                                                {m.label}
                                            </span>
                                            {c ? (
                                                <PassPill passed={c.passed} />
                                            ) : (
                                                <span className="text-xs text-gray-400">
                                                    No corrió
                                                </span>
                                            )}
                                        </div>
                                        {c && (
                                            <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs dark:border-gray-700">
                                                <span className="text-gray-400">
                                                    Score
                                                </span>
                                                <span className="font-mono font-semibold text-gray-700 dark:text-gray-200">
                                                    {fmtScore(c.score)}
                                                </span>
                                            </div>
                                        )}
                                        {Array.isArray(c?.detail?.reasons) &&
                                            (c!.detail.reasons as string[])
                                                .length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {(
                                                        c!.detail
                                                            .reasons as string[]
                                                    ).map((r) => (
                                                        <span
                                                            key={r}
                                                            className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                                                        >
                                                            {r}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                    </div>
                                )
                            })}
                        </div>

                        {/* Autenticidad documental */}
                        {Array.isArray(
                            docCheck?.detail?.authenticity?.checks,
                        ) && (
                            <>
                                <h6 className="mb-2 mt-5 text-sm font-semibold heading-text">
                                    Autenticidad documental
                                </h6>
                                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                                    {(
                                        docCheck!.detail.authenticity
                                            .checks as Array<{
                                            name: string
                                            passed: boolean
                                            detail?: string
                                        }>
                                    ).map((a) => (
                                        <li
                                            key={a.name}
                                            className="flex items-center justify-between py-2"
                                        >
                                            <span className="text-sm text-gray-700 dark:text-gray-200">
                                                {a.name}
                                                {a.detail && (
                                                    <span className="ml-2 text-xs text-gray-400">
                                                        {a.detail}
                                                    </span>
                                                )}
                                            </span>
                                            <PassPill passed={a.passed} />
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}
                    </Card>
                </div>

                <div className="space-y-4">
                    <Card>
                        <h6 className="mb-3 text-sm font-semibold heading-text">
                            Resumen
                        </h6>
                        <dl className="space-y-3 text-sm">
                            <div className="flex items-center justify-between">
                                <dt className="text-gray-400">LoA</dt>
                                <dd>
                                    <LoaBadge
                                        loa={
                                            data.result?.loa ??
                                            data.assuranceRequired
                                        }
                                    />
                                </dd>
                            </div>
                            <div className="flex items-center justify-between">
                                <dt className="text-gray-400">Ref. externa</dt>
                                <dd className="font-medium heading-text">
                                    {data.externalRef || '—'}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between">
                                <dt className="text-gray-400">Creada</dt>
                                <dd className="font-medium heading-text">
                                    {fmtDate(data.createdAt)}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between">
                                <dt className="text-gray-400">Completada</dt>
                                <dd className="font-medium heading-text">
                                    {fmtDate(data.completedAt)}
                                </dd>
                            </div>
                        </dl>
                        {reasons.length > 0 && (
                            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-700">
                                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                                    Motivos
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {reasons.map((r) => (
                                        <span
                                            key={r}
                                            className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-200"
                                        >
                                            {r}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Card>

                    {data.consents.length > 0 && (
                        <Card>
                            <h6 className="mb-3 text-sm font-semibold heading-text">
                                Consentimiento
                            </h6>
                            {data.consents.map((c, i) => (
                                <div key={i} className="text-sm">
                                    <div className="font-medium text-gray-700 dark:text-gray-200">
                                        v{c.version}
                                    </div>
                                    <div className="mt-0.5 text-xs text-gray-400">
                                        {fmtDate(c.acceptedAt)} · IP{' '}
                                        {c.ip ?? '—'}
                                    </div>
                                </div>
                            ))}
                        </Card>
                    )}
                </div>
            </div>
              </>
            )}

            {/* ---------- Lightbox ---------- */}
            <Dialog
                isOpen={!!lightbox}
                onClose={() => setLightbox(null)}
                onRequestClose={() => setLightbox(null)}
                width={720}
            >
                {lightbox && (
                    <div>
                        <h6 className="mb-3 heading-text">{lightbox.label}</h6>
                        <div className="flex items-center justify-center rounded-lg bg-gray-900/90 p-2">
                            <img
                                src={lightbox.url}
                                alt={lightbox.label}
                                className="max-h-[70vh] w-auto object-contain"
                            />
                        </div>
                    </div>
                )}
            </Dialog>
        </div>
    )
}

export default SessionDetailView
