/**
 * Tests del white-label por tenant (P1 #5): resolución con fallback, saneo
 * fail-closed y derivación del tema (theming).
 */
import { describe, it, expect } from "vitest";
import {
  resolveBranding,
  sanitizeBranding,
  deriveThemeColors,
  isHexColor,
  TEKO_PRIMARY,
  TEKO_DISPLAY_NAME,
} from "./branding";

describe("resolveBranding — fallback al branding Teko", () => {
  it("sin branding (null/undefined/{}) cae al default Teko verde + wordmark", () => {
    for (const b of [null, undefined, {}]) {
      const r = resolveBranding(b as never);
      expect(r.primaryColor).toBe(TEKO_PRIMARY);
      expect(r.displayName).toBe(TEKO_DISPLAY_NAME);
      expect(r.logoUrl).toBeNull();
      expect(r.welcomeText).toBeNull();
      expect(r.supportEmail).toBeNull();
    }
  });

  it("aplica el branding propio del tenant y mantiene defaults en lo ausente", () => {
    const r = resolveBranding({ displayName: "Acme", primaryColor: "#0066FF" });
    expect(r.displayName).toBe("Acme");
    expect(r.primaryColor).toBe("#0066ff"); // normalizado a minúsculas
    expect(r.logoUrl).toBeNull(); // ausente → default
  });

  it("un primaryColor inválido cae fail-closed al verde Teko (nunca rompe el tema)", () => {
    expect(resolveBranding({ primaryColor: "rojo" }).primaryColor).toBe(TEKO_PRIMARY);
    expect(resolveBranding({ primaryColor: "#xyz" }).primaryColor).toBe(TEKO_PRIMARY);
    expect(resolveBranding({ primaryColor: "#fff" }).primaryColor).toBe(TEKO_PRIMARY); // 3-dígitos no aceptado
  });

  it("acepta logoUrl on-prem (/...) y http(s); descarta el resto", () => {
    expect(resolveBranding({ logoUrl: "/branding/abc/logo" }).logoUrl).toBe("/branding/abc/logo");
    expect(resolveBranding({ logoUrl: "https://cdn.x/logo.png" }).logoUrl).toBe("https://cdn.x/logo.png");
    expect(resolveBranding({ logoUrl: "javascript:alert(1)" }).logoUrl).toBeNull();
  });
});

describe("sanitizeBranding — fail-closed por campo", () => {
  it("descarta campos inválidos y conserva los válidos", () => {
    const out = sanitizeBranding({
      displayName: "  Acme  ",
      primaryColor: "#ABCDEF",
      logoUrl: "ftp://nope",
      supportEmail: "no-es-email",
      welcomeText: "Bienvenido",
    });
    expect(out.displayName).toBe("Acme");
    expect(out.primaryColor).toBe("#abcdef");
    expect(out.logoUrl).toBeUndefined();
    expect(out.supportEmail).toBeUndefined();
    expect(out.welcomeText).toBe("Bienvenido");
  });

  it("input no-objeto → {} (no rompe el guardado)", () => {
    expect(sanitizeBranding(null)).toEqual({});
    expect(sanitizeBranding("x")).toEqual({});
    expect(sanitizeBranding(42)).toEqual({});
  });

  it("capea longitudes y acepta email válido", () => {
    const out = sanitizeBranding({
      displayName: "x".repeat(200),
      supportEmail: "soporte@acme.com",
    });
    expect(out.displayName!.length).toBe(60);
    expect(out.supportEmail).toBe("soporte@acme.com");
  });
});

describe("deriveThemeColors — theming", () => {
  it("deriva deep (más oscuro) y subtle (más claro) del primario", () => {
    const t = deriveThemeColors("#16a34a");
    expect(t.primary).toBe("#16a34a");
    expect(isHexColor(t.primaryDeep)).toBe(true);
    expect(isHexColor(t.primarySubtle)).toBe(true);
    // deep oscurece (suma de canales menor), subtle aclara (suma mayor).
    const sum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(sum(t.primaryDeep)).toBeLessThan(sum(t.primary));
    expect(sum(t.primarySubtle)).toBeGreaterThan(sum(t.primary));
  });

  it("color inválido → paleta Teko (fail-closed)", () => {
    expect(deriveThemeColors("nope").primary).toBe(TEKO_PRIMARY);
    expect(deriveThemeColors(null).primary).toBe(TEKO_PRIMARY);
  });
});
