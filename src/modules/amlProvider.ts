/**
 * Provider de AML externo — interfaz abstracta para screening AML/PEP
 * contra APIs externas (Sumsub, Onfido, Refinitiv, etc.).
 *
 * El provider LOCAL (aml.ts) sigue siendo el default. Cuando se configuran
 * las variables TEKO_AML_EXTERNAL_* se usa el provider externo en su lugar
 * (o en paralelo, si `aml.mode=hybrid`).
 *
 * Flujo:
 *   1. `aml.ts` extrae AmlInput del documento verificado.
 *   2. Si `TEKO_AML_EXTERNAL_API_KEY` está set, se usa ExternalAmlProvider.
 *   3. Si no, se usa el local (OpenSanctions).
 *   4. Si `aml.mode=hybrid`, se corre ambos y se combinan los resultados.
 */
import type { AmlInput, AmlResult, AmlEntity } from "../types";

/** Modo de operación del screening AML. */
export type AmlProviderMode = "local" | "external" | "hybrid";

/** Configuración del provider externo. */
export interface ExternalAmlConfig {
  /** URL base del endpoint de screening (p.ej. https://api.sumsub.com). */
  baseUrl: string;
  /** API key o token de autenticación. */
  apiKey: string;
  /** Nombre del proveedor (auditable, p.ej. "sumsub", "onfido"). */
  providerName: string;
  /** Umbral de similitud para potential_match (default 0.8). */
  threshold?: number;
  /** Timeout en ms (default 15000). */
  timeout?: number;
}

/**
 * Interfaz abstracta para providers externos de AML.
 * Implementar para cada proveedor (Sumsub, Onfido, etc.).
 */
export interface ExternalAmlProvider {
  /**
   * Ejecuta el screening contra el proveedor externo.
   * @param input Datos del titular extraídos del documento.
   * @param config Configuración del provider.
   */
  screen(input: AmlInput, config: ExternalAmlConfig): Promise<ExternalAmlResponse>;
}

/** Respuesta canónica de un provider externo. */
export interface ExternalAmlResponse {
  /** Hits encontrados, ordenados por relevancia. */
  hits: ExternalAmlHit[];
  /** Score del mejor hit (0 si no hay hits). */
  topScore: number;
  /** ¿Se detectó un match potencial? */
  potentialMatch: boolean;
}

/** Hit de un provider externo mapeado al formato interno. */
export interface ExternalAmlHit {
  entityId: string;
  name: string;
  lists: string[];
  score: number;
  matchedFields: string[];
  topics?: string[];
  countries?: string[];
}

/**
 * Provider default: usa HTTP genérico contra un endpoint REST de screening.
 * Implementación base que puede extenderse para proveedores específicos.
 */
export class HttpAmlProvider implements ExternalAmlProvider {
  async screen(input: AmlInput, config: ExternalAmlConfig): Promise<ExternalAmlResponse> {
    const url = `${config.baseUrl}/v1/screening`;
    const threshold = config.threshold ?? 0.8;
    const timeout = config.timeout ?? 15000;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    try {
      const payload = JSON.stringify({
        firstName: input.nombres || "",
        lastName: input.apellidos || "",
        dateOfBirth: input.fechaNac || null,
        nationality: input.nacionalidad || null,
        threshold,
      });

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: payload,
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return {
          hits: [],
          topScore: 0,
          potentialMatch: false,
        };
      }

      const data = await res.json() as Record<string, unknown>;
      const rawHits = Array.isArray(data?.hits) ? data.hits as Record<string, unknown>[] : [];

      const hits: ExternalAmlHit[] = rawHits.slice(0, 10).map((h) => ({
        entityId: String(h?.entityId || h?.id || ""),
        name: String(h?.name || ""),
        lists: Array.isArray(h?.lists) ? (h.lists as string[]).slice(0, 5) : [],
        score: typeof h?.score === "number" ? h.score : 0,
        matchedFields: Array.isArray(h?.matchedFields) ? (h.matchedFields as string[]).slice(0, 5) : [],
        topics: Array.isArray(h?.topics) ? (h.topics as string[]).slice(0, 5) : undefined,
        countries: Array.isArray(h?.countries) ? (h.countries as string[]).slice(0, 5) : undefined,
      }));

      const topScore = hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : 0;

      return {
        hits,
        topScore,
        potentialMatch: topScore >= threshold,
      };
    } catch {
      clearTimeout(timer);
      return {
        hits: [],
        topScore: 0,
        potentialMatch: false,
      };
    }
  }
}

/**
 * Resuelve el provider AML a usar según configuración.
 * @returns { provider, mode, config } o null si no hay externo configurado.
 */
export function resolveAmlProvider(): {
  provider: ExternalAmlProvider;
  mode: AmlProviderMode;
  config: ExternalAmlConfig;
} | null {
  const apiKey = process.env.TEKO_AML_EXTERNAL_API_KEY;
  const baseUrl = process.env.TEKO_AML_EXTERNAL_BASE_URL;
  const mode = (process.env.TEKO_AML_EXTERNAL_MODE || "external") as AmlProviderMode;
  const providerName = process.env.TEKO_AML_EXTERNAL_PROVIDER || "external";

  if (!apiKey || !baseUrl) return null;

  return {
    provider: new HttpAmlProvider(),
    mode: ["external", "hybrid"].includes(mode) ? mode : "external",
    config: {
      baseUrl,
      apiKey,
      providerName,
      threshold: parseFloat(process.env.TEKO_AML_EXTERNAL_THRESHOLD || "0.8"),
      timeout: parseInt(process.env.TEKO_AML_EXTERNAL_TIMEOUT || "15000", 10),
    },
  };
}

/**
 * Convierte una respuesta externa al formato AmlResult interno.
 */
export function toAmlResult(
  input: AmlInput,
  response: ExternalAmlResponse,
  config: ExternalAmlConfig
): AmlResult {
  const hits: AmlResult["hits"] = response.hits.map((h) => ({
    entityId: h.entityId,
    name: h.name,
    lists: h.lists,
    score: h.score,
    matchedFields: h.matchedFields,
    topics: h.topics,
    countries: h.countries,
  }));

  return {
    query: {
      nombres: input.nombres,
      apellidos: input.apellidos,
      fechaNac: input.fechaNac,
      nacionalidad: input.nacionalidad,
      normalized: `${input.apellidos} ${input.nombres}`.trim().toLowerCase(),
    },
    hits,
    topScore: response.topScore,
    decision: response.potentialMatch ? "potential_match" : "clear",
    threshold: config.threshold ?? 0.8,
    provider: config.providerName,
    passed: !response.potentialMatch,
  };
}
