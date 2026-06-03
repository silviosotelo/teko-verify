# Teko Verify — Plan de implementación

- **Fecha:** 2026-06-03
- **Estado:** Plan aprobado para ejecución
- **Spec fuente de verdad:** `docs/specs/2026-06-03-teko-verify-kyc-design.md`
- **Contrato canónico:** `src/types.ts` (todas las interfaces de módulos, datos y APIs)
- **Base reusada:** engine de v9 (`src/engine.ts`: SCRFD detect+landmarks, Umeyama align 112, ArcFace facenox → 512D), patrón SSE (`src/events.ts`), Express (`src/server.ts`), `pg`, `sharp`.

---

## 0. Principios que gobiernan todo el plan

- **TypeScript estricto**; `src/types.ts` es el contrato — ningún módulo define interfaces propias que dupliquen las del contrato.
- **Multi-tenant duro:** `tenant_id` en TODA tabla y TODA query. Cada acceso a datos pasa por un repo que recibe `tenantId` y lo aplica en el `WHERE`. Test de denegación cross-tenant es obligatorio (§10).
- **Fail-closed:** un error (modelo no carga, sidecar OCR caído, excepción) nunca produce `verified`; produce `error`/`rejected`. `decision()` con señales faltantes devuelve `L0`/`rejected`.
- **Reuso del engine:** se usa SOLO `engine.detect`, `engine.alignToRaw`, `engine.embedFromRaw`, `engine.embedBestFace`. `gallery.ts` NO se usa (match es 1:1).
- **Módulos chicos y testeables:** cada módulo del pipeline es una función pura sobre buffers/embeddings que devuelve el tipo del contrato; la I/O (DB, disco) vive en repos separados.

---

## Orden de hitos (spine de dependencias)

```
M0 Andamiaje (types ✓, config, migraciones, repos, errores)
        │
M1 Tenancy (tenants + api_keys + auth Bearer + aislamiento)
        │
M2 Sesiones (máquina de estados + link_token + idempotencia)
        │
M3 Captura web + evidencia + consentimiento (uploads, SSE/polling)
        │
   ├─ M4 Quality (engine.detect + pose/brillo/nitidez + anti-anteojos)
   ├─ M5 Match 1:1  ─┐  (pure; testeable temprano con embeddings mock)
   ├─ M6 Decision   ─┘  (pure; testeable temprano con checks mock)
   ├─ M7 Document (PaddleOCR sidecar + MRZ TD1 + barcode + autenticidad)
   └─ M8 Liveness (PAD anti-spoof + desafío activo opcional)
        │
M9 Orquestación del pipeline (secuencial, cortocircuito, persistencia, LoA)
        │
M10 Webhooks firmados (HMAC + reintentos + dead-letter)
        │
M11 Admin dashboard (auth operador/roles, tenants, keys, revisión, métricas, export)
        │
M12 Despliegue (Docker compose node+sidecar, túnel CF, retención, observabilidad)

X  Calibración de umbrales — tarea transversal de primera clase (§10), depende del eval set
```

**M5 y M6 son funciones puras** dado su input → se implementan y testean temprano (early wins), sin esperar a document/liveness. **No** se las anida dentro de los módulos ML.

---

## Hitos detallados

### M0 — Andamiaje del servicio
**Entregables**
- `src/types.ts` — ✓ ya escrito (contrato canónico).
- `src/config.ts` — extender: `PORT=4400`, `DATABASE_URL` de base `teko`, rutas de modelos (detector/recognizer/anti-spoof/anti-anteojos), `TOKEN_TTL`, umbrales por defecto (match 1:1, liveness, glasses), `EVIDENCE_DIR`, `OCR_SIDECAR_URL`, `WEBHOOK_HMAC_SECRET`, `ADMIN_JWT_SECRET`. Todo por env, con defaults.
- `migrations/` — SQL versionado (`001_init.sql` …) con las 8 tablas de §5 + `webhook_deliveries` + `admin_operators`. Toda tabla con `tenant_id` e índices por `(tenant_id, …)`. Runner de migraciones idempotente al arranque.
- `src/db.ts` — `Pool` único (patrón events.ts) + helper de transacción.
- `src/repos/` — un repo por tabla; firma uniforme `fn(tenantId, …)`. El repo es el único lugar que toca SQL.
- `src/errors.ts` — jerarquía de errores: `RecoverableError` (→ needs_recapture), `RejectError` (→ rejected), `SystemError` (→ error/5xx). Mapeo central a HTTP. Garantía fail-closed.

