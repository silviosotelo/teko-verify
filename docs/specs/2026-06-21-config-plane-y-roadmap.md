# Teko Verify — Config Plane unificado + reorganización + roadmap a SaaS configurable y escalable

Fecha: 2026-06-21
Estado: diseño (brainstorming) — pendiente de aprobación antes de planes de implementación.
Decisiones del usuario: (1) **estructura + config primero**, escala después; (2) volumen objetivo **miles/día (1k–10k)** → infra mínima y diferida; (3) configurabilidad hasta **extensibilidad total** (tipos de doc, campos y validaciones definibles por tenant sin código).

## 1. Problema

La plataforma creció sprint-a-sprint y la **configuración quedó dispersa en 3 capas sin patrón común**, el **admin no tiene jerarquía de información**, y la **arquitectura no escala horizontal**. Síntoma del usuario: "desordenada, sin estructura ni lógica".

### Diagnóstico (con evidencia)
**A. Configuración dispersa — no hay una sola fuente de verdad:**
- **Env vars globales** (no editables sin redeploy): `MATCH_THRESHOLD`, `LIVENESS_THRESHOLD`, `AML_MATCH_THRESHOLD`, `GLASSES_MAX`, SMTP, storage, modelos ONNX (`src/config.ts`).
- **JSONB por tenant** (parcial e inconsistente): `tenants.policies`, `workflows.definition` (versionado ✓), `branding`, `questionnaires`, `usage_alerts`.
- **Enums hardcodeados en código** (no extensibles sin deploy): `DocumentType = 'ci_py'|'passport'` (`src/types.ts`), los 8 checks del pipeline (`src/modules/*`), `LivenessChallenge`, campos del OCR (`extracted: {ci,nombre,fechaNac,nacionalidad,tipoDoc}` en `document.ts`), `ReviewMode`.
- Mismo umbral: a veces se puede por tenant (vía workflow), a veces no (env). Sin versionado uniforme ni auditoría de cambios de config.

**B. Admin sin jerarquía:** 33 vistas, menú plano. "Configuración" es un cajón de 11 ítems que mezcla *config de producto* (workflows, cuestionarios) con *infra* (SMTP, storage). Integraciones (Connectors/OAuth/Zapier), parte de Billing y Reminders **no están en el menú**. Sin distinción visual **tenant vs app**, sin onboarding/checklist.

**C. No escala horizontal:** estado **en memoria** (rate-limit `lib/rateLimit.ts`, sesiones admin `router.ts:16`) → 2 instancias se desincronizan; **pipeline síncrono** (ONNX + webhooks en el request, `api/capture.ts`, `webhooks/dispatcher.ts`) → ~20 verificaciones concurrentes bloquean el event loop; **faceSearch O(N)** brute-force (`modules/faceSearch.ts:87`); Postgres único = SPOF.

## 2. El norte — un "Config Plane" unificado

Una capa de **configuración versionada y jerárquica** que reemplaza la dispersión. Todo (umbrales, proveedores, canales, tipos de doc, campos, qué checks corren) se **resuelve por cascada** con herencia y override:

```
system (defaults de plataforma)
  └─ tenant (override por org)
       └─ app (override por proyecto)
            └─ workflow (override por flujo de verificación)
```

Un único `resolveConfig(key, {tenantId, appId, workflowId})` devuelve el valor efectivo. El motor y el admin leen SIEMPRE de ahí. Estructura + configurabilidad + (futura) escala salen del mismo diseño.

## 3. Arquitectura objetivo

### 3.1 Config Plane (modelo de datos)
Tabla única `config_values`:
```
config_values(
  id, scope_type ENUM('system','tenant','app','workflow'),
  scope_id  (null para system),
  namespace TEXT,        -- 'thresholds' | 'providers' | 'rules' | 'ui' | 'compliance' | 'pipeline' | 'documents'
  key       TEXT,
  value     JSONB,
  version   INT,
  updated_by, updated_at,
  UNIQUE(scope_type, scope_id, namespace, key, version)
)
```
- **Resolución**: `resolveConfig` toma la fila más específica vigente (workflow→app→tenant→system) por `(namespace,key)`. Defaults del system se siembran por migración desde los valores actuales de `config.ts`.
- **Versionado + auditoría**: cada cambio crea versión nueva; `config_audit` registra quién/cuándo/antes/después. Rollback = apuntar a versión previa.
- **Cache**: resolución memoizada en proceso; cuando se introduzca Redis (Fase 5), cache compartida con invalidación por evento.
- **Compatibilidad**: `workflows.definition` se mantiene como la **cara** de "config de verificación", pero internamente persiste/lee del Config Plane (no se rompe nada existente). `tenants.policies` se migra a `namespace='compliance'/'thresholds'`.

