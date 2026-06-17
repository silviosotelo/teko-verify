// "Probar verificación" — vista para que un operador testee el proceso KYC.
// Dos modos (subir imágenes / cámara en vivo) + selector de nivel L1/L2/L3.
//   L1 = solo documento · L2 = + match facial · L3 = + liveness/antispoof.
import { useRef, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Segment from '@/components/ui/Segment'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Tag from '@/components/ui/Tag'
import Tooltip from '@/components/ui/Tooltip'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { LoaBadge } from '@/teko/badges'
import { fmtScore, fmtDateOnly } from '@/teko/format'
import type { LoA, TestVerifyResponse } from '@/teko/types'

type Level = 'L1' | 'L2' | 'L3'
type Mode = 'upload' | 'camera'

const LEVEL_HINT: Record<Level, string> = {
    L1: 'L1 = solo documento (legibilidad + datos consistentes).',
    L2: 'L2 = L1 + match facial 1:1 (selfie ↔ foto de la cédula).',
    L3: 'L3 = L2 + liveness / antispoof (persona viva).',
}

const MODULE_LABEL: Record<string, string> = {
    quality: 'Calidad',
    liveness: 'Liveness',
    document: 'Documento',
    match: 'Match facial',
}

// Lee un File a base64 (sin el prefijo data:) para mandarlo al backend.
function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const res = String(reader.result || '')
            const comma = res.indexOf(',')
            resolve(comma >= 0 ? res.slice(comma + 1) : res)
        }
        reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
        reader.readAsDataURL(file)
    })
}

function FileSlot({
    label,
    preview,
    onPick,
}: {
    label: string
    preview: string | null
    onPick: (file: File) => void
}) {
    const ref = useRef<HTMLInputElement>(null)
    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex h-44 items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-700">
                {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={preview}
                        alt={label}
                        className="h-full w-full object-contain"
                    />
                ) : (
                    <span className="text-xs text-gray-400">
                        Sin imagen
                    </span>
                )}
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 dark:border-gray-700">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {label}
                </span>
                <Button
                    size="xs"
                    variant="plain"
                    onClick={() => ref.current?.click()}
                >
                    Elegir
                </Button>
                <input
                    ref={ref}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) onPick(f)
                        e.target.value = ''
                    }}
                />
            </div>
        </div>
    )
}

function ModuleBadge({
    type,
    passed,
    score,
}: {
    type: string
    passed: boolean
    score: number | null
}) {
    return (
        <div
            className={`flex items-center justify-between rounded-lg px-4 py-3 ${
                passed
                    ? 'bg-emerald-50 dark:bg-emerald-500/10'
                    : 'bg-red-50 dark:bg-red-500/10'
            }`}
        >
            <div>
                <div className="text-sm font-semibold heading-text">
                    {MODULE_LABEL[type] ?? type}
                </div>
                <div className="text-xs text-gray-500">
                    score {fmtScore(score)}
                </div>
            </div>
            <Tag
                className={`border-0 ${
                    passed
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                        : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100'
                }`}
            >
                {passed ? 'Pasó' : 'Falló'}
            </Tag>
        </div>
    )
}