**Cómo se testea:** unit del runner de migraciones contra PG efímero; unit de cada repo (insert/get scoped por tenant). Test de que `SystemError` jamás produce estado `verified`.

---

### M1 — Tenancy (tenants, api_keys, auth)
**Depende de:** M0.
**Entregables**
- `src/tenants.ts` — alta/gestión de tenants; merge de `TenantPolicy` con defaults; CRUD de API keys.
- API keys: generar secreto, persistir SOLO `keyHash` (sha256) + `prefix`; devolver el plano una única vez (`CreateApiKeyResponse`).
- `src/middleware/tenantAuth.ts` — middleware Bearer: extrae key, hashea, busca por hash, valida `status=active`, inyecta `tenantId` en el request, actualiza `lastUsedAt`. Rate-limit por tenant.

**Cómo se testea:** unit hash/verify de key; **test de seguridad cross-tenant**: key del tenant A no puede leer datos del tenant B (debe 404/403). Test de key revocada → 401.

---

### M2 — Sesiones + máquina de estados
**Depende de:** M1.
**Entregables**
- `src/sessions.ts` — crear sesión (snapshot de `assuranceRequired` desde la policy), generar `link_token` (un solo uso, inadivinable, `expiresAt`), idempotencia por `(tenantId, externalRef)`.
- Transiciones válidas de `SessionState` centralizadas (created→capturing→processing→verified|rejected|needs_recapture|expired|error). Toda transición → `audit_log`.
- `recaptureCount` se incrementa al volver a needs_recapture; al superar `maxRecaptureAttempts` → `rejected`.
- Endpoints tenant: `POST/GET/DELETE /v1/sessions`, `GET /v1/sessions/:id`.

**Cómo se testea:** unit de la tabla de transiciones (transición inválida lanza). Unit de idempotencia (mismo externalRef → misma sesión). Unit de expiración por TTL. Test de DELETE → supresión (§12).

---

### M3 — Captura web + evidencia + consentimiento
**Depende de:** M2.
**Entregables**
- `src/middleware/tokenAuth.ts` — auth por `link_token`: valida existencia/no-uso/no-expiración, inyecta sesión+tenant.
- `src/evidence.ts` — guardar selfie/frames/doc_front/doc_back a disco/CIFS (patrón events.ts), calcular `sha256`, fila en `evidence`.
- `src/consent.ts` — registrar `Consent` (texto/versión/ip) — bloquea la captura hasta aceptar.
- Endpoints captura: `GET /verify/:token` (sirve SPA), `POST .../consent|selfie|document|submit`, `GET .../status` (SSE con fallback polling — lección Cloudflare §11).
- `web/` — SPA mobile-first: consentimiento → selfie (guía + frames) → doc frente → doc dorso → procesando (SSE) → resultado/redirect. MediaPipe solo para encuadre (UX), no autoritativo.

**Cómo se testea:** unit de tokenAuth (token usado/expirado → rechazo). Unit de hashing de evidencia. E2E parcial con Playwright + cámara falsa subiendo imágenes (se completa en M9).

---

### M4 — Quality (anti-anteojos + gating)
**Depende de:** M3 (evidencia disponible). Reusa `engine.detect`.
**Entregables**
- `src/quality.ts` — `quality(image): QualityResult`. SCRFD → `faceOk`; luma media → `brightness`; varianza Laplaciano → `sharpness`; landmarks5 → `pose` (yaw/pitch/roll); modelo anti-anteojos (face_attrib_net TFLite→ONNX) → `glassesPct`. Gating con umbrales de config/policy → `passed` + `reasons`. Recuperable → needs_recapture.

