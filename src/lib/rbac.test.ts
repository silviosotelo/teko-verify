import { describe, it, expect } from "vitest";
import {
  can,
  permissionsFor,
  ALL_PERMISSIONS,
  ASSIGNABLE_ROLES,
  isAssignableRole,
} from "./rbac";
import type { AdminRole, Permission } from "../types";

describe("rbac.can — matriz de permisos", () => {
  it("owner tiene TODOS los permisos", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(can("owner", p)).toBe(true);
    }
    expect(permissionsFor("owner")).toEqual([...ALL_PERMISSIONS]);
  });

  it("admin gestiona todo MENOS orgs y miembros", () => {
    expect(can("admin", "manage_apps")).toBe(true);
    expect(can("admin", "manage_workflows")).toBe(true);
    expect(can("admin", "manage_webhooks")).toBe(true);
    expect(can("admin", "manage_branding")).toBe(true);
    expect(can("admin", "manage_api_keys")).toBe(true);
    expect(can("admin", "review_sessions")).toBe(true);
    // owner-only:
    expect(can("admin", "manage_tenants")).toBe(false);
    expect(can("admin", "manage_members")).toBe(false);
  });

  it("operator (LEGACY) equivale a admin", () => {
    expect(permissionsFor("operator")).toEqual(permissionsFor("admin"));
  });

  it("reviewer solo revisa y lee", () => {
    expect(can("reviewer", "review_sessions")).toBe(true);
    expect(can("reviewer", "view_sessions")).toBe(true);
    expect(can("reviewer", "view_usage")).toBe(true);
    expect(can("reviewer", "manage_workflows")).toBe(false);
    expect(can("reviewer", "manage_apps")).toBe(false);
    expect(can("reviewer", "manage_webhooks")).toBe(false);
  });

  it("viewer es solo lectura (no revisa)", () => {
    expect(can("viewer", "view_sessions")).toBe(true);
    expect(can("viewer", "view_usage")).toBe(true);
    expect(can("viewer", "review_sessions")).toBe(false);
    expect(can("viewer", "manage_workflows")).toBe(false);
    expect(can("viewer", "manage_apps")).toBe(false);
  });

  it("FAIL-CLOSED: rol desconocido o nulo → sin permisos", () => {
    expect(can("hacker" as AdminRole, "view_sessions")).toBe(false);
    expect(can(null, "view_sessions")).toBe(false);
    expect(can(undefined, "view_sessions")).toBe(false);
    expect(can("", "view_sessions" as Permission)).toBe(false);
    expect(permissionsFor("nope")).toEqual([]);
  });
});

describe("rbac — roles asignables", () => {
  it("expone owner/admin/reviewer/viewer (sin el alias legacy operator)", () => {
    expect([...ASSIGNABLE_ROLES]).toEqual(["owner", "admin", "reviewer", "viewer"]);
    expect(isAssignableRole("admin")).toBe(true);
    expect(isAssignableRole("operator")).toBe(false);
    expect(isAssignableRole("nope")).toBe(false);
    expect(isAssignableRole(123)).toBe(false);
  });
});
