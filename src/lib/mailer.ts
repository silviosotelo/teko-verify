/**
 * Mailer transaccional de Teko Verify — envío del link de verificación por email
 * nativo (SMTP Office365, reusado del puente api-odb).
 *
 * Reglas:
 *   - FAIL-OPEN: el envío de email es transaccional, NUNCA crítico. Si el SMTP no
 *     está configurado, el email destino es inválido, o el envío falla, se REGISTRA
 *     y se sigue (devuelve false). Jamás rompe la creación de la sesión ni el
 *     pipeline de verificación. (Contrasta con webhook.ts, que es fail-closed.)
 *   - SANEO DE ENV: el `.env` de origen (api-odb) tiene CRLF; los valores se
 *     saneanan (quita `\r`, espacios y comillas envolventes) — un envío real ya
 *     falló por EBADNAME a causa de un `\r` colado en SMTP_HOST.
 *   - Config leída perezosamente (no a nivel de módulo) para que sea testeable y
 *     para que el contenedor pueda arrancar sin SMTP.
 *   - Templates: spec §17 — los templates de email se leen de `tenants.email_templates`
 *     (JSONB) y se interpolan con variables antes de enviar.
 */
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sanea un valor de variable de entorno: quita CR (`\r` de archivos CRLF),
 * espacios envolventes y comillas simples/dobles envolventes. Idempotente.
 */
export function sanitizeEnvValue(value: string | undefined): string {
  if (!value) return "";
  return value
    .replace(/\r/g, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

/**
 * Lee y sanea la configuración SMTP del entorno. Devuelve null si falta lo
 * imprescindible (host/user/password) → el mailer queda "no configurado".
 */
export function loadSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const host = sanitizeEnvValue(env.SMTP_HOST);
  const user = sanitizeEnvValue(env.SMTP_USER);
  const password = sanitizeEnvValue(env.SMTP_PASSWORD);
  if (!host || !user || !password) return null;

  const portRaw = sanitizeEnvValue(env.SMTP_PORT);
  const port = portRaw ? parseInt(portRaw, 10) : 587;
  const secure = sanitizeEnvValue(env.SMTP_SECURE).toLowerCase() === "true";
  const fromEmail = sanitizeEnvValue(env.SMTP_FROM_EMAIL) || user;
  const fromName = sanitizeEnvValue(env.SMTP_FROM_NAME) || "Teko Verify";
  return { host, port: Number.isFinite(port) ? port : 587, secure, user, password, fromEmail, fromName };
}

/** ¿Hay SMTP configurado (host+user+password)? */
export function isMailerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return loadSmtpConfig(env) !== null;
}

/** Validación de formato de email (conservadora; cap RFC 5321 de 254 chars). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const e = email.trim();
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}

// Transporter cacheado por configuración (evita reabrir el pool SMTP en cada envío).
let cachedTransporter: Transporter | null = null;
let cachedKey = "";

function getTransporter(cfg: SmtpConfig): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.secure}:${cfg.user}`;
  if (cachedTransporter && cachedKey === key) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure, // false en 587 (STARTTLS), true en 465
    auth: { user: cfg.user, pass: cfg.password },
  });
  cachedKey = key;
  return cachedTransporter;
}

/** Escapa texto para interpolarlo seguro en el HTML del email. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Interpola variables en un template de email.
 * Reemplaza `{variable}` con el valor correspondiente del map.
 */
export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), escapeHtml(value));
  }
  return result;
}