**Cómo se testea:** unit con fixtures (cara nítida frontal pasa; blur/anteojos/sin-cara/pose fallan con el `reason` correcto). **Riesgo:** paridad TFLite→ONNX del anti-anteojos (§14) → fallback sidecar py-tflite.

---

### M5 — Match 1:1 (early win, pure)
**Depende de:** engine (M0). No depende de document/liveness.
**Entregables**
- `src/match.ts` — `match(selfieEmb, docFaceEmb): MatchResult`. Coseno (producto punto de vectores L2). Umbral 1:1 de config/policy (≠ 1:N de v9). `threshold` incluido en el resultado para auditoría.

**Cómo se testea:** unit puro con pares de embeddings (mismo/distinto → passed correcto respecto al umbral). Sin I/O.

---

### M6 — Decision + LoA (early win, pure)
**Depende de:** types (M0). No depende de los módulos ML.
**Entregables**
- `src/decision.ts` — `decision(checks: PipelineChecks, policy: TenantPolicy): Decision`. Reglas LoA:
  - L1: document.passed + quality.passed.
  - L2: L1 + match.passed.
  - L3: L2 + liveness.passed.
  - Falla cualquier rechazo duro → `verdict=rejected`, `loa="L0"`, reasons.
  - LoA acreditado < `assuranceRequired` → `rejected` (fail-closed).
  - Señal recuperable faltante (quality) → `needs_recapture`.

**Cómo se testea:** unit exhaustivo con matrices de checks → LoA/veredicto esperado, incluyendo todos los caminos de rechazo y el piso L0.

---

### M7 — Document (MRZ TD1 + OCR + barcode + autenticidad)
**Depende de:** M3. Necesita el sidecar PaddleOCR.
**Entregables**
- `sidecar/` — servicio Python PaddleOCR (HTTP en red interna del compose). Fail-closed: sidecar caído → `SystemError`, nunca passed.
- `src/document.ts` — `document(front, back): DocumentResult`:
  - dorso: OCR de las 3 líneas TD1 → parser `mrz` (ICAO 9303, dígitos verificadores) → `MrzData`; barcode 1D `zxing` Code128 → `BarcodeData`.
  - frente: PaddleOCR → `OcrData.fields`.
  - recorte de foto del titular (SCRFD sobre el frente) → `DocFaceCrop` (input del match).
  - `authenticity`: cruces MRZ↔OCR (nombre/nº), dígitos verificadores, no-vencido, nº doc ↔ serial barcode. Inconsistencia/vencimiento → rechazo duro.

**Cómo se testea:** unit con fixtures de cédula (MRZ válida/ inválida, vencida, mismatch nombre, barcode legible/ilegible). Medir precisión OCR (no adivinar, §10). **Riesgos:** precisión MRZ-OCR en foto de celular; sidecar como punto de fallo.

---

### M8 — Liveness (PAD)
**Depende de:** M3 (selfie + frames).
**Entregables**
- `src/liveness.ts` — `liveness(selfie, frames?, challenge?): LivenessResult`. PAD pasivo Silent-Face/MiniFASNet (onnx) → `score`/`attackType`. Desafío activo opcional (parpadeo/giro) sobre frames si la policy lo exige → `challengePassed`. Rechazo duro fail-closed.

**Cómo se testea:** unit con fixtures live/print/replay. **Calibración FAR/FRR** se hace en la tarea X con el eval set.

---

### M9 — Orquestación del pipeline
**Depende de:** M4–M8.
**Entregables**
- `src/pipeline.ts` — ejecuta secuencial con cortocircuito (orden a→e de §6): quality → liveness → document → match → decision. Cada paso persiste `verification_check`; al final `verified_identity` (embedding Float32Array → bytea) + `result` + `audit_log`. Errores mapeados por `errors.ts` (recuperable/duro/sistema). Dispara estados y empuja eventos SSE a la captura.

