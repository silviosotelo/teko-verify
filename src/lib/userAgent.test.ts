/**
 * Tests del parser liviano de User-Agent (P0 #3): os/browser/tipo + flag de sospecha.
 */
import { describe, it, expect } from "vitest";
import { parseUserAgent } from "./userAgent";

describe("parseUserAgent", () => {
  it("detecta Android mobile + Chrome", () => {
    const d = parseUserAgent(
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
    );
    expect(d.os).toContain("Android");
    expect(d.browser).toBe("Chrome");
    expect(d.type).toBe("mobile");
    expect(d.suspicious).toBe(false);
  });

  it("detecta iPhone iOS + Safari", () => {
    const d = parseUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605 Version/16.5 Mobile/15E Safari/604.1"
    );
    expect(d.os).toContain("iOS");
    expect(d.browser).toBe("Safari");
    expect(d.type).toBe("mobile");
  });

  it("detecta Windows desktop + Edge (no se confunde con Chrome)", () => {
    const d = parseUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0"
    );
    expect(d.os).toContain("Windows");
    expect(d.browser).toBe("Edge");
    expect(d.type).toBe("desktop");
  });

  it("marca HeadlessChrome como sospechoso", () => {
    const d = parseUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36"
    );
    expect(d.suspicious).toBe(true);
  });

  it("marca curl/python como sospechoso", () => {
    expect(parseUserAgent("curl/8.4.0").suspicious).toBe(true);
    expect(parseUserAgent("python-requests/2.31.0").suspicious).toBe(true);
  });

  it("UA ausente → unknown + sospechoso (un navegador siempre manda UA)", () => {
    const d = parseUserAgent(undefined);
    expect(d.type).toBe("unknown");
    expect(d.suspicious).toBe(true);
    expect(d.raw).toBeNull();
  });
});