/** Cuerpo HTML del email de verificación — estilo Teko (verde), en español. */
export function renderVerificationHtml(verifyUrl: string): string {
  const url = escapeHtml(verifyUrl);
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:#059669;padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.3px;">Teko Verify</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Verificá tu identidad</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">
            Recibiste una solicitud para verificar tu identidad de forma segura. El proceso
            toma un par de minutos: vas a sacarte una selfie y fotografiar tu cédula.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr><td align="center" style="border-radius:8px;background:#059669;">
              <a href="${url}" target="_blank"
                 style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
                Verificar mi identidad
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
            Si el botón no funciona, copiá y pegá este enlace en tu navegador:
          </p>
          <p style="margin:0 0 24px;font-size:13px;word-break:break-all;">
            <a href="${url}" target="_blank" style="color:#059669;">${url}</a>
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 16px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
            El enlace es personal y expira en pocos minutos. Tus datos se tratan conforme a la
            Ley N.º 7593 de Protección de Datos Personales del Paraguay. Si no solicitaste esta
            verificación, podés ignorar este mensaje.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Versión texto plano (fallback para clientes sin HTML). */
function renderVerificationText(verifyUrl: string): string {
  return [
    "Teko Verify — Verificá tu identidad",
    "",
    "Recibiste una solicitud para verificar tu identidad de forma segura.",
    "Abrí el siguiente enlace para comenzar (selfie + foto de tu cédula):",
    "",
    verifyUrl,
    "",
    "El enlace es personal y expira en pocos minutos. Tus datos se tratan conforme a la",
    "Ley N.º 7593 de Protección de Datos Personales del Paraguay. Si no solicitaste esta",
    "verificación, podés ignorar este mensaje.",
  ].join("\n");
}

/**
 * Envía el link de verificación a `to`. FAIL-OPEN: devuelve true sólo si el SMTP
 * aceptó el mensaje; ante cualquier problema (sin config / email inválido / error
 * de envío) registra y devuelve false SIN lanzar.
 */
export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<boolean> {
  const cfg = loadSmtpConfig();
  if (!cfg) {
    // eslint-disable-next-line no-console
    console.warn("[mailer] SMTP no configurado: se omite el envío del link (fail-open)");
    return false;
  }
  if (!isValidEmail(to)) {
    // eslint-disable-next-line no-console
    console.warn("[mailer] email destino inválido: se omite el envío");
    return false;
  }
  try {
    const transporter = getTransporter(cfg);
    const info = await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to: to.trim(),
      subject: "Verificá tu identidad — Teko Verify",
      text: renderVerificationText(verifyUrl),
      html: renderVerificationHtml(verifyUrl),
    });
    // eslint-disable-next-line no-console
    console.log(`[mailer] link de verificación enviado a ${to.trim()} (messageId=${info.messageId})`);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[mailer] fallo al enviar a ${to.trim()}: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Envía un email genérico con template personalizado.
 * Los templates se leen de `tenants.email_templates` (JSONB).
 * @param to Destinatario.
 * @param template Subject + body HTML con variables tipo `{verifyUrl}`.
 * @param vars Mapa de variables a interpolar.
 * @param cfg Config SMTP (usa la default si no se provee).
 */
export async function sendTemplatedEmail(
  to: string,
  template: { subject: string; html: string; text?: string },
  vars: Record<string, string>,
  cfg?: SmtpConfig
): Promise<boolean> {
  const smtpCfg = cfg || loadSmtpConfig();
  if (!smtpCfg) {
    // eslint-disable-next-line no-console
    console.warn("[mailer] SMTP no configurado: se omite el envío con template (fail-open)");
    return false;
  }
  if (!isValidEmail(to)) {
    // eslint-disable-next-line no-console
    console.warn("[mailer] email destino inválido: se omite el envío con template");
    return false;
  }
  try {
    const transporter = getTransporter(smtpCfg);
    const info = await transporter.sendMail({
      from: `"${smtpCfg.fromName}" <${smtpCfg.fromEmail}>`,
      to: to.trim(),
      subject: interpolateTemplate(template.subject, vars),
      text: template.text
        ? interpolateTemplate(template.text, vars)
        : "(sin versión texto plano)",
      html: interpolateTemplate(template.html, vars),
    });
    // eslint-disable-next-line no-console
    console.log(`[mailer] email template enviado a ${to.trim()} (messageId=${info.messageId})`);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[mailer] fallo al enviar template a ${to.trim()}: ${(e as Error).message}`);
    return false;
  }
}