**Cómo se testea:** **integración** sobre fixtures completas → estado/LoA esperado por cada escenario (verified L3, rejected por spoof, needs_recapture por blur, rejected por mismatch, error por sidecar caído). E2E Playwright con cámara falsa → verified/rejected.

---

### M10 — Webhooks firmados
**Depende de:** M9.
**Entregables**
- `src/webhooks.ts` — al completar: `WebhookPayload` (`session.verified`/`rejected`) firmado HMAC (header), POST a `callback_url`, reintentos con backoff, `webhook_deliveries` + dead-letter.

**Cómo se testea:** unit de firma HMAC (verificable por el receptor). Test de reintento/backoff y dead-letter con servidor mock que falla N veces. **Test de seguridad:** firma inválida rechazada (§10).

---

### M11 — Admin dashboard
**Depende de:** M1–M10 (consume todo).
**Entregables**
- `src/admin/` — APIs `/admin/*` (separadas de las del tenant): auth de operador (JWT) + roles (`AdminLoginResponse`, `AdminRole`), CRUD tenants/policies, crear/rotar/revocar keys, revisión de sesiones+checks+evidencia (`AdminSessionDetailResponse`), métricas (`AdminMetricsResponse`), export de auditoría.
- `admin/` (UI) — dashboard servido por el servicio con auth/roles propios.

**Cómo se testea:** unit de auth/roles (reviewer no puede crear tenants). Test de export de auditoría. Test cross-tenant en vistas admin scoped.

---

### M12 — Despliegue
**Depende de:** todo.
**Entregables**
- `Dockerfile` + `docker-compose.yml`: node (4400) + sidecar Python PaddleOCR en red interna, `--restart unless-stopped`. PG `teko` dedicado. Túnel Cloudflare propio (HTTPS para getUserMedia; SSE con fallback polling). Job de retención por policy de tenant (borra evidencia/biometría vencida, §12). Observabilidad: logs estructurados + `audit_log` + `/health` + métricas (sesiones/min, tasa aprobación, latencia por módulo).

**Cómo se testea:** smoke de arranque (migraciones corren, health OK, modelos cargan). Test del job de retención (borra lo vencido, conserva lo vigente).

---

### Tarea X — Calibración de umbrales (transversal, primera clase)
**Depende de:** eval set etiquetado (selfies + cédulas reales/spoof/mismatch/vencidas). **Riesgo/bloqueo abierto (§14):** de dónde sale el eval set (posible reuso del dataset OCR médico).
**Entregables**
- Harness de evaluación: liveness FAR/FRR, umbral match 1:1 (foto de doc vieja/baja-res), precisión OCR. Resultados → defaults de config y `TenantPolicy.thresholds`. **Medir, no adivinar** (§10).

**Cómo se testea:** corre el eval set y reporta métricas; los umbrales elegidos se fijan como defaults versionados.

---

## Mapa de testing por tipo (§10)
- **Unit por módulo** con fixtures: quality, liveness, document, match, decision (M4–M8).
- **Integración** del pipeline completo → decisión/LoA esperada (M9).
- **E2E** Playwright + cámara falsa → verified/rejected (M3+M9).
- **Seguridad:** reuso/expiración de token (M3), cross-tenant denegado (M1/M11), rate-limit (M1), firma de webhook (M10).
- **Calibración** como tarea propia (X).

## Riesgos (resumen)
1. Paridad TFLite→ONNX del anti-anteojos (§14) → fallback sidecar py-tflite.
2. Sidecar PaddleOCR como punto único de fallo → debe fail-closed (down ≠ verified).
3. Buffering de SSE en el quick-tunnel Cloudflare (§11) → fallback polling.
4. Umbral match 1:1 contra foto de cédula vieja/baja-res → parámetro calibrable.
5. Precisión MRZ/OCR en captura de celular → medir en eval set.
6. Eval set etiquetado (reales/spoof/mismatch/vencidas) es un bloqueo abierto para la calibración (§14).
