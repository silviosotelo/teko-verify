import { describe, it, expect } from "vitest";
import { parseConfigScope, isValidConfigPut } from "./configValidation";

describe("parseConfigScope", () => {
  it("default → tenant scope con scopeId = tenantId", () => {
    expect(parseConfigScope({}, "t1")).toEqual({ scopeType: "tenant", scopeId: "t1" });
  });
  it("system → scopeId null", () => {
    expect(parseConfigScope({ scopeType: "system" }, "t1")).toEqual({ scopeType: "system", scopeId: null });
  });
  it("app/workflow NO soportados en Fase 0 → null (evita escritura cross-tenant sin ownership check)", () => {
    expect(parseConfigScope({ scopeType: "app", scopeId: "a1" }, "t1")).toBeNull();
    expect(parseConfigScope({ scopeType: "workflow", scopeId: "w1" }, "t1")).toBeNull();
  });
  it("scopeType inválido → null", () => {
    expect(parseConfigScope({ scopeType: "galaxy" }, "t1")).toBeNull();
  });
});

describe("isValidConfigPut", () => {
  it("acepta namespace permitido + key + value", () => {
    expect(isValidConfigPut({ namespace: "thresholds", key: "matchCosine", value: 0.5 })).toBe(true);
  });
  it("rechaza namespace fuera de la lista", () => {
    expect(isValidConfigPut({ namespace: "hacks", key: "x", value: 1 })).toBe(false);
  });
  it("rechaza key vacía o value ausente", () => {
    expect(isValidConfigPut({ namespace: "thresholds", key: "", value: 1 })).toBe(false);
    expect(isValidConfigPut({ namespace: "thresholds", key: "x" })).toBe(false);
  });
});