function ExtractedTable({ ex }: { ex: TestVerifyResponse['extracted'] }) {
    if (!ex) {
        return (
            <p className="text-sm text-gray-400">Sin datos extraídos.</p>
        )
    }
    const rows: Array<[string, string]> = [
        ['Cédula', ex.documento?.numeroCedula || '—'],
        ['Apellidos', ex.titular?.apellidos || '—'],
        ['Nombres', ex.titular?.nombres || '—'],
        ['Fecha de nac.', fmtDateOnly(ex.titular?.fechaNacimiento)],
        ['Sexo', ex.titular?.sexo || '—'],
        ['Nacionalidad', ex.titular?.nacionalidad || '—'],
        [
            'Lugar de nac.',
            [
                ex.titular?.lugarNacimiento?.ciudad,
                ex.titular?.lugarNacimiento?.departamento,
            ]
                .filter(Boolean)
                .join(', ') || '—',
        ],
        ['Vencimiento', fmtDateOnly(ex.documentoFisico?.fechaVencimiento)],
    ]
    return (
        <table className="w-full text-sm">
            <tbody>
                {rows.map(([k, v]) => (
                    <tr
                        key={k}
                        className="border-b border-gray-100 last:border-0 dark:border-gray-700"
                    >
                        <td className="py-2 pr-4 text-gray-500">{k}</td>
                        <td className="py-2 font-medium heading-text">{v}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

const TestVerifyView = () => {
    const { current, currentId, loading: tLoading } = useTenant()
    const [level, setLevel] = useState<Level>('L2')
    const [mode, setMode] = useState<Mode>('upload')

    const [selfie, setSelfie] = useState<File | null>(null)
    const [front, setFront] = useState<File | null>(null)
    const [back, setBack] = useState<File | null>(null)
    const [selfieUrl, setSelfieUrl] = useState<string | null>(null)
    const [frontUrl, setFrontUrl] = useState<string | null>(null)
    const [backUrl, setBackUrl] = useState<string | null>(null)

    const [running, setRunning] = useState(false)
    const [result, setResult] = useState<TestVerifyResponse | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [liveLoading, setLiveLoading] = useState(false)
    const [email, setEmail] = useState('')
    const [liveMsg, setLiveMsg] = useState<{
        type: 'success' | 'warning'
        text: string
    } | null>(null)

    function pick(
        setFile: (f: File) => void,
        setUrl: (u: string) => void,
    ) {
        return (f: File) => {
            setFile(f)
            setUrl(URL.createObjectURL(f))
        }
    }

    async function run() {
        if (!currentId) return
        if (!selfie || !front || !back) {
            setError('Cargá selfie, frente y dorso de la cédula.')
            return
        }
        setRunning(true)
        setError(null)
        setResult(null)
        try {
            const [b64Selfie, b64Front, b64Back] = await Promise.all([
                fileToBase64(selfie),
                fileToBase64(front),
                fileToBase64(back),
            ])
            const res = await tekoApi.testVerify({
                tenantId: currentId,
                assurance: level as LoA,
                selfie: b64Selfie,
                front: b64Front,
                back: b64Back,
            })
            setResult(res)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setRunning(false)
        }
    }

    async function openLive() {
        if (!currentId) return
        const trimmed = email.trim()
        // Validación de formato en el cliente (el backend igual revalida).
        if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            setError('Email del solicitante inválido.')
            return
        }
        setLiveLoading(true)
        setError(null)
        setLiveMsg(null)
        try {
            const res = await tekoApi.testSession(
                currentId,
                level as LoA,
                trimmed || undefined,
            )
            window.open(res.verifyUrl, '_blank', 'noopener')
            if (trimmed) {
                setLiveMsg(
                    res.emailSent
                        ? {
                              type: 'success',
                              text: `Link enviado por email a ${trimmed}.`,
                          }
                        : {
                              type: 'warning',
                              text: 'La sesión se creó, pero el email no pudo enviarse (revisá la configuración SMTP). El link se abrió en una pestaña.',
                          },
                )
            }
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLiveLoading(false)
        }
    }

    if (tLoading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    const verified = result?.decision.state === 'verified'

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Probar verificación</h3>
                <p className="text-gray-500">
                    {current
                        ? `Testeá el proceso KYC de ${current.name}`
                        : 'Testeá el proceso KYC'}
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            <Card className="mb-6">
                <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-sm font-semibold heading-text">
                                Nivel de aseguramiento
                            </span>
                            <Tooltip
                                title={`${LEVEL_HINT.L1} ${LEVEL_HINT.L2} ${LEVEL_HINT.L3}`}
                            >
                                <span className="cursor-help text-xs text-gray-400">
                                    ⓘ
                                </span>
                            </Tooltip>
                        </div>
                        <Segment
                            value={level}
                            onChange={(val) => setLevel(val as Level)}
                        >
                            <Segment.Item value="L1">L1</Segment.Item>
                            <Segment.Item value="L2">L2</Segment.Item>
                            <Segment.Item value="L3">L3</Segment.Item>
                        </Segment>
                        <p className="mt-2 max-w-md text-xs text-gray-400">
                            {LEVEL_HINT[level]}
                        </p>
                    </div>
                    <div>
                        <div className="mb-2 text-sm font-semibold heading-text">
                            Modo
                        </div>
                        <Segment
                            value={mode}
                            onChange={(val) => setMode(val as Mode)}
                        >
                            <Segment.Item value="upload">
                                Subir imágenes
                            </Segment.Item>
                            <Segment.Item value="camera">
                                Con cámara
                            </Segment.Item>
                        </Segment>
                    </div>
                </div>
            </Card>

            {mode === 'upload' ? (
                <>
                    <Card className="mb-6">
                        <h5 className="mb-4">Imágenes</h5>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <FileSlot
                                label="Selfie"
                                preview={selfieUrl}
                                onPick={pick(setSelfie, setSelfieUrl)}
                            />
                            <FileSlot
                                label="Cédula (frente)"
                                preview={frontUrl}
                                onPick={pick(setFront, setFrontUrl)}
                            />
                            <FileSlot
                                label="Cédula (dorso)"
                                preview={backUrl}
                                onPick={pick(setBack, setBackUrl)}
                            />
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button
                                variant="solid"
                                loading={running}
                                disabled={!selfie || !front || !back}
                                onClick={run}
                            >
                                Ejecutar verificación
                            </Button>
                        </div>
                    </Card>

                    {running && (
                        <div className="flex h-40 items-center justify-center">
                            <Spinner size={40} />
                        </div>
                    )}

                    {result && !running && (
                        <>
                            <Card className="mb-6">
                                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-semibold heading-text">
                                            Decisión
                                        </span>
                                        <Tag
                                            className={`border-0 px-4 py-1 text-base font-bold ${
                                                verified
                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                    : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100'
                                            }`}
                                        >
                                            {verified
                                                ? 'VERIFICADO'
                                                : 'RECHAZADO'}
                                        </Tag>
                                        <LoaBadge loa={result.decision.loa} />
                                    </div>
                                    <span className="text-xs text-gray-400">
                                        Nivel pedido: {result.assurance}
                                    </span>
                                </div>
                                {result.decision.reasons.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {result.decision.reasons.map((r) => (
                                            <span
                                                key={r}
                                                className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                                            >
                                                {r}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </Card>

                            <Card className="mb-6">
                                <h5 className="mb-4">Módulos</h5>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {result.checks.map((c) => (
                                        <ModuleBadge
                                            key={c.type}
                                            type={c.type}
                                            passed={c.passed}
                                            score={c.score}
                                        />
                                    ))}
                                </div>
                            </Card>

                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                                <Card>
                                    <h5 className="mb-4">Datos extraídos</h5>
                                    <ExtractedTable ex={result.extracted} />
                                </Card>
                                <Card>
                                    <h5 className="mb-4">Coincidencia facial</h5>
                                    <div className="grid grid-cols-2 gap-3">
                                        <CropImg
                                            label="Selfie"
                                            b64={result.photos.selfieCrop}
                                        />
                                        <CropImg
                                            label="Foto de cédula"
                                            b64={result.photos.docFaceCrop}
                                        />
                                    </div>
                                    <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 dark:bg-gray-800">
                                        <span className="text-sm text-gray-500">
                                            Similitud (coseno)
                                        </span>
                                        {result.match ? (
                                            <span className="flex items-center gap-2">
                                                <span className="font-mono font-semibold heading-text">
                                                    {fmtScore(
                                                        result.match.cosine,
                                                    )}
                                                </span>
                                                <Tag
                                                    className={`border-0 ${
                                                        result.match.passed
                                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                                            : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-100'
                                                    }`}
                                                >
                                                    {result.match.passed
                                                        ? 'Coincide'
                                                        : 'No coincide'}
                                                </Tag>
                                            </span>
                                        ) : (
                                            <span className="text-sm text-gray-400">
                                                N/A en {result.assurance}
                                            </span>
                                        )}
                                    </div>
                                </Card>
                            </div>
                        </>
                    )}
                </>
            ) : (
                <Card>
                    <h5 className="mb-2">Captura en vivo</h5>
                    <p className="mb-4 max-w-xl text-sm text-gray-500">
                        Abre el flujo de captura del usuario (selfie + cédula con
                        cámara) al nivel <strong>{level}</strong> en una nueva
                        pestaña. Reusa exactamente el mismo proceso que ve el
                        titular.
                    </p>
                    <div className="mb-4 max-w-md">
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Email del solicitante{' '}
                            <span className="text-gray-400">(opcional)</span>
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="persona@dominio.com"
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800"
                        />
                        <p className="mt-1 text-xs text-gray-400">
                            Si lo completás, se le envía el link de verificación
                            por email.
                        </p>
                    </div>
                    {liveMsg && (
                        <Alert
                            showIcon
                            className="mb-4 max-w-xl"
                            type={
                                liveMsg.type === 'success'
                                    ? 'success'
                                    : 'warning'
                            }
                        >
                            {liveMsg.text}
                        </Alert>
                    )}
                    <Button
                        variant="solid"
                        loading={liveLoading}
                        onClick={openLive}
                    >
                        {email.trim()
                            ? 'Crear sesión y enviar link'
                            : 'Abrir captura en vivo'}
                    </Button>
                </Card>
            )}
        </div>
    )
}

function CropImg({ label, b64 }: { label: string; b64: string | null }) {
    return (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex h-36 items-center justify-center bg-gray-100 dark:bg-gray-700">
                {b64 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={`data:image/jpeg;base64,${b64}`}
                        alt={label}
                        className="h-full w-full object-contain"
                    />
                ) : (
                    <span className="text-xs text-gray-400">No disponible</span>
                )}
            </div>
            <div className="border-t border-gray-100 px-3 py-2 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">
                {label}
            </div>
        </div>
    )
}

export default TestVerifyView
