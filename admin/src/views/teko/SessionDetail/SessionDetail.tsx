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
    CheckType,
    EvidenceType,
    ExtractedDocument,
    SessionDetail,
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

// ----------------------------------------------------------------------------
// Fila de módulos con checks (Overview · ID Verification · …)
// ----------------------------------------------------------------------------

type ModuleDef = {
    key: string
    label: string
    type: CheckType | null
    overview?: boolean
    device?: boolean
}
const MODULE_ROW: ModuleDef[] = [
    { key: 'overview', label: 'Overview', type: null, overview: true },
    { key: 'document', label: 'ID Verification', type: 'document' },
    { key: 'liveness', label: 'Liveness', type: 'liveness' },
    { key: 'match', label: 'Face Match', type: 'match' },
    { key: 'quality', label: 'Calidad', type: 'quality' },
    { key: 'device', label: 'Device & IP', type: null, device: true },
]

function ModuleTab({
    def,
    check,
}: {
    def: ModuleDef
    check?: { passed: boolean } | undefined
}) {
    // Overview = ancla activa (sin check). Device & IP = atenuado (no tenemos dato).
    if (def.overview) {
        return (
            <span className="inline-flex items-center gap-1.5 border-b-2 border-emerald-500 px-1 pb-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                <TbShieldCheck className="text-base" />
                {def.label}
            </span>
        )
    }
    if (def.device) {
        return (
            <span
                title="Sin datos de dispositivo/IP en esta sesión"
                className="inline-flex items-center gap-1.5 px-1 pb-2 text-sm font-medium text-gray-300 dark:text-gray-600"
            >
                <TbDeviceMobile className="text-base" />
                {def.label}
            </span>
        )
    }
    const ran = !!check
    const passed = check?.passed
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-1 pb-2 text-sm font-medium ${
                ran
                    ? 'text-gray-600 dark:text-gray-300'
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
        </span>
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

const SessionDetailView = () => {
    const { sessionId } = useParams()
    const { currentId } = useTenant()
    const [data, setData] = useState<SessionDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [pdOpen, setPdOpen] = useState(true)
    const [lightbox, setLightbox] = useState<{
        url: string
        label: string
    } | null>(null)
    const [form, setForm] = useState<FormState | null>(null)

    useEffect(() => {
        if (!currentId || !sessionId) return
        setLoading(true)
        setError(null)
        tekoApi
            .getSession(currentId, sessionId)
            .then(setData)
            .catch((e) => setError((e as Error).message))
            .finally(() => setLoading(false))
    }, [currentId, sessionId])

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
    const reasons = data.result?.reasons ?? []
    const fullName =
        [form.firstName, form.lastName].filter(Boolean).join(' ').trim() ||
        data.externalRef ||
        'Sin identidad extraída'

    const evidenceTypes = data.evidence
        .map((e) => e.type)
        .filter((t) => t !== 'frames') as EvidenceType[]

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
                        {MODULE_ROW.map((def) => (
                            <ModuleTab
                                key={def.key}
                                def={def}
                                check={
                                    def.type
                                        ? checkByType(def.type)
                                        : undefined
                                }
                            />
                        ))}
                    </div>
                </div>
            </Card>

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
