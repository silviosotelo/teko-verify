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

  // REGRESIÓN DE SEGURIDAD — invariante cross-tenant
  // El scopeId del input (body o query) es IGNORADO para scope 'tenant'.
  // El scope siempre ancla al tenantId del segundo argumento (extraído de la ruta :id).
  // Si alguien refactoriza parseConfigScope para leer query.scopeId (ej. para permitir
  // que el caller elija el tenant), ESTE TEST DEBE FALLAR — es la defensa contra
  // escritura cross-tenant donde un operador pasa scopeId:"OTRO-TENANT" para editar
  // la config de un tenant que no es el de la ruta.
  it("tenant scope ignora scopeId del body — no cross-tenant", () => {
    // PUT /admin/tenants/t1/config con body { scopeType:"tenant", scopeId:"OTRO-TENANT" }
    // → el handler llama parseConfigScope({ scopeType:"tenant", scopeId:"OTRO-TENANT" }, "t1")
    // → debe resolver a "t1", NUNCA a "OTRO-TENANT"
    expect(
      parseConfigScope({ scopeType: "tenant", scopeId: "OTRO-TENANT" }, "t1")
    ).toEqual({ scopeType: "tenant", scopeId: "t1" });
  });

  it("tenant scope ignora scopeId del query — no cross-tenant (GET)", () => {
    // GET /admin/tenants/t1/config?scopeType=tenant&scopeId=OTRO-TENANT
    // → el handler llama parseConfigScope(req.query, "t1")
    // → debe resolver a "t1", NUNCA a "OTRO-TENANT"
    expect(
      parseConfigScope({ scopeType: "tenant", scopeId: "OTRO-TENANT" }, "t1")
    ).toEqual({ scopeType: "tenant", scopeId: "t1" });
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
