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
  signPayloadV2,
  detectSignatureVersion,
} from "../src/signature";
import { TekoVerify } from "../src/client";

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

// ---------------------------------------------------------------------------
// v2 (ACTUAL): el server firma `2.${ts}.${body}` y envía `X-Signature: sha256v2=...`
// + `X-Signature-Version: 2`. Vector v2 calculado de forma INDEPENDIENTE (paridad
// de bytes con el server real, no sólo "compila").
// ---------------------------------------------------------------------------
const V2_HEX = createHmac("sha256", SECRET).update(`2.${TS}.${BODY}`).digest("hex");

describe("firma v2 — paridad con el server (sha256v2)", () => {
  it("signPayloadV2 firma `2.${ts}.${body}` (referencia independiente)", () => {
    expect(signPayloadV2(SECRET, TS, BODY)).toBe(V2_HEX);
    // v2 != v1 para el mismo (secret, ts, body): el prefijo de versión cambia el HMAC.
    expect(signPayloadV2(SECRET, TS, BODY)).not.toBe(signPayload(SECRET, TS, BODY));
  });

  it("detectSignatureVersion distingue v1/v2 por prefijo", () => {
    expect(detectSignatureVersion(`sha256v2=${V2_HEX}`)).toBe(2);
    expect(detectSignatureVersion(`sha256=${KNOWN_HEX}`)).toBe(1);
    expect(detectSignatureVersion(KNOWN_HEX)).toBe(1);
  });

  it("verifySignature acepta una firma v2 válida (sha256v2=)", () => {
    expect(
      verifySignature({ secret: SECRET, timestamp: TS, body: BODY, signature: `sha256v2=${V2_HEX}`, nowSec: TS })
    ).toBe(true);
  });

  it("verifyWebhookSignature (headers) acepta v2", () => {
    const h = {
      "x-signature-version": "2",
      "x-timestamp": String(TS),
      "x-signature": `sha256v2=${V2_HEX}`,
    };
    expect(verifyWebhookSignature(BODY, h, SECRET, { nowSec: TS })).toBe(true);
  });
});

describe("TekoVerify.verifyWebhookSignature — helper estático (v2, forma por objeto)", () => {
  const base = { payload: BODY, signature: `sha256v2=${V2_HEX}`, timestamp: TS, secret: SECRET, nowSec: TS };

  it("valida una firma v2 correcta dentro de la ventana", () => {
    expect(TekoVerify.verifyWebhookSignature(base)).toBe(true);
  });

  it("acepta payload como Buffer y timestamp como string", () => {
    expect(
      TekoVerify.verifyWebhookSignature({ ...base, payload: Buffer.from(BODY, "utf8"), timestamp: String(TS) })
    ).toBe(true);
  });

  it("rechaza secreto incorrecto, cuerpo manipulado y replay (fail-closed)", () => {
    expect(TekoVerify.verifyWebhookSignature({ ...base, secret: "wrong" })).toBe(false);
    expect(TekoVerify.verifyWebhookSignature({ ...base, payload: BODY + "x" })).toBe(false);
    expect(TekoVerify.verifyWebhookSignature({ ...base, nowSec: TS + 301 })).toBe(false);
  });
});
