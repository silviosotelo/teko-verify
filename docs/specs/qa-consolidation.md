# QA de consolidación + pase holístico — Teko Verify

Fecha: 2026-06-17 · Branch: `master` · Server: `soporte@192.168.41.34` (`/home/soporte/teko`) · Dominio: `https://teko.rohekawebservices.online`

Objetivo: tras el build intensivo (P0 workflows/cola/webhooks/timeline+Device&IP; P1 AML/face 1:N/multi-doc/proof-of-address/white-label; Org→App/RBAC), verificar que **todo funcione junto**, reconciliar, endurecer y dejar un build sólido.

## 1. Estado de builds y tests

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` (backend) | **OK**, 0 errores |
| `cd web && npm run build` | **OK** (tsc + vite, 52 módulos) |
| `cd admin && npm run build` | **OK** (sólo warning de chunk-size del template ecme; 0 errores en `teko/*`) |
| `npx vitest run` | **277/277 PASS** (22 archivos) — re-corrido tras el fix, sigue verde |

Árbol git al iniciar: limpio (sin WIP de cortes previos que reconciliar).

## 2. QA holístico end-to-end (lo central)

Se manejó **una sesión completa por el pipeline REAL** del server (motor ONNX + sidecar PaddleOCR + Postgres) con un **workflow que activa los 7 checks**: `document + liveness + match + quality + aml + face_search + proof_of_address`, `review: on_borderline`. Se usó el flujo HTTP real (`/v1/sessions` con `workflowId` → `consent` → `selfie` → `document` → `proof-of-address` → `preview` → `confirm`) con imágenes reales, y se resolvió la cola de revisión vía `applyReviewDecision`. Un listener local + un endpoint de webhook **suscrito** (sin `callbackUrl` por sesión) verificó la entrega firmada.

Veredicto: **TODO junto funciona — 16/16 verificaciones PASS** sobre el build desplegado con el fix.

| Verificación | Resultado |
|---|---|
| Workflow con 7 checks creado + snapshot en la sesión | PASS |
| Flujo HTTP completo (consent/selfie/document/proof-of-address) | PASS |
| `/preview` → estado `review` | PASS |
| **7 checks computados + persistidos** en `verification_checks` | PASS — `[aml, document, face_search, liveness, match, proof_of_address, quality]` |
| **Timeline** `session_events` poblado | PASS — 7 eventos: `session.created, consent.accepted, selfie.captured, document.front/back.captured, proof_of_address.captured, checks.computed` |
| `/confirm` → ruteo a `in_review` (on_borderline) | PASS |
| `applyReviewDecision(approve)` → `verified` | PASS |
| **Webhook disparado** al endpoint suscrito | PASS — 3 entregas firmadas `delivered`: `session.approved, session.status_updated, session.data_updated` |
| `verified_identity` creada al aprobar | PASS |

Números de los checks soft (señales, no rechazo duro), todos computados y persistidos:
- **AML**: `decision=potential_match`, `topScore=0.8444` (cruce contra dataset local).
- **face_search 1:N**: `gallerySize=0`, `duplicateSuspected=false` (galería vacía del tenant de prueba).
- **proof_of_address**: `passed=false`, `nameSimilarity=0` (comprobante de prueba sin match de nombre — fail-closed correcto).

Detalle del admin (auditoría de `admin/src/views/teko/SessionDetail/SessionDetail.tsx`): tabs **Overview, AML/Sanciones, Coincidencias faciales (1:N), Comprobante de domicilio, Eventos (timeline), Device & IP** cableados con panel dedicado; **ID/Liveness/FaceMatch/Calidad** se muestran en la grilla "Resultados de módulos" del Overview + tarjetas (datos personales, autenticidad documental, video/desafíos de liveness). Todos los checks computados se reflejan.

## 3. Bugs de integración encontrados + arreglados

### FIXED — webhooks de suscripción suprimidos por el gate `callbackUrl` (alta confianza)
`src/pipeline.ts :: safeWebhook` hacía `if (!session.callbackUrl) return;` antes de invocar al `WebhookSender`. Pero el subsistema de webhooks (P0 #2) entrega a los **endpoints suscritos del tenant** (`webhook_endpoints`), resueltos por el dispatcher vía `listEnabledByTenant` de forma **independiente** del `callbackUrl` legacy por sesión. Consecuencia: un tenant que use sólo webhooks por suscripción (sin `callbackUrl` por sesión — el modelo nuevo) **no recibía ningún webhook**. El gate predaba a P0 #2.

- **Fix**: se eliminó el early-return; `safeWebhook` siempre delega en `deps.webhook.send`. El dispatcher es fail-open y no crea entregas si no hay destinos, así que el caso vacío sigue cubierto.
- **Evidencia before/after** (mismo e2e, sesión sin `callbackUrl`, sólo endpoint suscrito): build viejo → review `verified` + identidad OK pero **webhook hits=0 / deliveries=0** (bug aislado); build con fix → **3 entregas firmadas `delivered`**.
- **Tests**: los 277 siguen verdes (todas las fixtures de `pipeline.test.ts` setean `callbackUrl`, así que ninguna afirmaba el skip).

## 4. Deploy = código

- Migraciones **0007–0015 todas aplicadas** (verificado en `schema_migrations`, keyed por `filename`). Set completo 0001–0015.
- Se desplegó el fix: `scp src/pipeline.ts` → `docker compose up -d --build teko-verify`. Health post-rebuild: `{engine:true, quality:true, liveness:true, db:true}`.
- Modelos ONNX presentes y cargados (incl. `face_attrib_net.onnx` para el gate de anteojos — la calidad pasa con selfies reales; el `glasses_model_unavailable` visto en una sonda aislada fue artefacto de no inicializar el módulo en ese proceso, no un bug del server).
- Nota: el server **no es repo git** (deploy por `scp` + build). La fuente en `/home/soporte/teko/src` quedó sincronizada con el fix.

## 5. Inconsistencias / limpieza

- **Scratch eliminado**: harness e2e (`scripts/qa-holistic-e2e.mjs`) y sonda (`/tmp/probe.mjs`) borrados de repo local, server y contenedor. Datos de prueba del e2e: **auto-purgados** (el harness borra su propio tenant; verificado: 0 tenants `qa-holi%`, vuelta a 2 tenants / 202 sesiones).
- `applyReviewDecision` reconstruye sólo `quality/document/match/liveness` (omite aml/face_search/proof_of_address). **No es bug**: `decision()` sólo usa esos 4 para la escalera de LoA; aml/face_search/proof_of_address son señales soft (rutean a revisión vía workflow, no otorgan/deniegan LoA). La decisión manual ya vio las señales en la UI.

### PII / datos a PURGAR — REPORTE (no purgado, requiere confirmación)
- **`/tmp/batch/` en el server (192.168.41.34)**: `live/` (selfies) + `print/` (documentos) = ~57 cédulas **reales**. Las copias dentro del contenedor se eliminaron; el original del host **sigue ahí**.
- **202 `verification_sessions` preexistentes** en `teko-postgres-1`: probablemente contienen evidencia/PII real de pruebas históricas. Revisar/retener según política.
- `ADMIN_CREDENTIALS.local.txt` (raíz del repo): contiene credenciales; correctamente **gitignored** (`*.local.txt`), sólo local.
- `.playwright-mcp/ocr-debug-verification.png`: artefacto de debug **trackeado** en git (preexistente). Candidato a sacar del tracking.

## 6. Diferidos (P2)

1. **Admin — panel de detalle de FaceMatch**: el check `match` sólo muestra el coseno en la grilla "Resultados de módulos" del Overview; no tiene panel dedicado como AML/1:N/proof-of-address. Mejora de UX (la data está; falta superficie).
2. **`POST /admin/test-verify`**: su workflow efímero sólo cablea `aml` (además de document/match/quality). No activa `face_search`, `proof_of_address` ni liveness activo. El flujo completo SÍ funciona vía workflows reales (`/v1/sessions` + `workflowId`); el "Probar verificación" rápido del admin queda corto para los checks P1. Ampliar el snapshot efímero a los 7 checks.
3. **Higiene de repo**: sacar `.playwright-mcp/ocr-debug-verification.png` del tracking; evaluar retención de las 202 sesiones de prueba.
