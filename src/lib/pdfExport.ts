/**
 * Export de sesiones a PDF — módulo de reportes administrativos.
 * Genera un PDF con la evidencia de una sesión (selfie, doc_front, doc_back)
 * y los datos del resultado. Usa html2canvas + jsPDF vía un servidor headless
 * opcional; si no está disponible, devuelve HTML para renderizar en el front.
 *
 * Dependencias: html-pdf-node (opcional). Si no está instalada, se cae a
 * generar HTML plano con el enlace de las imágenes en base64.
 */
import type {
  VerificationSession,
  SessionResult,
  VerificationCheck,
  Evidence,
  Consent,
} from "../types";

export interface PdfExportParams {
  tenantId: string;
  session: VerificationSession;
  checks: VerificationCheck[];
  evidence: Evidence[];
  consents: Consent[];
  evidenceBase64: Array<{ type: string; data: string }>;
}

export interface PdfExportResult {
  /** Tipo MIME del resultado generado. */
  contentType: string;
  /** Buffer del PDF o HTML. */
  data: Buffer;
  /** Si se generó HTML (pdf no disponible). */
  fallback: boolean;
}

/** Genera un documento PDF para una sesión de verificación. */
export async function exportSessionPdf(params: PdfExportParams): Promise<PdfExportResult> {
  const { session, checks, evidence, consents, evidenceBase64 } = params;

  // Construye el HTML con la evidencia inline (base64) y los datos.
  const html = buildSessionHtml(session, checks, consents, evidenceBase64);

  // Intenta generar PDF con html-pdf-node (si está disponible).
  try {
    const pdfModule = await tryLoadPdfModule();
    if (pdfModule) {
      const pdf = await pdfModule.generatePdf({ html });
      return { contentType: "application/pdf", data: Buffer.from(pdf), fallback: false };
    }
  } catch {
    /* html-pdf-node no disponible → cae a HTML */
  }

  // Fallback: devuelve HTML con imágenes base64 para que el front lo renderice.
  return { contentType: "text/html", data: Buffer.from(html, "utf8"), fallback: true };
}

/** Intenta cargar html-pdf-node sin romper si no está instalado. */
async function tryLoadPdfModule(): Promise<{ generatePdf: (o: { html: string }) => Promise<Buffer> } | null> {
  try {
    const m = await import("html-pdf-node" as string);
    const gen = (m as unknown as { generatePdf: (o: { files: Array<{ html: string }> }) => Promise<string> }).generatePdf;
    if (!gen) return null;
    return { generatePdf: async (o) => Buffer.from(await gen({ files: [{ html: o.html }] }), "base64") };
  } catch {
    return null;
  }
}

/** Construye el HTML del reporte de sesión. */
function buildSessionHtml(
  session: VerificationSession,
  checks: VerificationCheck[],
  consents: Consent[],
  evidenceBase64: Array<{ type: string; data: string }>
): string {
  const esc = (s: string | null | undefined) => (typeof s === "string" ? s.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "");

  const evidenceRows = evidenceBase64
    .map((e) => `<tr><td style="font-weight:600;width:120px">${esc(e.type)}</td><td><img src="data:image/jpeg;base64,${e.data}" style="max-width:200px;border:1px solid #ddd;border-radius:4px" /></td></tr>`)
    .join("\n");

  const checksRows = checks
    .map((c) => `<tr><td>${esc(c.type)}</td><td>${c.passed ? "Pasa" : "No pasa"}</td><td>${c.score ?? "—"}</td></tr>`)
    .join("\n");

  const consentsRows = consents
    .map((c) => `<tr><td>Versión ${esc(c.version)}</td><td>${esc(c.acceptedAt)}</td><td>${esc(c.ip)}</td></tr>`)
    .join("\n");

  const result = session.result;
  const resultSection = result
    ? `<tr><td>Veredicto</td><td>${esc(result.decision)}</td></tr>
       <tr><td>LoA</td><td>${esc(result.loa)}</td></tr>
       <tr><td>Motivos</td><td>${(result.reasons || []).join(", ")}</td></tr>`
    : "<tr><td colspan='2'>Sin resultado aún</td></tr>";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
  body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1e293b}
  h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  table{border-collapse:collapse;width:100%;margin-bottom:16px}th,td{border:1px solid #e2e8f0;padding:6px 10px;text-align:left;font-size:13px}
  th{background:#f8fafc;font-weight:600}img{margin:4px 0}
  .meta{font-size:12px;color:#64748b}
</style></head><body>
<h1>Reporte de verificación</h1>
<p class="meta">Generado: ${new Date().toISOString()}</p>

<h2>Sesión</h2>
<table>
  <tr><td>ID</td><td>${esc(session.id)}</td></tr>
  <tr><td>Estado</td><td>${esc(session.state)}</td></tr>
  <tr><td>Ref externa</td><td>${esc(session.externalRef)}</td></tr>
  <tr><td>LoA requerido</td><td>${esc(session.assuranceRequired)}</td></tr>
  <tr><td>Tipo documento</td><td>${esc(session.documentType)}</td></tr>
  <tr><td>Creada</td><td>${esc(session.createdAt)}</td></tr>
  <tr><td>Completada</td><td>${esc(session.completedAt)}</td></tr>
  ${resultSection}
</table>

<h2>Checks</h2>
<table><tr><th>Tipo</th><th>Estado</th><th>Score</th></tr>${checksRows}</table>

<h2>Evidencia</h2>
<table><tr><th>Tipo</th><th>Imagen</th></tr>${evidenceRows || "<tr><td colspan='2'>Sin evidencia</td></tr>"}</table>

<h2>Consentimientos</h2>
<table><tr><th>Versión</th><th>Aceptado</th><th>IP</th></tr>${consentsRows || "<tr><td colspan='3'>Sin consentimientos</td></tr>"}</table>
</body></html>`;
}
