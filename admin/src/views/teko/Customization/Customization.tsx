import { useEffect, useRef, useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Alert from '@/components/ui/Alert'
import Spinner from '@/components/ui/Spinner'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import type { TenantBranding } from '@/teko/types'

/**
 * Customization (white-label P1 #5): edita el branding del tenant seleccionado
 * (logo, color primario, nombre, textos) con PREVIEW EN VIVO de la pantalla de
 * captura. Sin branding propio → verde Teko + wordmark (default, no rompe nada).
 */

const TEKO_PRIMARY = '#16a34a'
const HEX_RE = /^#[0-9a-fA-F]{6}$/

function isHex(x: string): boolean {
    return HEX_RE.test(x.trim())
}
function parseHex(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
    ]
}
function toHex(n: number): string {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}
function lighten(hex: string, t: number): string {
    const [r, g, b] = parseHex(hex)
    return `#${toHex(r + (255 - r) * t)}${toHex(g + (255 - g) * t)}${toHex(b + (255 - b) * t)}`
}
function darken(hex: string, t: number): string {
    const [r, g, b] = parseHex(hex)
    return `#${toHex(r * (1 - t))}${toHex(g * (1 - t))}${toHex(b * (1 - t))}`
}

const Field = ({
    label,
    hint,
    children,
}: {
    label: string
    hint?: string
    children: React.ReactNode
}) => (
    <div>
        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
            {label}
        </label>
        {children}
        {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
)

// ---- Preview en vivo de la pantalla de captura --------------------------- //
function CapturePreview({
    displayName,
    logoUrl,
    primaryColor,
    welcomeText,
}: {
    displayName: string
    logoUrl: string | null
    primaryColor: string
    welcomeText: string | null
}) {
    const primary = isHex(primaryColor) ? primaryColor : TEKO_PRIMARY
    const subtle = lighten(primary, 0.86)
    const isTeko = !logoUrl && (!displayName || displayName === 'Teko')
    const initial = (displayName || '?').trim().charAt(0).toUpperCase()

    return (
        <div
            className="rounded-3xl p-5"
            style={{
                background:
                    'radial-gradient(600px 300px at 50% -10%, #d1fae5 0%, transparent 55%), linear-gradient(180deg,#f8fafc 0%,#ffffff 60%)',
            }}
        >
            {/* Header / marca */}
            <div className="mb-4 flex items-center gap-2.5">
                {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={logoUrl}
                        alt={displayName}
                        className="size-10 rounded-2xl object-contain shadow"
                    />
                ) : (
                    <span
                        className="flex size-10 items-center justify-center rounded-2xl text-lg font-black text-white shadow"
                        style={{ background: primary }}
                    >
                        {isTeko ? 'T' : initial}
                    </span>
                )}
                <div className="leading-tight">
                    <div className="text-lg font-extrabold tracking-tight text-gray-900">
                        {isTeko ? (
                            <>
                                T<span style={{ color: primary }}>E</span>KO
                            </>
                        ) : (
                            displayName
                        )}
                    </div>
                    <div className="-mt-0.5 text-[11px] text-gray-400">
                        identidad verificada
                    </div>
                </div>
            </div>

            {/* Tarjeta */}
            <div className="rounded-2xl bg-white p-5 shadow-xl ring-1 ring-gray-100">
                <div
                    className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl"
                    style={{ background: subtle, color: primary }}
                >
                    <svg
                        viewBox="0 0 24 24"
                        className="size-8"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path d="M9 12l2 2 4-4" />
                        <circle cx="12" cy="12" r="9" />
                    </svg>
                </div>
                <h1 className="text-center text-lg font-bold text-gray-900">
                    Verificá tu identidad
                </h1>
                <p className="mx-auto mt-1.5 max-w-xs text-center text-xs leading-relaxed text-gray-500">
                    {welcomeText ||
                        'Para confirmar que sos vos vamos a necesitar tu documento y una selfie. Toma 2 a 3 minutos.'}
                </p>
                <button
                    type="button"
                    className="mt-5 w-full rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-lg"
                    style={{ background: primary }}
                    onMouseOver={(e) =>
                        (e.currentTarget.style.background = darken(primary, 0.15))
                    }
                    onMouseOut={(e) =>
                        (e.currentTarget.style.background = primary)
                    }
                >
                    Continuar
                </button>
            </div>
        </div>
    )
}

