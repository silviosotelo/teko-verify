/**
 * White-label por tenant (P1 #5) — modelo + resolución + saneo.
 *
 * El branding vive en `tenants.branding` (JSONB). Es OPCIONAL por campo: lo que el
 * tenant no define cae al branding Teko por defecto (verde #16a34a). Así un tenant
 * SIN branding propio se ve exactamente como hoy (no se rompe nada existente).
 *
 *   - resolveBranding(): mezcla el branding del tenant sobre el default Teko →
 *     SIEMPRE devuelve valores concretos (el front no necesita conocer defaults).
 *   - sanitizeBranding(): valida/normaliza el input del admin (fail-closed: un color
 *     inválido se descarta y queda el default; strings capeadas; URLs validadas).
 *   - deriveThemeColors(): de un primaryColor hex deriva deep/subtle/mild para
 *     theme-ar el flujo de captura (espejo del @theme de web/src/index.css).
 */
import type { TenantBranding, ResolvedBranding } from "../types";

/** Verde Teko — el acento por defecto (idéntico a web/src/index.css @theme). */
export const TEKO_PRIMARY = "#16a34a";

/** displayName por defecto (el front muestra su wordmark "TEKO" cuando es éste). */
export const TEKO_DISPLAY_NAME = "Teko";

/** Branding Teko por defecto (todos los campos concretos). */
export const TEKO_DEFAULT_BRANDING: ResolvedBranding = {
  displayName: TEKO_DISPLAY_NAME,
  logoUrl: null,
  primaryColor: TEKO_PRIMARY,
  welcomeText: null,
  supportEmail: null,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** ¿`x` es un color hex #RRGGBB válido? */
export function isHexColor(x: unknown): x is string {
  return typeof x === "string" && HEX_RE.test(x.trim());
}

function clampStr(x: unknown, max: number): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t ? t.slice(0, max) : undefined;
}

/** Valida una URL/ruta de logo: http(s) absoluta o ruta on-prem que empieza con `/`. */
function sanitizeLogoUrl(x: unknown): string | undefined {
  const s = clampStr(x, 2048);
  if (!s) return undefined;
  if (s.startsWith("/")) return s; // ruta servida on-prem (/branding/:id/logo)
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return s;
  } catch {
    /* no es URL absoluta */
  }
  return undefined; // fail-closed: ni ruta on-prem ni http(s) → se descarta
}

function sanitizeEmail(x: unknown): string | undefined {
  const s = clampStr(x, 254);
  if (!s) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : undefined;
}

/**
 * Sanea el branding entrante (admin) a un parcial limpio listo para persistir.
 * Fail-closed por campo: un valor inválido se OMITE (no rompe el guardado ni pisa el
 * default con basura). Devuelve solo los campos válidos presentes.
 */
export function sanitizeBranding(input: unknown): TenantBranding {
  if (!input || typeof input !== "object") return {};
  const r = input as Record<string, unknown>;
  const out: TenantBranding = {};
  const displayName = clampStr(r.displayName, 60);
  if (displayName !== undefined) out.displayName = displayName;
  const logoUrl = sanitizeLogoUrl(r.logoUrl);
  if (logoUrl !== undefined) out.logoUrl = logoUrl;
  if (isHexColor(r.primaryColor)) out.primaryColor = (r.primaryColor as string).trim().toLowerCase();
  const welcomeText = clampStr(r.welcomeText, 280);
  if (welcomeText !== undefined) out.welcomeText = welcomeText;
  const supportEmail = sanitizeEmail(r.supportEmail);
  if (supportEmail !== undefined) out.supportEmail = supportEmail;
  return out;
}

/**
 * Resuelve el branding efectivo: el branding del tenant sobre el default Teko.
 * SIEMPRE devuelve valores concretos. Un primaryColor inválido cae al verde Teko
 * (fail-closed). logoUrl/welcomeText/supportEmail ausentes ⇒ null.
 */
export function resolveBranding(branding?: TenantBranding | null): ResolvedBranding {
  const b = branding ?? {};
  const displayName = clampStr(b.displayName, 60) ?? TEKO_DEFAULT_BRANDING.displayName;
  const logoUrl = sanitizeLogoUrl(b.logoUrl) ?? null;
  const primaryColor = isHexColor(b.primaryColor)
    ? (b.primaryColor as string).trim().toLowerCase()
    : TEKO_DEFAULT_BRANDING.primaryColor;
  const welcomeText = clampStr(b.welcomeText, 280) ?? null;
  const supportEmail = sanitizeEmail(b.supportEmail) ?? null;
  return { displayName, logoUrl, primaryColor, welcomeText, supportEmail };
}

// ---- Derivación de colores del tema (espejo de @theme de la SPA de captura) --- //

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(n: number): string {
  return clamp255(n).toString(16).padStart(2, "0");
}

/** Parsea #RRGGBB → [r,g,b]. Asume hex válido (el caller ya validó). */
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Mezcla el color hacia blanco (`t`=0 sin cambio, 1 blanco puro). */
function lighten(hex: string, t: number): string {
  const [r, g, b] = parseHex(hex);
  return `#${toHex(r + (255 - r) * t)}${toHex(g + (255 - g) * t)}${toHex(b + (255 - b) * t)}`;
}

/** Mezcla el color hacia negro (`t`=0 sin cambio, 1 negro puro). */
function darken(hex: string, t: number): string {
  const [r, g, b] = parseHex(hex);
  return `#${toHex(r * (1 - t))}${toHex(g * (1 - t))}${toHex(b * (1 - t))}`;
}

export interface ThemeColors {
  primary: string;
  primaryDeep: string;
  primaryMild: string;
  primarySubtle: string;
}

/**
 * Deriva la paleta del tema desde el primaryColor (deep para hover, subtle para
 * fondos suaves, mild intermedio). Si el hex es inválido cae al verde Teko.
 */
export function deriveThemeColors(primaryColor?: string | null): ThemeColors {
  const primary = isHexColor(primaryColor) ? (primaryColor as string).trim().toLowerCase() : TEKO_PRIMARY;
  return {
    primary,
    primaryDeep: darken(primary, 0.15),
    primaryMild: lighten(primary, 0.25),
    primarySubtle: lighten(primary, 0.86),
  };
}
