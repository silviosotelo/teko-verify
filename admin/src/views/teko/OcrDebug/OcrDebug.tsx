// "Inspector OCR" (playground visual) — el operador sube una imagen de cédula
// (FRENTE) y ve EXACTAMENTE qué detecta PaddleOCR (cajas + scores sobre la
// imagen) y qué línea OCR ancló cada campo el extractor real. Sirve para
// distinguir LEGIBILIDAD (no hay caja con ese texto) de ANCLAJE (hay caja pero
// el extractor no la tomó).
import { useMemo, useRef, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Segment from '@/components/ui/Segment'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Tag from '@/components/ui/Tag'
import Switcher from '@/components/ui/Switcher'
import Table from '@/components/ui/Table'
import { tekoApi } from '@/teko/client'
import { fmtScore, fmtDateOnly } from '@/teko/format'
import type {
    OcrDebugResponse,
    OcrDebugVariant,
    OcrFieldAnchor,
} from '@/teko/types'

const { Tr, Td, TBody } = Table

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

// Color de una caja según su score: verde ≥0.9, amarillo 0.6–0.9, rojo <0.6.
function scoreColor(score: number): string {
    if (score >= 0.9) return '#10b981' // emerald-500
    if (score >= 0.6) return '#f59e0b' // amber-500
    return '#ef4444' // red-500
}

// Etiquetas legibles de los campos extraídos (campo→título de fila).
const FIELD_LABEL: Record<string, string> = {
    apellidos: 'Apellidos',
    nombres: 'Nombres',
    ci: 'Cédula (Nº)',
    fechaNacimiento: 'Fecha de nac.',
    fechaVencimiento: 'Vencimiento',
    sexo: 'Sexo',
    lugarNacimiento: 'Lugar de nac.',
    donante: 'Donante',
}

// Mapea la clave de campo del UI a la clave del mapa `sources` del backend
// (production). El campo "ci" del UI es "numeroCedula" en el extracted/sources.
const SOURCE_KEY: Record<string, string> = {
    apellidos: 'apellidos',
    nombres: 'nombres',
    ci: 'numeroCedula',
    fechaNacimiento: 'fechaNacimiento',
    fechaVencimiento: 'fechaVencimiento',
    sexo: 'sexo',
    lugarNacimiento: 'lugarNacimiento',
}

// Etiqueta legible del origen de un campo en producción.
const SOURCE_LABEL: Record<string, string> = {
    front: 'frente',
    upscale: 'ampliado',
    enhanced: 'realzado',
    mrz: 'MRZ',
}

// Devuelve el valor presentable de un campo extraído (o '' si vacío).
function fieldValue(ex: OcrDebugResponse['extracted'], field: string): string {
    if (!ex) return ''
    switch (field) {
        case 'apellidos':
            return ex.titular?.apellidos || ''
        case 'nombres':
            return ex.titular?.nombres || ''
        case 'ci':
            return ex.documento?.numeroCedula || ''
        case 'fechaNacimiento':
            return fmtDateOnly(ex.titular?.fechaNacimiento) === '—'
                ? ''
                : fmtDateOnly(ex.titular?.fechaNacimiento)
        case 'fechaVencimiento':
            return fmtDateOnly(ex.documentoFisico?.fechaVencimiento) === '—'
                ? ''
                : fmtDateOnly(ex.documentoFisico?.fechaVencimiento)
        case 'sexo':
            return ex.titular?.sexo || ''
        case 'lugarNacimiento':
            return [
                ex.titular?.lugarNacimiento?.ciudad,
                ex.titular?.lugarNacimiento?.departamento,
            ]
                .filter(Boolean)
                .join(', ')
        case 'donante':
            return ex.titular?.donante === undefined
                ? ''
                : ex.titular?.donante
                  ? 'Sí'
                  : 'No'
        default:
            return ''
    }
}

// Overlay SVG de cajas sobre la imagen. viewBox = espacio nativo de imageUsed,
// así las cajas (en px de esa imagen) caen exactas sin importar a qué tamaño se
// renderice la imagen (la mantenemos a su aspecto natural).
function BoxOverlay({
    data,
    showAll,
    highlight,
    hoveredLine,
    onPickLine,
}: {
    data: OcrDebugResponse
    showAll: boolean
    // anclas resaltadas (valor + etiqueta) por hover de un campo.
    highlight: { box: number[]; labelBox: number[] | null } | null
    hoveredLine: number | null
    onPickLine: (idx: number | null) => void
}) {
    const { width, height, lines } = data
    if (!width || !height) return null
    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="xMidYMid meet"
        >
            {showAll &&
                lines.map((l, i) => {
                    const xs = l.box.map((p) => p[0])
                    const ys = l.box.map((p) => p[1])
                    const x = Math.min(...xs)
                    const y = Math.min(...ys)
                    const w = Math.max(...xs) - x
                    const h = Math.max(...ys) - y
                    const active = hoveredLine === i
                    return (
                        <rect
                            key={i}
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill={
                                active
                                    ? 'rgba(16,185,129,0.25)'
                                    : 'transparent'
                            }
                            stroke={scoreColor(l.score)}
                            strokeWidth={active ? 5 : 2.5}
                            className="cursor-pointer"
                            onMouseEnter={() => onPickLine(i)}
                            onMouseLeave={() => onPickLine(null)}
                        >
                            <title>{`${l.text} · ${fmtScore(l.score)}`}</title>
                        </rect>
                    )
                })}

            {/* Resaltado del ancla de un campo: etiqueta (azul) + valor (verde fuerte). */}
            {highlight?.labelBox && (
                <rect
                    x={highlight.labelBox[0]}
                    y={highlight.labelBox[1]}
                    width={highlight.labelBox[2] - highlight.labelBox[0]}
                    height={highlight.labelBox[3] - highlight.labelBox[1]}
                    fill="rgba(59,130,246,0.18)"
                    stroke="#3b82f6"
                    strokeWidth={4}
                />
            )}
            {highlight && (
                <rect
                    x={highlight.box[0]}
                    y={highlight.box[1]}
                    width={highlight.box[2] - highlight.box[0]}
                    height={highlight.box[3] - highlight.box[1]}
                    fill="rgba(16,185,129,0.30)"
                    stroke="#059669"
                    strokeWidth={5}
                />
            )}
        </svg>
    )
}

