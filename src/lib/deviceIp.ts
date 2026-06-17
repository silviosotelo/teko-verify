/**
 * Device & IP analysis (P0 #3) — lógica PURA, sin DB ni red.
 *
 * Dado el timeline de `session_events` de una sesión (cada uno con su ip/country/
 * device) + la nacionalidad del documento extraído, deriva SEÑALES DE RIESGO simples:
 *   * ip_changed                  → el IP cambió entre pasos del mismo flujo.
 *   * country_changed             → el país (CF-IPCountry) cambió entre pasos.
 *   * country_vs_nationality      → el país del IP ≠ nacionalidad del documento.
 *   * suspicious_user_agent       → UA headless/automatizado/ausente.
 *   * device_changed              → el SO/navegador cambió entre pasos (sesión partida).
 *
 * INFORMATIVO por diseño: estas señales NO rechazan la verificación (eso lo decide
 * el workflow/operador). Fail-CLOSED del lado seguridad: si no hay datos, no se
 * inventan señales (no se afirma "seguro"); simplemente no se emite la señal.
 *
 * Mapea ISO alpha-2 (CF-IPCountry, p.ej. "PY") contra nacionalidades de documentos
 * PY (texto OCR como "PARAGUAYA" / "REPÚBLICA DEL PARAGUAY"). El mapeo es acotado a
 * la región; un país sin mapeo NO dispara mismatch (fail-open: no falsos positivos).
 */
import type {
  DeviceIpAnalysis,
  ParsedDevice,
  RiskSeverity,
  RiskSignal,
  SessionEvent,
} from "../types";

const SEVERITY_WEIGHT: Record<RiskSeverity, number> = {
  info: 0,
  low: 10,
  medium: 25,
  high: 50,
};

/**
 * Nacionalidad/país (texto OCR del documento o nombre de país) → ISO alpha-2.
 * Acotado a la región del Cono Sur (donde opera Teko). Devuelve null si no mapea.
 */
function toAlpha2(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  // Coincidencias por substring (el OCR trae "PARAGUAYA", "REP. DEL PARAGUAY", etc.).
  const table: Array<[RegExp, string]> = [
    [/paragua/, "PY"],
    [/argentin/, "AR"],
    [/bras[il|íl]|brazil/, "BR"],
    [/urugua/, "UY"],
    [/bolivia/, "BO"],
    [/chile|chilen/, "CL"],
    [/peru|perú|peruan/, "PE"],
    [/colombia/, "CO"],
  ];
  for (const [re, code] of table) {
    if (re.test(v)) return code;
  }
  // Si ya viene como alpha-2 plausible.
  if (/^[a-z]{2}$/.test(v)) return v.toUpperCase();
  return null;
}

/** device en un evento puede venir como {} (default DDL): normaliza a ParsedDevice|null. */
function asDevice(d: SessionEvent["device"]): ParsedDevice | null {
  if (d && typeof d === "object" && "type" in d) return d as ParsedDevice;
  return null;
}

/** Etiqueta corta del device para detectar cambios (os|browser). */
function deviceKey(d: ParsedDevice | null): string | null {
  if (!d) return null;
  const k = `${d.os ?? "?"}|${d.browser ?? "?"}`;
  return k === "?|?" ? null : k;
}

/**
 * Analiza el timeline de una sesión. `events` se espera en orden cronológico
 * (ascendente) pero el análisis es orden-insensible salvo para "el más reciente".
 */
export function analyzeDeviceIp(
  events: SessionEvent[],
  opts: { documentNationality?: string | null } = {}
): DeviceIpAnalysis {
  // Orden cronológico ascendente garantizado (defensivo: re-ordena por createdAt).
  const ordered = [...events].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
  );

  const ips = unique(ordered.map((e) => e.ip).filter(isStr));
  const countries = unique(ordered.map((e) => e.country).filter(isStr));
  const deviceKeys = unique(ordered.map((e) => deviceKey(asDevice(e.device))).filter(isStr));

  // El "actual" = el del último evento con dato (lo que el operador ve arriba).
  const lastWithIp = [...ordered].reverse().find((e) => e.ip);
  const lastWithDevice = [...ordered].reverse().find((e) => asDevice(e.device));
  const ip = lastWithIp?.ip ?? null;
  const country = lastWithIp?.country ?? null;
  const userAgent = lastWithDevice?.userAgent ?? null;
  const device = lastWithDevice ? asDevice(lastWithDevice.device) : null;

  const signals: RiskSignal[] = [];

  if (ips.length > 1) {
    signals.push({
      code: "ip_changed",
      severity: "medium",
      detail: `El IP cambió durante el flujo: ${ips.join(" → ")}`,
    });
  }
  if (countries.length > 1) {
    signals.push({
      code: "country_changed",
      severity: "high",
      detail: `El país del IP cambió durante el flujo: ${countries.join(" → ")}`,
    });
  }
  if (deviceKeys.length > 1) {
    signals.push({
      code: "device_changed",
      severity: "medium",
      detail: `El dispositivo/navegador cambió durante el flujo (${deviceKeys.length} distintos)`,
    });
  }

  // País del IP vs nacionalidad del documento (sólo si ambos mapean a alpha-2).
  const docCc = toAlpha2(opts.documentNationality);
  if (docCc && country && docCc !== country) {
    signals.push({
      code: "country_vs_nationality_mismatch",
      severity: "low",
      detail: `País del IP (${country}) ≠ nacionalidad del documento (${docCc})`,
    });
  }

  // UA sospechoso/headless en cualquier paso (una sola señal, agregada).
  const suspicious = ordered.some((e) => asDevice(e.device)?.suspicious);
  if (suspicious) {
    signals.push({
      code: "suspicious_user_agent",
      severity: "high",
      detail: "Se detectó un User-Agent headless/automatizado o ausente",
    });
  }

  const riskScore = Math.min(
    100,
    signals.reduce((sum, s) => sum + SEVERITY_WEIGHT[s.severity], 0)
  );

  return { ip, country, userAgent, device, ips, countries, signals, riskScore };
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
function isStr(v: string | null): v is string {
  return typeof v === "string" && v.length > 0;
}
