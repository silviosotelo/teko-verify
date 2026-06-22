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
export * as questionnaires from "./questionnaires";
export * as billingPlans from "./billingPlans";
export * as subscriptions from "./subscriptions";
export * as usageAlerts from "./usageAlerts";
export * as configValues from "./configValues";
export * as tenantIntegrations from "./tenantIntegrations";
export * as documentTypes from "./documentTypes";
export * as extractionFields from "./extractionFields";

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
import * as questionnaires from "./questionnaires";
import * as billingPlans from "./billingPlans";
import * as subscriptions from "./subscriptions";
import * as usageAlerts from "./usageAlerts";
import * as configValues from "./configValues";
import * as tenantIntegrations from "./tenantIntegrations";
import * as documentTypes from "./documentTypes";
import * as extractionFields from "./extractionFields";

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
  questionnaires,
  billingPlans,
  subscriptions,
  usageAlerts,
  configValues,
  tenantIntegrations,
  documentTypes,
  extractionFields,
} as const;
