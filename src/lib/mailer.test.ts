/**
 * Tests de lib/mailer.ts — saneo de env, detección de config y no-op fail-open.
 *
 * NO toca la red ni un SMTP real: prueba la lógica PURA (sanitización, validación
 * de email, lectura de config) y que sendVerificationEmail sea no-op (devuelve
 * false, sin lanzar) cuando NO hay SMTP configurado.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeEnvValue,
  loadSmtpConfig,
  isMailerConfigured,
  isValidEmail,
  renderVerificationHtml,
  sendVerificationEmail,
} from "./mailer";

describe("sanitizeEnvValue", () => {
  it("quita CR (archivos CRLF), espacios y comillas envolventes", () => {
    expect(sanitizeEnvValue("smtp.office365.com\r")).toBe("smtp.office365.com");
    expect(sanitizeEnvValue('  "avisos@x.com" ')).toBe("avisos@x.com");
    expect(sanitizeEnvValue("'587'\r\n")).toBe("587");
  });
  it("undefined/vacío → cadena vacía", () => {
    expect(sanitizeEnvValue(undefined)).toBe("");
    expect(sanitizeEnvValue("")).toBe("");
  });
});

describe("loadSmtpConfig", () => {
  it("devuelve null si falta host/user/password", () => {
    expect(loadSmtpConfig({})).toBeNull();
    expect(loadSmtpConfig({ SMTP_HOST: "smtp.x.com" })).toBeNull();
    expect(loadSmtpConfig({ SMTP_HOST: "smtp.x.com", SMTP_USER: "u" })).toBeNull();
  });
  it("lee y sanea (incluido el \\r que rompió un envío real)", () => {
    const cfg = loadSmtpConfig({
      SMTP_HOST: "smtp.office365.com\r",
      SMTP_PORT: "587\r",
      SMTP_SECURE: "false\r",
      SMTP_USER: "avisos@santaclara.com.py\r",
      SMTP_PASSWORD: "secret\r",
      SMTP_FROM_EMAIL: "avisos@santaclara.com.py\r",
      SMTP_FROM_NAME: "Teko\r",
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.host).toBe("smtp.office365.com");
    expect(cfg!.port).toBe(587);
    expect(cfg!.secure).toBe(false);
    expect(cfg!.user).toBe("avisos@santaclara.com.py");
    expect(cfg!.fromName).toBe("Teko");
  });
  it("secure=true sólo cuando SMTP_SECURE='true'", () => {
    const base = { SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASSWORD: "p" };
    expect(loadSmtpConfig({ ...base, SMTP_SECURE: "true" })!.secure).toBe(true);
    expect(loadSmtpConfig({ ...base, SMTP_SECURE: "TRUE" })!.secure).toBe(true);
    expect(loadSmtpConfig({ ...base })!.secure).toBe(false);
  });
  it("from defaultea al user y nombre 'Teko Verify' si faltan", () => {
    const cfg = loadSmtpConfig({ SMTP_HOST: "h", SMTP_USER: "u@x.com", SMTP_PASSWORD: "p" })!;
    expect(cfg.fromEmail).toBe("u@x.com");
    expect(cfg.fromName).toBe("Teko Verify");
    expect(cfg.port).toBe(587);
  });
});

describe("isMailerConfigured", () => {
  it("false sin config, true con host+user+password", () => {
    expect(isMailerConfigured({})).toBe(false);
    expect(isMailerConfigured({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASSWORD: "p" })).toBe(true);
  });
});

describe("isValidEmail", () => {
  it("acepta emails válidos", () => {
    expect(isValidEmail("informatica@santaclara.com.py")).toBe(true);
    expect(isValidEmail("a.b+c@dominio.io")).toBe(true);
  });
  it("rechaza inválidos / no-string / con espacios", () => {
    expect(isValidEmail("no-arroba")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a @b.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(123)).toBe(false);
  });
});

describe("renderVerificationHtml", () => {
  it("incluye el verifyUrl y el botón en español", () => {
    const html = renderVerificationHtml("https://teko.example/verify/abc");
    expect(html).toContain("https://teko.example/verify/abc");
    expect(html).toContain("Verificar mi identidad");
    expect(html).toContain("Ley N.º 7593");
  });
});

describe("sendVerificationEmail (no-op fail-open)", () => {
  const prev = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  };
  it("sin SMTP configurado: devuelve false sin lanzar", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    await expect(
      sendVerificationEmail("informatica@santaclara.com.py", "https://x/verify/t"),
    ).resolves.toBe(false);
    // restaurar
    if (prev.SMTP_HOST !== undefined) process.env.SMTP_HOST = prev.SMTP_HOST;
    if (prev.SMTP_USER !== undefined) process.env.SMTP_USER = prev.SMTP_USER;
    if (prev.SMTP_PASSWORD !== undefined) process.env.SMTP_PASSWORD = prev.SMTP_PASSWORD;
  });
});
