# Teko Verify — Auditoría de completitud funcional → roadmap a MVP SaaS

Fecha: 2026-06-20
Objetivo: plataforma KYC completa, funcional, MVP, **SaaS multitenant + RBAC, escalable, optimizada**.
Método: 6 auditorías paralelas (pipeline, RBAC/multitenancy, billing, integraciones, vistas admin, config/compliance) + verificación directa de hallazgos accionables.

> Nota de método: 2 afirmaciones de los agentes se verificaron FALSAS al leer el código —
> `photoCompare.ts` NO tiene el bug "cosineSimilarity undefined" (está definida, es dead-code limpio),
> y Workflows NO es maqueta (es real: versionado + applied pipeline). Corregidas abajo.

## Veredicto ejecutivo

El **core del producto está production-grade** (~90% real). Lo que falta para "SaaS comercializable" es casi todo de la **capa de negocio/monetización y onboarding**, más unos gaps de autorización y un bug de configuración.

- ✅ **Real y sólido**: pipeline de verificación completo, multitenancy con aislamiento a nivel schema, RBAC (matriz), API pública `/v1`, webhooks (HMAC+retry+circuit-breaker), workflows versionados, email transaccional, retención PII automática, branding white-label, cuestionarios, usage metering, rate-limit enforcement.
- 🔴 **Maqueta / sin backend**: Billing entero (planes, facturas, métodos de pago, alertas de uso), SMS, Recordatorios, OAuth, Zapier.
- 🟠 **Gaps SaaS**: sin signup self-service de tenants, sin gating de cuota por plan, sin SDK/OpenAPI.
- 🐛 **Bugs/seguridad**: rate-limits no se aplican (keys desalineadas), 2 endpoints sin `requirePermission`.

---

## 1. Lo que YA es production-grade (NO tocar)

| Área | Estado | Evidencia |
|---|---|---|
| Pipeline core: quality→liveness→document→match→decision | ✅ | `src/modules/*` + `src/pipeline.ts`; fail-closed duro; tests |
| Checks P1/P2: AML local, faceSearch 1:N, proofOfAddress, ageEstimation | ✅ | `src/modules/{aml,faceSearch,proofOfAddress,ageEstimation}.ts`, cableados en pipeline |
| Multitenancy — aislamiento | ✅ | FK compuestas `tenant_id+id` (`migrations/0001`), repo-scoping (`repos/sessions.ts:212`), app-scoping (`0015`) |
| RBAC — matriz de permisos | ✅ | `src/lib/rbac.ts:20-60` (owner/admin/reviewer/viewer + 10 permisos, fail-closed) |
| API pública `/v1` (crear/listar/consultar/borrar sesión) | ✅ | `src/api/tenant.ts:61-100`; Bearer API key; idempotencia por `external_ref`; right-to-erasure |
| API keys (generar/hash scrypt/validar/scoping por app) | ✅ | `src/lib/crypto.ts`, `src/api/auth.ts`, `ApiKeys` view |
| Webhooks (HMAC v2, reintentos 60/240/900s, idempotencia, circuit-breaker, fail-open) | ✅ | `src/webhooks/{signing,dispatcher}.ts`, `lib/webhook.ts` |
| Workflows (versionado + applied pipeline + routing a revisión) | ✅ | `src/lib/workflow.ts:70-171`; snapshot por sesión |
| Email transaccional + plantillas editables por tenant | ✅ | `src/lib/mailer.ts:180-255`, `router.ts:2389-2446` |
| Retención PII automática (Ley 7593) | ✅ | `src/lib/cleanup.ts:144-170` (scheduler horario), `compliance.ts` |
| Storage evidencia (disco/CIFS por tenant, purga atómica) | ✅ | `src/lib/evidenceStore.ts:27-251` |
| Branding white-label aplicado al flujo de captura | ✅ | `src/lib/branding.ts`, `brandingStore.ts` |
| Cuestionarios (CRUD + validación + persistencia) | ✅ | `src/lib/questionnaire.ts`, `router.ts:1104-1180` |
| Review queue manual (decisión) | ✅ | `router.ts:1460` (POST con `requireReview`) |

---

## 2. 🐛 Quick-wins verificados — Sprint 0 ✅ HECHO (commit pendiente de deploy)