const CustomizationView = () => {
    const { current, currentId, loading, reload } = useTenant()
    const [displayName, setDisplayName] = useState('')
    const [primaryColor, setPrimaryColor] = useState(TEKO_PRIMARY)
    const [logoUrl, setLogoUrl] = useState<string | null>(null)
    const [welcomeText, setWelcomeText] = useState('')
    const [supportEmail, setSupportEmail] = useState('')
    const [busy, setBusy] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    // Carga el branding del tenant seleccionado en el formulario.
    useEffect(() => {
        const b: TenantBranding = current?.branding ?? {}
        setDisplayName(b.displayName ?? '')
        setPrimaryColor(b.primaryColor && isHex(b.primaryColor) ? b.primaryColor : TEKO_PRIMARY)
        setLogoUrl(b.logoUrl ?? null)
        setWelcomeText(b.welcomeText ?? '')
        setSupportEmail(b.supportEmail ?? '')
        setSaved(false)
        setError(null)
    }, [currentId, current])

    async function onUploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file || !currentId) return
        setUploading(true)
        setError(null)
        try {
            const { logoUrl } = await tekoApi.uploadBrandingLogo(currentId, file)
            // Cache-bust ya viene en el ?v=… del backend.
            setLogoUrl(logoUrl)
            await reload()
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setUploading(false)
            if (fileRef.current) fileRef.current.value = ''
        }
    }

    async function onSave() {
        if (!currentId) return
        if (primaryColor && !isHex(primaryColor)) {
            setError('El color primario debe ser un hex válido (#RRGGBB).')
            return
        }
        setBusy(true)
        setError(null)
        setSaved(false)
        try {
            // Enviamos strings vacías como "" — el backend las omite (fail-closed),
            // de modo que vaciar un campo lo deja caer al default Teko.
            const branding: TenantBranding = {
                displayName,
                primaryColor,
                welcomeText,
                supportEmail,
                ...(logoUrl ? { logoUrl } : {}),
            }
            await tekoApi.updateTenant(currentId, { branding })
            await reload()
            setSaved(true)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setBusy(false)
        }
    }

    function resetToTeko() {
        setDisplayName('')
        setPrimaryColor(TEKO_PRIMARY)
        setLogoUrl(null)
        setWelcomeText('')
        setSupportEmail('')
    }

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Customization</h3>
                <p className="text-gray-500">
                    Marca propia del tenant{current ? ` · ${current.name}` : ''} —
                    logo, color, nombre y textos del flujo de verificación.
                </p>
            </div>

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}
            {saved && (
                <Alert showIcon className="mb-4" type="success">
                    Branding guardado. Las nuevas sesiones de este tenant ya usan
                    esta marca.
                </Alert>
            )}

            {loading ? (
                <div className="flex h-40 items-center justify-center">
                    <Spinner size={40} />
                </div>
            ) : !current ? (
                <Card>
                    <div className="py-12 text-center text-sm text-gray-400">
                        Seleccioná un tenant en el header.
                    </div>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {/* Formulario */}
                    <Card>
                        <h5 className="mb-4">Branding</h5>
                        <div className="space-y-4">
                            <Field label="Nombre mostrado" hint="Reemplaza el wordmark TEKO en el header.">
                                <Input
                                    value={displayName}
                                    placeholder="Teko"
                                    onChange={(e) => setDisplayName(e.target.value)}
                                />
                            </Field>

                            <Field label="Color primario" hint="Theme-a botones, acentos y la barra de progreso.">
                                <div className="flex items-center gap-3">
                                    {/* Ecme no provee color picker; input nativo intencional. El hex editable usa <Input> abajo. */}
                                    <input
                                        type="color"
                                        value={isHex(primaryColor) ? primaryColor : TEKO_PRIMARY}
                                        onChange={(e) => setPrimaryColor(e.target.value)}
                                        className="h-10 w-14 cursor-pointer rounded-lg border border-gray-200 bg-white p-1"
                                    />
                                    <Input
                                        value={primaryColor}
                                        placeholder="#16a34a"
                                        onChange={(e) => setPrimaryColor(e.target.value)}
                                        className="font-mono"
                                    />
                                </div>
                            </Field>

                            <Field label="Logo" hint="PNG/JPG ≤ 2 MB. Se sirve on-prem. Vacío = wordmark Teko.">
                                <div className="flex items-center gap-3">
                                    {logoUrl && (
                                        <img
                                            src={logoUrl}
                                            alt="logo"
                                            className="size-12 rounded-xl object-contain ring-1 ring-gray-200"
                                        />
                                    )}
                                    <Button
                                        size="sm"
                                        variant="default"
                                        disabled={uploading}
                                        onClick={() => fileRef.current?.click()}
                                    >
                                        {logoUrl ? 'Cambiar logo' : 'Subir logo'}
                                    </Button>
                                    {/* input file oculto disparado por el Button Ecme; conserva onUploadLogo */}
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={onUploadLogo}
                                        className="hidden"
                                    />
                                    {uploading && <Spinner size={20} />}
                                    {logoUrl && (
                                        <Button
                                            size="xs"
                                            variant="plain"
                                            onClick={() => setLogoUrl(null)}
                                        >
                                            Quitar
                                        </Button>
                                    )}
                                </div>
                            </Field>

                            <Field label="Texto de bienvenida" hint="Opcional — reemplaza el subtítulo de la intro.">
                                <Input
                                    textArea
                                    rows={3}
                                    maxLength={280}
                                    value={welcomeText}
                                    onChange={(e) => setWelcomeText(e.target.value)}
                                />
                            </Field>

                            <Field label="Email de soporte" hint="Opcional.">
                                <Input
                                    type="email"
                                    value={supportEmail}
                                    placeholder="soporte@empresa.com"
                                    onChange={(e) => setSupportEmail(e.target.value)}
                                />
                            </Field>

                            <div className="flex items-center justify-between pt-2">
                                <Button
                                    variant="plain"
                                    size="sm"
                                    onClick={resetToTeko}
                                >
                                    Restablecer a Teko
                                </Button>
                                <Button
                                    variant="solid"
                                    loading={busy}
                                    onClick={onSave}
                                >
                                    Guardar
                                </Button>
                            </div>
                        </div>
                    </Card>

                    {/* Preview */}
                    <Card>
                        <h5 className="mb-4">Vista previa de la captura</h5>
                        <CapturePreview
                            displayName={displayName}
                            logoUrl={logoUrl}
                            primaryColor={primaryColor}
                            welcomeText={welcomeText || null}
                        />
                    </Card>
                </div>
            )}
        </div>
    )
}

export default CustomizationView
