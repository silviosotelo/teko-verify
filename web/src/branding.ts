/**
 * White-label en el flujo de captura (P1 #5). El backend (GET /status) devuelve el
 * branding YA resuelto (default Teko aplicado). Acá:
 *   - applyTheme(primaryColor): pisa las CSS vars del @theme de Tailwind v4
 *     (--color-primary y derivadas) en :root → TODA utilidad bg-primary/text-primary
 *     /ring-primary se re-tinta sin tocar componentes. Fallback: verde Teko.
 *   - DEFAULT_BRANDING: el branding Teko (cuando aún no cargó /status).
 */

export interface Branding {
  displayName: string
  logoUrl: string | null
  primaryColor: string
  welcomeText: string | null
  supportEmail: string | null
}

export const TEKO_PRIMARY = "#16a34a"
export const TEKO_DISPLAY_NAME = "Teko"

export const DEFAULT_BRANDING: Branding = {
  displayName: TEKO_DISPLAY_NAME,
  logoUrl: null,
  primaryColor: TEKO_PRIMARY,
  welcomeText: null,
  supportEmail: null,
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}
function toHex(n: number): string {
  return clamp255(n).toString(16).padStart(2, "0")
}
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function lighten(hex: string, t: number): string {
  const [r, g, b] = parseHex(hex)
  return `#${toHex(r + (255 - r) * t)}${toHex(g + (255 - g) * t)}${toHex(b + (255 - b) * t)}`
}
function darken(hex: string, t: number): string {
  const [r, g, b] = parseHex(hex)
  return `#${toHex(r * (1 - t))}${toHex(g * (1 - t))}${toHex(b * (1 - t))}`
}

/** ¿`x` es #RRGGBB válido? */
export function isHexColor(x: unknown): x is string {
  return typeof x === "string" && HEX_RE.test(x.trim())
}

/**
 * Aplica el color primario al tema (CSS vars en :root). Fail-closed: un color
 * inválido cae al verde Teko, así nunca dejamos el tema en un estado roto.
 */
export function applyTheme(primaryColor?: string | null): void {
  const primary = isHexColor(primaryColor) ? primaryColor.trim().toLowerCase() : TEKO_PRIMARY
  const root = document.documentElement.style
  root.setProperty("--color-primary", primary)
  root.setProperty("--color-primary-deep", darken(primary, 0.15))
  root.setProperty("--color-primary-mild", lighten(primary, 0.25))
  root.setProperty("--color-primary-subtle", lighten(primary, 0.86))
}

/** Normaliza el branding crudo de /status a un objeto concreto (con defaults). */
export function normalizeBranding(b?: Partial<Branding> | null): Branding {
  if (!b) return DEFAULT_BRANDING
  return {
    displayName: b.displayName || DEFAULT_BRANDING.displayName,
    logoUrl: b.logoUrl ?? null,
    primaryColor: isHexColor(b.primaryColor) ? (b.primaryColor as string) : TEKO_PRIMARY,
    welcomeText: b.welcomeText ?? null,
    supportEmail: b.supportEmail ?? null,
  }
}
