/**
 * RBAC — matriz de permisos por rol (módulo PURO, sin I/O, testeable).
 *
 * Modelo: el operador del dashboard admin tiene un `AdminRole`. Cada acción del
 * panel exige un `Permission` atómico. `can(role, permission)` resuelve contra una
 * matriz estática. FAIL-CLOSED: rol desconocido (o no presente en la matriz) ⇒ sin
 * permisos ⇒ denegado. Nunca "permitir por defecto".
 *
 * Roles:
 *   owner    → todos los permisos (incl. crear orgs y administrar miembros).
 *   admin    → gestiona apps/workflows/webhooks/branding/keys + revisa + lee.
 *              NO administra orgs (manage_tenants) ni miembros (manage_members).
 *   reviewer → revisa sesiones (cola) + lee sesiones/uso. No configura.
 *   viewer   → solo lectura (sesiones + uso).
 *   operator → LEGACY: alias de `admin` (compat con filas existentes).
 */
import type { AdminRole, Permission } from "../types";

/** Catálogo completo de permisos (orden estable para UI/tests). */
export const ALL_PERMISSIONS: readonly Permission[] = [
  "manage_tenants",
  "manage_apps",
  "manage_workflows",
  "manage_webhooks",
  "manage_branding",
  "manage_members",
  "manage_api_keys",
  "review_sessions",
  "view_sessions",
  "view_usage",
] as const;

/** Permisos de gestión que un `admin` controla (todo menos orgs y miembros). */
const ADMIN_PERMISSIONS: readonly Permission[] = [
  "manage_apps",
  "manage_workflows",
  "manage_webhooks",
  "manage_branding",
  "manage_api_keys",
  "review_sessions",
  "view_sessions",
  "view_usage",
] as const;

/**
 * Matriz rol → permisos. Cada rol mapea a un Set para lookup O(1). Un rol que NO
 * esté en este mapa (p.ej. un valor corrupto en DB) cae a permisos vacíos.
 */
const MATRIX: Record<AdminRole, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(ALL_PERMISSIONS),
  admin: new Set<Permission>(ADMIN_PERMISSIONS),
  // LEGACY: las filas con role='operator' conservan capacidades de admin.
  operator: new Set<Permission>(ADMIN_PERMISSIONS),
  reviewer: new Set<Permission>([
    "review_sessions",
    "view_sessions",
    "view_usage",
  ]),
  viewer: new Set<Permission>(["view_sessions", "view_usage"]),
};

/**
 * ¿El rol tiene el permiso? FAIL-CLOSED: si `role` no está en la matriz (rol
 * desconocido/corrupto) o el permiso no fue concedido, devuelve `false`.
 */
export function can(role: AdminRole | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const perms = MATRIX[role as AdminRole];
  if (!perms) return false; // rol desconocido → denegar
  return perms.has(permission);
}

/** Lista (ordenada) de permisos concedidos a un rol. Rol desconocido → []. */
export function permissionsFor(role: AdminRole | string | null | undefined): Permission[] {
  if (!role) return [];
  const perms = MATRIX[role as AdminRole];
  if (!perms) return [];
  return ALL_PERMISSIONS.filter((p) => perms.has(p));
}

/** Roles asignables desde la UI (excluye el alias legacy `operator`). */
export const ASSIGNABLE_ROLES: readonly AdminRole[] = ["owner", "admin", "reviewer", "viewer"] as const;

/** ¿`role` es un AdminRole válido y asignable? (validación de input de la UI). */
export function isAssignableRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}