| # | Problema | Evidencia | Fix aplicado | Estado |
|---|---|---|---|---|
| Q1 | **Rate-limits nunca se aplican**: cliente enviaba `{v1,verify,admin}` pero el router lee `{rateLimitV1,rateLimitVerify,rateLimitAdmin}` → caía siempre al fallback. Raíz: el tipo `TenantPolicy` del front no modelaba los rate-limits | `client.ts:555` vs `router.ts:2489` | Agregados `rateLimitV1/Verify/Admin?` a `TenantPolicy` (types.ts); alineadas keys en `client.ts`; `RateLimits.tsx` ahora envía keys correctas Y carga valores actuales del tenant (useEffect) | ✅ |
| Q2 | `GET /admin/review-queue` sin `requirePermission` (viewer podía verla) | `router.ts:1411` | `requireReview` (= `requirePermission("review_sessions")`) | ✅ |
| Q3 | `GET /admin/tenants/:id/metrics` sin `requirePermission` | `router.ts:887` | `requirePermission("view_usage")` | ✅ |
| Q5 | **Dead code**: `photoCompare.ts` (no referenciado; el agente alucinó un bug — `cosineSimilarity` SÍ existe) | `src/modules/photoCompare.ts` | Borrado (0 imports, sin test) | ✅ |
| Q6 | `authenticity.ts` no cableado (la autenticidad real vive en `document.ts`) | `src/modules/authenticity.ts` | Borrado (0 imports, sin test) | ✅ |
| Q4 | READ endpoints sin gate (least-privilege) — ~41 GETs | router (varios) | Pendiente (Sprint posterior; GETs son tenant-scoped, no hay leak) | ⏳ M |

**Verificación Sprint 0**: backend `tsc --noEmit` exit 0; **325/326 tests** (vitest); frontend 0 errores tsc nuevos en archivos tocados; `vite build` ✓.
> Q2/Q3 tocan backend → requieren rebuild + deploy del container. Roles owner/admin/operator/reviewer tienen `review_sessions`; todos tienen `view_usage` → sin riesgo de lockout del operador actual.

### 🐛 Bug pre-existente detectado (fuera de Sprint 0, NO introducido por estos cambios)
- **`consentShouldTransition("capturing")` devuelve `false`** pero el test `capture.test.ts:45` espera `true` ("transiciona sólo desde {created, capturing}"). Confirmado pre-existente (falla con los cambios stasheados). El guard de re-consentimiento no permite transicionar desde `capturing`. Revisar: ¿bug del guard o test desactualizado? Esf. S.

---

## 3. 🔴 Capa de monetización (Billing) — casi 100% maqueta

Confirmado: **UI con datos hardcodeados, sin tablas DB, sin endpoints, sin repos**. Lo único real es el **metering** (conteo de uso) y el **rate-limit enforcement**.

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Planes | 🔴 mock | `BillingPlans.tsx:17-80` array hardcodeado; upgrade `:252` es `setTimeout` no-op |
| Facturas | 🔴 mock | `BillingInvoices.tsx:28` `MOCK_INVOICES`; descarga `:206,215` no-op |
| Métodos de pago | 🔴 mock | `BillingPaymentMethods.tsx:39` `MOCK_METHODS`; add/delete solo `setState` |
| Alertas de uso | 🔴 mock | `BillingUsageAlerts.tsx:126` `handleSave` no-op |
| Tablas DB billing | 🔴 no existen | 0 migraciones con plans/subscriptions/invoices/payment_methods |
| Usage metering (consumo real) | ✅ | `Usage.tsx:76` (`tekoApi.usage()/analytics()` reales) |
| **Plan gating** (bloquear al exceder cuota) | ⚫ no existe | ningún repo valida cuota vs plan |
| Pasarela de pagos | ⚫ no existe | ningún cliente Stripe/Bancard |

**MVP de monetización (sin pasarela)**: tablas `plans/subscriptions/usage_alerts` + repos + endpoints CRUD + **gating cuota↔plan** (`usage >= plan.limit` → 402/aviso). Esf. **3–5 días**. Con pasarela (Stripe/Bancard): **+3–5 días**.

---

## 4. 🔴 Notificaciones y recordatorios

