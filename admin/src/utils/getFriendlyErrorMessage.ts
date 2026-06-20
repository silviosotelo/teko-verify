import axios from 'axios'

// Mapea cualquier error (AxiosError de ecme, ApiError del cliente Teko fetch,
// TypeError de red, Error genérico) a un mensaje legible en español. NUNCA debe
// devolver "AxiosError: ...", "Request failed with status code 401", ni un
// objeto/código crudo del backend.

const DEFAULT_FALLBACK = 'Ocurrió un error inesperado. Intentá de nuevo.'
const NETWORK_MESSAGE =
    'No se pudo conectar con el servidor. Intentá de nuevo.'

// Texto por status HTTP cuando el backend no manda un mensaje humano.
const STATUS_MESSAGES: Record<number, string> = {
    400: 'La solicitud no es válida. Revisá los datos e intentá de nuevo.',
    401: 'No autorizado. Iniciá sesión nuevamente.',
    403: 'No tenés permisos para realizar esta acción.',
    404: 'No se encontró el recurso solicitado.',
    408: 'La solicitud tardó demasiado. Intentá de nuevo.',
    409: 'Hay un conflicto con el estado actual del recurso.',
    413: 'El archivo o la solicitud es demasiado grande.',
    422: 'Algunos datos no son válidos. Revisalos e intentá de nuevo.',
    429: 'Demasiados intentos. Esperá un momento e intentá de nuevo.',
    500: 'Ocurrió un error en el servidor. Intentá de nuevo más tarde.',
    502: 'El servidor no está disponible. Intentá de nuevo más tarde.',
    503: 'El servicio no está disponible. Intentá de nuevo más tarde.',
    504: 'El servidor tardó demasiado en responder. Intentá de nuevo.',
}

// Códigos de error conocidos del backend Teko (snake_case) → texto amigable.
const CODE_MESSAGES: Record<string, string> = {
    invalid_credentials: 'Usuario o contraseña incorrectos.',
    unauthorized: 'Tu sesión expiró. Iniciá sesión nuevamente.',
    forbidden: 'No tenés permisos para realizar esta acción.',
    not_found: 'No se encontró el recurso solicitado.',
    rate_limited: 'Demasiados intentos. Esperá un momento e intentá de nuevo.',
    validation_error: 'Algunos datos no son válidos. Revisalos e intentá de nuevo.',
}

// Devuelve un texto humano del cuerpo de la respuesta SOLO si parece un mensaje
// para mostrar (no un código snake_case, no HTML, no JSON gigante).
function humanFromBody(data: unknown): string | null {
    let candidate: unknown = null
    if (typeof data === 'string') {
        candidate = data
    } else if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>
        candidate = d.message ?? d.error ?? d.detail ?? d.title
    }
    if (typeof candidate !== 'string') return null
    const text = candidate.trim()
    if (!text || text.length > 200) return null
    if (text.includes('<')) return null // probable HTML
    // Código conocido → traducción amigable.
    if (CODE_MESSAGES[text]) return CODE_MESSAGES[text]
    // snake_case / SCREAMING_CASE sin espacios → es un código, no texto humano.
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(text) && !text.includes(' ')) return null
    return text
}

export type FriendlyErrorOptions = {
    /** Texto a usar si no se puede derivar nada mejor. */
    fallback?: string
    /** Sobrescribe el texto para status puntuales (ej. login: 401 → credenciales). */
    statusOverrides?: Record<number, string>
}

export function getFriendlyErrorMessage(
    error: unknown,
    opts?: FriendlyErrorOptions,
): string {
    const fallback = opts?.fallback ?? DEFAULT_FALLBACK
    const overrides = opts?.statusOverrides ?? {}

    // 1) AxiosError (flujo de ecme: login, etc.)
    if (axios.isAxiosError(error)) {
        const status = error.response?.status
        if (status == null) {
            // Sin respuesta → red caída, CORS o timeout.
            return NETWORK_MESSAGE
        }
        if (overrides[status]) return overrides[status]
        return (
            humanFromBody(error.response?.data) ??
            STATUS_MESSAGES[status] ??
            fallback
        )
    }

    // 2) ApiError del cliente Teko (fetch) u otro Error con `status` numérico.
    const status = (error as { status?: unknown } | null)?.status
    if (typeof status === 'number') {
        if (overrides[status]) return overrides[status]
        const msg = (error as Error)?.message
        const fromMsg =
            typeof msg === 'string'
                ? CODE_MESSAGES[msg.trim()] ??
                  (/^Error \d+$/.test(msg.trim()) ? null : humanFromBody(msg))
                : null
        return fromMsg ?? STATUS_MESSAGES[status] ?? fallback
    }

    // 3) TypeError de fetch ("Failed to fetch") → red.
    if (error instanceof TypeError) return NETWORK_MESSAGE

    // 4) Error genérico: usar su mensaje si es legible (no AxiosError crudo).
    if (error instanceof Error && error.message) {
        const m = error.message.trim()
        if (m && !/^AxiosError/i.test(m) && !m.includes('status code')) {
            return CODE_MESSAGES[m] ?? m
        }
    }

    return fallback
}

export default getFriendlyErrorMessage
