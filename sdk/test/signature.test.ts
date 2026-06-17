/**
 * Tests del SDK: verificación de firma de webhooks (determinística, replicando el
 * algoritmo del server src/webhooks/signing.ts) + parseo de headers.
 *
 * Vector fijo: HMAC-SHA256("whsec_test_secret", `1700000000.${body}`) calculado de
 * forma independiente (mismo algoritmo del server) y embebido como constante.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  verifyWebhookSignature,
  verifySignature,
  signPayload,
} from "../src/signature";

const SECRET = "whsec_test_secret";
const TS = 1700000000;
// rawBody EXACTO tal como lo envía el server (cuerpo canónico, claves ordenadas).
const BODY = JSON.stringify({ a: 1, b: 2, nested: { y: 2, z: 1 } });
// Vector determinístico precomputado (ver sdk: node crypto).
const KNOWN_HEX =
  "775ad8445a0923f2ed2f35a67f2a6cbba44136b8d5b27a3190b1069b68113f5a";

describe("signPayload — determinismo y paridad con el server", () => {
  it("coincide con el vector fijo conocido", () => {
    expect(signPayload(SECRET, TS, BODY)).toBe(KNOWN_HEX);
  });

  it("es idéntica a una referencia HMAC independiente", () => {
    const ref = createHmac("sha256", SECRET).update(`${TS}.${BODY}`).digest("hex");
    expect(signPayload(SECRET, TS, BODY)).toBe(ref);
  });

  it("cambia con timestamp y con secreto", () => {
    const base = signPayload(SECRET, TS, BODY);
    expect(signPayload(SECRET, TS + 1, BODY)).not.toBe(base);
    expect(signPayload("otro", TS, BODY)).not.toBe(base);
  });
});

describe("verifyWebhookSignature — desde headers HTTP", () => {
  function headers(extra: Record<string, string> = {}) {
    return {
      "content-type": "application/json",
      "x-teko-event": "session.approved",
      "x-event-id": "evt_abc",
      "x-timestamp": String(TS),
      "x-signature": `sha256=${KNOWN_HEX}`,
      ...extra,
    };
  }

  it("valida una firma correcta dentro de la ventana", () => {
    expect(verifyWebhookSignature(BODY, headers(), SECRET, { nowSec: TS + 10 })).toBe(true);
  });

  it("acepta firma sin el prefijo sha256=", () => {
    expect(
      verifyWebhookSignature(BODY, headers({ "x-signature": KNOWN_HEX }), SECRET, {
        nowSec: TS,
      })
    ).toBe(true);
  });

  it("acepta el cuerpo como Buffer", () => {
    expect(
      verifyWebhookSignature(Buffer.from(BODY, "utf8"), headers(), SECRET, { nowSec: TS })
    ).toBe(true);
  });

  it("lee headers case-insensitive (X-Signature / X-Timestamp)", () => {
    const upper = { "X-Timestamp": String(TS), "X-Signature": `sha256=${KNOWN_HEX}` };
    expect(verifyWebhookSignature(BODY, upper, SECRET, { nowSec: TS })).toBe(true);
  });

  it("soporta Web Headers (get())", () => {
    const h = new Headers();
    h.set("x-timestamp", String(TS));
    h.set("x-signature", `sha256=${KNOWN_HEX}`);
    expect(verifyWebhookSignature(BODY, h, SECRET, { nowSec: TS })).toBe(true);
  });

  it("rechaza secreto incorrecto", () => {
    expect(verifyWebhookSignature(BODY, headers(), "wrong", { nowSec: TS })).toBe(false);
  });

  it("rechaza cuerpo manipulado", () => {
    expect(verifyWebhookSignature(BODY + "x", headers(), SECRET, { nowSec: TS })).toBe(false);
  });

  it("rechaza por replay (fuera de ventana 300s)", () => {
    expect(verifyWebhookSignature(BODY, headers(), SECRET, { nowSec: TS + 301 })).toBe(false);
    expect(verifyWebhookSignature(BODY, headers(), SECRET, { nowSec: TS - 301 })).toBe(false);
  });

  it("rechaza si faltan headers", () => {
    expect(verifyWebhookSignature(BODY, { "x-timestamp": String(TS) }, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, { "x-signature": KNOWN_HEX }, SECRET)).toBe(false);
  });

  it("rechaza timestamp no numérico", () => {
    expect(
      verifyWebhookSignature(BODY, headers({ "x-timestamp": "no" }), SECRET, { nowSec: TS })
    ).toBe(false);
  });
});

describe("verifySignature — primitiva", () => {
  it("roundtrip true / firma incorrecta false", () => {
    expect(verifySignature({ secret: SECRET, timestamp: TS, body: BODY, signature: KNOWN_HEX, nowSec: TS })).toBe(true);
    expect(verifySignature({ secret: SECRET, timestamp: TS, body: BODY, signature: "00", nowSec: TS })).toBe(false);
  });
});