| Funcionalidad | Estado | Evidencia | Esf. MVP |
|---|---|---|---|
| Email transaccional | ✅ | `mailer.ts` | — |
| **SMS** | 🔴 sin backend | `SettingsSMS.tsx:24` stub "no configurado"; 0 proveedor en `src/` | M (Twilio/SNS) |
| **Recordatorios automáticos** | 🔴 sin backend | `RemindersAutomated.tsx:180` llama `tekoApi.getReminders?.()` inexistente → fallback mock | M/L (tabla + scheduler + dispatcher) |
| Recordatorios manuales | 🔴 sin backend | `RemindersScheduling.tsx` mismo patrón | incluido arriba |

---

## 5. 🔴 Integraciones / developer experience

| Funcionalidad | Estado | Evidencia | Esf. |
|---|---|---|---|
| Webhooks | ✅ | (ver §1) | — |
| Workflows | ✅ | (ver §1) | — |
| API keys + API `/v1` | ✅ | (ver §1) | — |
| **OAuth 2.0** | 🔴 mock | `IntegrationsOAuth.tsx:144` "Simulamos clientes OAuth"; 0 endpoints `/oauth/*` | M (~2-3 d) |
| **Zapier/Make** | 🔴 mock | `IntegrationsZapier.tsx:49-124` triggers hardcoded; `:160` `setTimeout` | M (~3-4 d) |
| **SDK público + OpenAPI** | ⚫ no existe | sin `/sdk`, sin spec | M (~2 d) |

> Un cliente externo **HOY** ya puede integrar vía API key + `POST /v1/sessions` + webhook firmado. Falta DX (SDK/docs) y los conectores no-code (OAuth/Zapier).

---

## 6. 🟠 Gaps de "SaaS-grade"

| Gap | Estado | Impacto | Esf. |
|---|---|---|---|
| **Signup self-service de tenants** | 🔴 no existe (`POST /tenants` requiere `manage_tenants` = admin-only) | sin onboarding self-serve; hoy es sales-led/manual | L (~2-3 d) |
| **Gating de cuota por plan** | ⚫ no existe | no se puede limitar por tier | M (~1 d) |
| **Invitación/onboarding de operadores** | 🟡 admin-side | sin invite-link self-register | M |
| **faceSearch 1:N escalable** | 🟡 brute-force coseno | OK a baja escala; pgvector pendiente | M (cuando crezca galería) |
| **SettingsStorage S3/cloud** | 🟡 solo disco local | OK on-prem; sin opción cloud en UI | M (no bloqueante) |

---

## 7. Roadmap propuesto a MVP SaaS

**Sprint 0 — Hardening (0.5–1 día)**: Q1 rate-limit bug, Q2/Q3 gates RBAC, Q5/Q6 limpieza dead-code. Rebuild + deploy + test no-lockout.

**Sprint 1 — Monetización-lite (3–5 días)**: tablas `plans/subscriptions/usage_alerts` + repos + endpoints; conectar Billing views al backend; **gating cuota↔plan**; alertas de uso reales (email). SIN pasarela.

**Sprint 2 — Onboarding SaaS (2–3 días)**: signup self-service de tenant + asignación de plan inicial + provisioning de Default app/owner.

**Sprint 3 — DX / integración (2–3 días)**: OpenAPI spec + SDK npm (`@teko/verify-sdk`) + guía de integración + sample code.

**Sprint 4 — Notificaciones (2–3 días)**: SMS (Twilio) + Recordatorios (tabla + scheduler reutilizando `cleanup.ts` cron pattern + dispatcher email/SMS).

**Sprint 5 (opcional/diferible)**: pasarela de pagos, OAuth, Zapier, pgvector, S3.

**Decisión de vistas maqueta**: por cada una (Billing*, SMS, Reminders, OAuth, Zapier) → **implementar** (sprints arriba) o **ocultar/eliminar de v1** para no mostrar features falsas. Recomendación: ocultar lo que no entre en el MVP elegido (no borrar el código, feature-flag).

---

## 8. Decisiones de producto pendientes (del usuario)
1. **Monetización v1**: ¿metering + plan-gating sin pasarela (rápido), o con pasarela integrada (Stripe vs Bancard)?
2. **Vistas maqueta**: ¿cuáles implementar para v1 y cuáles ocultar (feature-flag)?
3. **Onboarding**: ¿signup self-service público, o tenants provisionados a mano (sales-led)?
4. **Orden de sprints**: ¿hardening+monetización primero, o integración/DX primero?