const OcrDebugView = () => {
    const [file, setFile] = useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    // Dorso OPCIONAL (sólo variant="production"): habilita el cross-fill MRZ→frente.
    const [backFile, setBackFile] = useState<File | null>(null)
    const backInputRef = useRef<HTMLInputElement>(null)
    const [variant, setVariant] = useState<OcrDebugVariant>('production')
    const [running, setRunning] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<OcrDebugResponse | null>(null)
    const [showAll, setShowAll] = useState(true)
    // Ancla resaltada por hover de un campo (valor + etiqueta).
    const [highlight, setHighlight] = useState<{
        box: number[]
        labelBox: number[] | null
    } | null>(null)
    // Línea OCR resaltada (por hover en la lista de líneas o sobre una caja).
    const [hoveredLine, setHoveredLine] = useState<number | null>(null)

    const inputRef = useRef<HTMLInputElement>(null)

    function pickFile(f: File) {
        setFile(f)
        setPreviewUrl(URL.createObjectURL(f))
        setData(null)
        setError(null)
    }

    async function analyze() {
        if (!file) {
            setError('Subí una imagen del frente de la cédula.')
            return
        }
        setRunning(true)
        setError(null)
        setData(null)
        setHighlight(null)
        setHoveredLine(null)
        try {
            const b64 = await fileToBase64(file)
            // Dorso sólo aporta en producción (cross-fill MRZ). En los modos de
            // diagnóstico el backend lo ignora.
            const back =
                variant === 'production' && backFile
                    ? await fileToBase64(backFile)
                    : undefined
            const res = await tekoApi.ocrDebug({ image: b64, variant, back })
            setData(res)
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setRunning(false)
        }
    }

    // Anclas por hover de un campo. Cuando se selecciona la línea de una caja
    // resaltada en la lista, también resaltamos esa línea sobre la imagen.
    function highlightAnchor(anchor: OcrFieldAnchor | undefined) {
        if (!anchor) {
            setHighlight(null)
            setHoveredLine(null)
            return
        }
        setHighlight({ box: anchor.box, labelBox: anchor.labelBox })
        setHoveredLine(anchor.lineIndex)
    }

    // Líneas OCR ordenadas por posición vertical (lectura natural) conservando el
    // índice original (clave para resaltar la caja correcta).
    const orderedLines = useMemo(() => {
        if (!data) return []
        return data.lines
            .map((l, idx) => ({ l, idx }))
            .sort((a, b) => {
                const ay = Math.min(...a.l.box.map((p) => p[1]))
                const by = Math.min(...b.l.box.map((p) => p[1]))
                return ay - by
            })
    }, [data])

    const fields = Object.keys(FIELD_LABEL)
    const imgSrc = data ? `data:image/jpeg;base64,${data.imageUsed}` : previewUrl

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Inspector OCR</h3>
                <p className="text-gray-500">
                    Subí el frente de una cédula y mirá lo que extrae el
                    pipeline REAL (modo Producción, por defecto): cajas + scores
                    de PaddleOCR, qué línea ancló cada campo y de dónde salió
                    cada dato (frente / ampliado / MRZ). Los modos Crudo y
                    Enderezado + ampliado son sólo para diagnóstico.
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            <Card className="mb-6">
                <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                    <div>
                        <div className="mb-2 text-sm font-semibold heading-text">
                            Imagen (frente de la cédula)
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                variant="default"
                                onClick={() => inputRef.current?.click()}
                            >
                                Elegir imagen
                            </Button>
                            <span className="max-w-[14rem] truncate text-xs text-gray-400">
                                {file ? file.name : 'Sin imagen'}
                            </span>
                            <input
                                ref={inputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) pickFile(f)
                                    e.target.value = ''
                                }}
                            />
                        </div>
                    </div>

                    {variant === 'production' && (
                        <div>
                            <div className="mb-2 text-sm font-semibold heading-text">
                                Dorso (opcional, para cross-fill MRZ)
                            </div>
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="default"
                                    onClick={() =>
                                        backInputRef.current?.click()
                                    }
                                >
                                    Elegir dorso
                                </Button>
                                <span className="max-w-[12rem] truncate text-xs text-gray-400">
                                    {backFile ? backFile.name : 'Sin dorso'}
                                </span>
                                <input
                                    ref={backInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0]
                                        if (f) setBackFile(f)
                                        e.target.value = ''
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <div>
                        <div className="mb-2 text-sm font-semibold heading-text">
                            Variante
                        </div>
                        <Segment
                            value={variant}
                            onChange={(val) =>
                                setVariant(val as OcrDebugVariant)
                            }
                        >
                            <Segment.Item value="production">
                                Producción
                            </Segment.Item>
                            <Segment.Item value="raw">Crudo</Segment.Item>
                            <Segment.Item value="deskew-upscale">
                                Enderezado + ampliado
                            </Segment.Item>
                            <Segment.Item value="enhanced">
                                Realzado (fondo)
                            </Segment.Item>
                        </Segment>
                        <p className="mt-2 max-w-xs text-xs text-gray-400">
                            {variant === 'production'
                                ? 'Lo que extrae el pipeline REAL: OCR del crudo + fallback ampliado + 3er tier realzado (si faltan campos) + cross-fill desde el MRZ del dorso. Normaliza cédulas rotadas 90°. Modo recomendado.'
                                : variant === 'raw'
                                  ? 'Diagnóstico: la imagen tal cual fue subida, sin fallback ni cross-fill.'
                                  : variant === 'enhanced'
                                    ? 'Diagnóstico: pre-proceso de FONDO DE SEGURIDAD (canal verde → blur → umbral adaptativo) para rescatar el texto sobre el watermark/guilloché. 3er tier del pipeline. Geometría preservada.'
                                    : 'Diagnóstico: doc-crop (endereza) + upscale a 1600px. Puede leer MENOS campos: el anclaje está tuneado al frame nativo.'}
                        </p>
                    </div>

                    <div className="flex justify-end">
                        <Button
                            variant="solid"
                            loading={running}
                            disabled={!file}
                            onClick={analyze}
                        >
                            Analizar
                        </Button>
                    </div>
                </div>
            </Card>

            {running && (
                <div className="flex h-40 items-center justify-center">
                    <Spinner size={40} />
                </div>
            )}

            {(data || previewUrl) && !running && (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                    {/* Panel principal: imagen + overlay de cajas. */}
                    <div className="lg:col-span-3">
                        <Card>
                            <div className="mb-3 flex items-center justify-between">
                                <h5>Imagen analizada</h5>
                                {data && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500">
                                            Mostrar todas las cajas
                                        </span>
                                        <Switcher
                                            checked={showAll}
                                            onChange={(val) => setShowAll(val)}
                                        />
                                    </div>
                                )}
                            </div>
                            <div className="relative inline-block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800">
                                {imgSrc ? (
                                    <>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={imgSrc}
                                            alt="Cédula analizada"
                                            className="block h-auto w-full"
                                        />
                                        {data && (
                                            <BoxOverlay
                                                data={data}
                                                showAll={showAll}
                                                highlight={highlight}
                                                hoveredLine={hoveredLine}
                                                onPickLine={setHoveredLine}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <div className="flex h-64 items-center justify-center text-xs text-gray-400">
                                        Sin imagen
                                    </div>
                                )}
                            </div>
                            {data && (
                                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                    <span>
                                        {data.width}×{data.height}px
                                    </span>
                                    <span>·</span>
                                    <span>{data.lines.length} líneas</span>
                                    <span>·</span>
                                    <span>
                                        confianza {fmtScore(data.confidence)}
                                    </span>
                                    <span className="ml-auto flex items-center gap-3">
                                        <LegendDot color="#10b981" label="≥0.9" />
                                        <LegendDot
                                            color="#f59e0b"
                                            label="0.6–0.9"
                                        />
                                        <LegendDot
                                            color="#ef4444"
                                            label="<0.6"
                                        />
                                    </span>
                                </div>
                            )}
                        </Card>
                    </div>

                    {/* Panel lateral: datos extraídos + líneas OCR crudas. */}
                    <div className="lg:col-span-2">
                        {data ? (
                            <>
                                <Card className="mb-6">
                                    <h5 className="mb-1">Datos extraídos</h5>
                                    <p className="mb-3 text-xs text-gray-400">
                                        Pasá el mouse por un campo para resaltar
                                        su ancla (verde) y su etiqueta (azul).
                                    </p>
                                    {!!data.angle && (
                                        <p className="mb-3 text-xs text-amber-600 dark:text-amber-300">
                                            Frente tratado como rotado{' '}
                                            {data.angle}° (texto vertical):
                                            enderezado antes de anclar.
                                        </p>
                                    )}
                                    <Table className="w-full text-sm">
                                        <TBody>
                                            {fields.map((f) => {
                                                const value = fieldValue(
                                                    data.extracted,
                                                    f,
                                                )
                                                const anchor = data.anchors[f]
                                                const empty = !value
                                                const src =
                                                    data.sources?.[
                                                        SOURCE_KEY[f] ?? f
                                                    ]
                                                return (
                                                    <Tr
                                                        key={f}
                                                        className="cursor-default border-b border-gray-100 last:border-0 hover:bg-emerald-50/60 dark:border-gray-700 dark:hover:bg-emerald-500/5"
                                                        onMouseEnter={() =>
                                                            highlightAnchor(
                                                                anchor,
                                                            )
                                                        }
                                                        onMouseLeave={() =>
                                                            highlightAnchor(
                                                                undefined,
                                                            )
                                                        }
                                                    >
                                                        <Td className="py-2 pr-4 text-gray-500">
                                                            {FIELD_LABEL[f]}
                                                        </Td>
                                                        <Td
                                                            className={`py-2 font-medium ${
                                                                empty
                                                                    ? 'text-red-500'
                                                                    : 'heading-text'
                                                            }`}
                                                        >
                                                            <span>
                                                                {empty
                                                                    ? 'vacío'
                                                                    : value}
                                                            </span>
                                                        </Td>
                                                        {/* Origen del dato (frente/ampliado/MRZ) en COLUMNA PROPIA: así al
                                                            copiar la fila el valor y el badge no se pegan ("ORUE SOSA" + "frente",
                                                            nunca "ORUESOSAfrente"). El pill es un Tag visualmente separado. */}
                                                        <Td className="py-2 pl-3">
                                                            {src && (
                                                                <Tag className="border-0 bg-sky-100 text-[10px] font-normal text-sky-700 dark:bg-sky-500/20 dark:text-sky-100">
                                                                    {
                                                                        SOURCE_LABEL[
                                                                            src
                                                                        ]
                                                                    }
                                                                </Tag>
                                                            )}
                                                        </Td>
                                                        <Td className="py-2 text-right">
                                                            {anchor ? (
                                                                <Tag className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100">
                                                                    L
                                                                    {
                                                                        anchor.lineIndex
                                                                    }
                                                                </Tag>
                                                            ) : (
                                                                <span className="text-xs text-gray-300">
                                                                    sin ancla
                                                                </span>
                                                            )}
                                                        </Td>
                                                    </Tr>
                                                )
                                            })}
                                        </TBody>
                                    </Table>
                                </Card>

                                <Card>
                                    <h5 className="mb-1">Líneas OCR crudas</h5>
                                    <p className="mb-3 text-xs text-gray-400">
                                        {data.lines.length} líneas (orden de
                                        lectura). Pasá el mouse para resaltar su
                                        caja.
                                    </p>
                                    <div className="max-h-[28rem] overflow-auto">
                                        <Table className="w-full text-sm">
                                            <TBody>
                                                {orderedLines.map(
                                                    ({ l, idx }) => (
                                                        <Tr
                                                            key={idx}
                                                            className={`cursor-default border-b border-gray-100 last:border-0 dark:border-gray-700 ${
                                                                hoveredLine ===
                                                                idx
                                                                    ? 'bg-emerald-50 dark:bg-emerald-500/10'
                                                                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                                                            }`}
                                                            onMouseEnter={() =>
                                                                setHoveredLine(
                                                                    idx,
                                                                )
                                                            }
                                                            onMouseLeave={() =>
                                                                setHoveredLine(
                                                                    null,
                                                                )
                                                            }
                                                        >
                                                            <Td className="py-1.5 pr-2 align-top font-mono text-xs text-gray-400">
                                                                {idx}
                                                            </Td>
                                                            <Td className="break-all py-1.5 pr-2 heading-text">
                                                                {l.text || (
                                                                    <span className="text-gray-300">
                                                                        (vacío)
                                                                    </span>
                                                                )}
                                                            </Td>
                                                            <Td className="py-1.5 text-right align-top">
                                                                <span
                                                                    className="font-mono text-xs"
                                                                    style={{
                                                                        color: scoreColor(
                                                                            l.score,
                                                                        ),
                                                                    }}
                                                                >
                                                                    {fmtScore(
                                                                        l.score,
                                                                    )}
                                                                </span>
                                                            </Td>
                                                        </Tr>
                                                    ),
                                                )}
                                            </TBody>
                                        </Table>
                                    </div>
                                </Card>
                            </>
                        ) : (
                            <Card>
                                <p className="text-sm text-gray-400">
                                    Pulsá “Analizar” para correr PaddleOCR sobre
                                    la imagen.
                                </p>
                            </Card>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <span className="flex items-center gap-1">
            <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: color }}
            />
            {label}
        </span>
    )
}

export default OcrDebugView
