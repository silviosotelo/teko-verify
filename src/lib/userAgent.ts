/**
 * Parser liviano de User-Agent (sin dependencias externas) — P0 #3.
 *
 * No pretende ser ua-parser-js: extrae lo justo para el timeline forense y el
 * Device & IP analysis (os, browser, tipo de dispositivo) + una señal de UA
 * "sospechoso" (headless/bot/herramienta automatizada). Heurístico y best-effort:
 * un UA desconocido devuelve campos null pero NUNCA lanza (fail-open en el caller).
 */

/** Tipo de dispositivo inferido del UA. */
export type DeviceType = "mobile" | "tablet" | "desktop" | "bot" | "unknown";

/** Resultado del parseo del User-Agent. */
export interface ParsedDevice {
  os: string | null;
  browser: string | null;
  type: DeviceType;
  /** UA reconocido como headless / automatizado / scraping (señal de riesgo). */
  suspicious: boolean;
  /** UA crudo (recortado) para trazabilidad. */
  raw: string | null;
}

/** Marcadores de automatización/headless: si aparecen, el UA es sospechoso. */
const SUSPICIOUS_MARKERS = [
  "headlesschrome",
  "phantomjs",
  "electron",
  "puppeteer",
  "playwright",
  "selenium",
  "webdriver",
  "python-requests",
  "curl/",
  "wget/",
  "httpclient",
  "okhttp",
  "go-http-client",
  "java/",
  "axios/",
  "node-fetch",
  "bot",
  "crawler",
  "spider",
  "scrapy",
];

function detectOs(ua: string): string | null {
  if (/windows nt 10/.test(ua)) return "Windows 10/11";
  if (/windows nt/.test(ua)) return "Windows";
  if (/android/.test(ua)) {
    const m = /android\s+([\d.]+)/.exec(ua);
    return m ? `Android ${m[1]}` : "Android";
  }
  // iOS antes que macOS: el iPad/iPhone UA contiene "like Mac OS X".
  if (/iphone|ipad|ipod/.test(ua)) {
    const m = /os\s+([\d_]+)/.exec(ua);
    return m ? `iOS ${m[1].replace(/_/g, ".")}` : "iOS";
  }
  if (/mac os x/.test(ua)) return "macOS";
  if (/cros/.test(ua)) return "ChromeOS";
  if (/linux/.test(ua)) return "Linux";
  return null;
}

function detectBrowser(ua: string): string | null {
  // Orden importa: Edge/Opera/Brave se anuncian como Chrome; chequearlos primero.
  if (/edg(a|ios|e)?\//.test(ua)) return "Edge";
  if (/opr\/|opera/.test(ua)) return "Opera";
  if (/samsungbrowser/.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/.test(ua)) return "Firefox";
  // CriOS = Chrome en iOS; Chrome real.
  if (/crios\//.test(ua)) return "Chrome";
  if (/chrome\//.test(ua)) return "Chrome";
  // Safari sólo si no matcheó ninguno de los anteriores (todos incluyen "safari").
  if (/safari\//.test(ua)) return "Safari";
  return null;
}

function detectType(ua: string, suspicious: boolean): DeviceType {
  if (suspicious && /bot|crawler|spider|scrapy/.test(ua)) return "bot";
  if (/ipad|tablet|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/.test(ua)) return "mobile";
  if (/windows nt|mac os x|cros|x11|linux/.test(ua)) return "desktop";
  return "unknown";
}

/**
 * Parsea un User-Agent a {os, browser, type, suspicious}. Best-effort y no-throw:
 * un UA vacío/desconocido devuelve type 'unknown' y campos null (no rompe nada).
 */
export function parseUserAgent(uaRaw: string | null | undefined): ParsedDevice {
  const raw = typeof uaRaw === "string" ? uaRaw.trim().slice(0, 512) : "";
  if (!raw) {
    // UA ausente ya es señal débil (un navegador siempre manda UA); lo marcamos
    // sospechoso para que la analítica lo pondere, pero sin tipo.
    return { os: null, browser: null, type: "unknown", suspicious: true, raw: null };
  }
  const ua = raw.toLowerCase();
  const suspicious = SUSPICIOUS_MARKERS.some((m) => ua.includes(m));
  return {
    os: detectOs(ua),
    browser: detectBrowser(ua),
    type: detectType(ua, suspicious),
    suspicious,
    raw,
  };
}