### 3.2 Extensibilidad total
- **Checks registry (pipeline configurable)**: `registerCheck({key,label,version,run})` en `src/pipeline/registry.ts`. El workflow define `pipeline.checks: [{key, enabled, order, config}]` (en el Config Plane). El pipeline itera el registro según esa lista → **activar/desactivar/reordenar/parametrizar** los 8 checks existentes por tenant/workflow **sin deploy**. (Un check *nuevo* sigue siendo código —es lógica—, pero su activación y params son data.)
- **Document types DB-driven**: tabla `document_types(key,label,country,mrz_format,enabled,scope)`. El OCR/MRZ usa la definición. Agregar un tipo = data (+ parser solo si el layout es nuevo).
- **Campos + validaciones declarativas**: `extraction_fields(doc_type,key,label,type,validation JSONB)` con reglas declarativas (requerido, regex, rango de fecha, normalización). El motor aplica las reglas desde data → campos y validaciones por tenant **sin código**.
- **Proveedores por tenant**: `tenant_integrations(tenant_id,kind ENUM('smtp','storage','aml','sms'),config JSONB cifrado,enabled)`. `mailer`/`evidenceStore`/`amlProvider` resuelven el provider por tenant con **fallback al system**.

### 3.3 Admin reorganizado (arquitectura de información)
De menú plano (33 vistas, 5 grupos) a **6 secciones con jerarquía** + selector **tenant/app** prominente y un **Centro de Configuración** con checklist de onboarding:
```
Operación        → Dashboard · Sesiones · Cola de revisión
Organización     → Tenants · Apps · Equipo · Facturación (Planes/Invoices/Pagos/Alertas)
Configuración    → [Centro/checklist] · Verificación (Workflows·Cuestionarios·Reminders)
                    · Documentos & Campos · Comunicación (Email+Templates·SMS) · Marca (White-label)
Integraciones    → Conectores · OAuth · Zapier · API Keys · Webhooks · Almacenamiento
Cumplimiento     → Compliance · Auditoría · Retención · Uso & Métricas · Rate Limits
Developer        → Probar verificación · Inspector OCR
```
Cada vista de config edita el Config Plane en el scope seleccionado (con indicador claro "configurando: Tenant X / App Y").

### 3.4 Base escalable (mínima para miles/día — diferida)
Para 1k–10k/día NO hace falta re-arquitectura. Cuando se acerque a 10k+/día, en este orden: (1) Redis para rate-limit + sesiones admin (ya existe `RedisRateLimiter`); (2) 1 worker BullMQ para webhooks + pipeline async opcional; (3) pgvector para faceSearch. Se deja **documentado, no implementado** hasta que el volumen lo pida.

## 4. Roadmap por fases (cada fase = sub-proyecto con su spec → plan → implementación)

| Fase | Objetivo | Entregable | Esfuerzo |
|---|---|---|---|
| **0 — Fundaciones Config Plane** | tabla `config_values` + `resolveConfig` + cache + auditoría; seed de defaults desde `config.ts`; el motor lee thresholds del plane (compat con workflow.definition) | umbrales/retención/consentimiento editables y versionados por scope, sin redeploy | 2–3 sem |
| **1 — Reorg del admin** | nueva IA (6 secciones), selector tenant/app claro, Centro de Configuración + checklist onboarding, exponer vistas ocultas, fusionar (Email+Templates, Reminders), renombrar (Compliance/Auditoría) | admin con estructura y lógica; descubribilidad | 1–2 sem |
| **2 — Proveedores por tenant** | `tenant_integrations` (SMTP/storage/AML/SMS) cifrado + resolución con fallback; UI de integraciones por tenant | cada tenant usa su email/storage/AML | 2–3 sem |
| **3 — Pipeline configurable** | checks registry; workflow.pipeline.checks (enabled/order/config) en el plane; editor de workflow con checks on/off/reorder/params | activar/ordenar/parametrizar checks por tenant sin deploy | 2–3 sem |
| **4 — Extensibilidad documentos/campos** | `document_types` + `extraction_fields` + validaciones declarativas; UI para definirlos; motor OCR/MRZ data-driven | tipos de doc, campos y validaciones por tenant sin código | 3–4 sem |
| **5 — Escalabilidad (diferida)** | Redis (rate-limit+sesiones), worker BullMQ (webhooks+pipeline), pgvector | crecer a 10k+/día horizontal | cuando el volumen lo pida |

Orden alineado a tu decisión: estructura+config (0→4) primero; escala (5) diferida.

## 5. Principios de diseño
- **No romper lo que funciona**: cada fase envuelve/centraliza lo existente con compatibilidad (workflow.definition sigue siendo la cara; el plane es el backend). Migración incremental con seed de defaults.
- **Una fuente de verdad**: nada de config nueva fuera del Config Plane.
- **Data sobre código**: lo que un tenant deba ajustar es data (config/validaciones declarativas), no constantes.
- **Fail-closed se preserva**: la configurabilidad no relaja el fail-closed del motor; los defaults del system son seguros.
- **Auditable y reversible**: todo cambio de config versionado y con audit log.

## 6. Riesgos / decisiones abiertas
- **Cifrado de secretos** en `tenant_integrations` (SMTP/AML keys): definir KMS/secret-store (Fase 2).
- **Validación de config**: un schema por namespace (JSON Schema) para que la UI valide antes de guardar y el motor no reciba config inválida.
- **Migración de `tenants.policies`/`workflows.definition`** al plane: hacerla idempotente y con dual-read durante la transición.
- **Checks "nuevos" siguen requiriendo deploy**: la extensibilidad cubre activación/orden/params y campos/validaciones declarativas; lógica de un check nuevo es código (aceptado).
