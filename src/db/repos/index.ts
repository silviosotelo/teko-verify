/**
 * Barrel de repositorios de la capa de datos.
 *
 * Se exportan como namespaces porque cada repo comparte nombres (create/getById/...).
 * Uso: `import { repos } from "./db/repos"; await repos.sessions.create(...)`.
 * Todos los métodos (salvo las dos excepciones de auth documentadas) reciben
 * tenantId como primer parámetro y aceptan un Executor opcional (pool o PoolClient).
 */
export * as tenants from "./tenants";
export * as apps from "./apps";
export * as apiKeys from "./apiKeys";
export * as sessions from "./sessions";
export * as checks from "./checks";
export * as identities from "./identities";
export * as evidence from "./evidence";
export * as auditLog from "./auditLog";
export * as consents from "./consents";
export * as workflows from "./workflows";
export * as webhookEndpoints from "./webhookEndpoints";
export * as webhookDeliveries from "./webhookDeliveries";
export * as sessionEvents from "./sessionEvents";
export * as amlEntities from "./amlEntities";

import * as tenants from "./tenants";
import * as apps from "./apps";
import * as apiKeys from "./apiKeys";
import * as sessions from "./sessions";
import * as checks from "./checks";
import * as identities from "./identities";
import * as evidence from "./evidence";
import * as auditLog from "./auditLog";
import * as consents from "./consents";
import * as workflows from "./workflows";
import * as webhookEndpoints from "./webhookEndpoints";
import * as webhookDeliveries from "./webhookDeliveries";
import * as sessionEvents from "./sessionEvents";
import * as amlEntities from "./amlEntities";

/** Agrupador único para inyección/uso conveniente. */
export const repos = {
  tenants,
  apps,
  apiKeys,
  sessions,
  checks,
  identities,
  evidence,
  auditLog,
  consents,
  workflows,
  webhookEndpoints,
  webhookDeliveries,
  sessionEvents,
  amlEntities,
} as const;
