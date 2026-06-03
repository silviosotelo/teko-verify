# Teko Verify — Diseño (KYC / Onboarding verificado)

- **Fecha:** 2026-06-03
- **Estado:** Aprobado (diseño) — pendiente de plan de implementación
- **Producto:** **Teko** (plataforma de identidad electrónica). *teko* = "ser / identidad / modo de vida" (guaraní).
- **Sub-proyecto:** **Teko Verify** = KYC documental + onboarding verificado.
- **Base:** copia independiente del motor de v9 (face recognition).

---

## 1. Contexto y background

### 1.1 Visión: Teko (plataforma de identidad)
Inspirada funcionalmente en MIA (miaid.me): plataforma de identidad electrónica. La visión completa se descompone en sub-proyectos independientes (cada uno con su propio spec → plan → implementación):

| # | Sub-proyecto | Qué es | MIA equiv. | Depende de |
|---|---|---|---|---|
| A | Núcleo de identidad + plataforma | Modelo de identidad, LoA, API gateway, multi-tenant, consentimiento + auditoría | EVAN (core) | — |
| **B** | **Teko Verify (KYC/onboarding)** | **Liveness + calidad/anti-anteojos + verificación 1:1 + KYC documental cédula PY** | VERIFY | A + motor de caras |
| C | Teko Vault (credenciales) | Credenciales verificables W3C VC + DID, selective disclosure, ZKP | VAULT | A + B |
| D | Teko Keys (auth passwordless) | Login biométrico, MFA, SSO, SCA, recuperación | MIA KEYS | A + C |
| E | Teko Sign (firma) | Firma biométrica, aprobaciones | SIGN | A + C + D |

### 1.2 Por qué B primero
- Reusa el motor de v9 (activo ya probado).
- Es el prerrequisito real de A/C/D/E: no se emite identidad electrónica sin verificar primero quién es la persona.
- Entrega valor demostrable de punta a punta.

### 1.3 Decisión sobre SSI (diferida)
La visión "SSI real estilo MIA" (DIDs, VC firmadas, wallet del usuario con sus claves) **exige una wallet = app móvil**, lo que contradice la decisión actual de no trabajar en app. Se difiere el núcleo SSI (sub-proyecto A/C) hasta tener KYC funcionando. Si más adelante se busca SSI self-sovereign real, será necesario construir una wallet (app). Nota técnica para el futuro: para greenfield 2026 conviene **SD-JWT-VC + OpenID4VCI/OID4VP + DIDs ledgerless (did:web/did:jwk)** (camino eIDAS 2 / EUDI) por sobre DIDComm/Aries (stack más viejo de MIA), y construir sobre un framework maduro (Credo-TS / Walt.id / Veramo), nunca cripto a mano.

---

## 2. Objetivos / No-objetivos

### Objetivos (Teko Verify)
- KYC documental completo on-prem: **liveness + calidad/anti-anteojos + lectura/validación de cédula PY + verificación 1:1 selfie↔documento**.
- Producir una **identidad verificada** con **nivel de aseguramiento (LoA)** + auditoría.
- **Multi-tenant** desde el día 1.
- Superficie de captura: **página web hospedada** (verification link, sin app).
- 100% **on-prem** (datos sensibles de salud + cédulas no salen a terceros).

### No-objetivos (en este sub-proyecto)
- Credenciales verificables / DID / wallet (sub-proyecto C).
- Auth passwordless / SSO / firma (D, E).
- Peritaje físico de seguridad del documento (hologramas/UV — imposible desde foto de celular).
- Reuso de la galería de enrolados de v9/v6 (Teko arranca con base vacía).

---

## 3. Decisiones clave (cerradas en brainstorming)

1. **Objetivo v10:** plataforma de identidad completa (estilo MIA) → descompuesta; se arranca por **B (KYC)**.
2. **Multi-tenant** desde el núcleo.
3. **SSI diferido** (ver 1.3).
4. **Captura:** página web hospedada (getUserMedia, verification link).
5. **Build vs buy:** **on-prem 100% / build** (modelos open-source).
6. **Arquitectura:** **copiar todo el código de v9 a un servicio independiente (v10/Teko)** — sin dependencia de runtime de v9, sin hop HTTP. Costo aceptado: duplicación de código (portar fixes del engine a mano).
7. **Sin enrolados:** se copia el **código** del engine, **no** la galería.
8. **PostgreSQL propio** y dedicado (no reusar el PG de v6 que lee v9).
9. **Marca:** **Teko**; sub-proyecto = **Teko Verify**.
10. **OCR:** **PaddleOCR** (sidecar Python) por precisión en documentos.

---

## 4. Arquitectura general

- Servicio independiente **`teko-verify`** en el server 34. Árbol nuevo (p.ej. `/home/soporte/teko`), copia del código de `fr-v9` + módulos KYC.
- Contenedor Docker propio, **puerto 4400**, **PostgreSQL propio** (base `teko`), **túnel Cloudflare propio** (HTTPS necesario para getUserMedia).
- Cero dependencia de runtime de v9.

### Heredado de v9 (copiado)
`engine.ts` (SCRFD-10G detect + landmarks + alineación Umeyama 112×112 + ArcFace facenox recognizer.onnx → embedding 512D), `config.ts`, modelos `.onnx`, patrón `events.ts` (SSE), `server.ts`.

**Nota sobre `gallery.ts`:** en Teko Verify el match es **1:1** (selfie ↔ foto del documento), por lo que el matcher 1:N por fuerza bruta de v9 **no se usa**. Se reusa solo la generación de embeddings del `engine`. `gallery.ts` se descarta (o se conserva únicamente si más adelante se quiere dedup 1:N sobre datos propios de Teko, ver §13).

### Módulos nuevos (cada uno acotado y testeable)
| Módulo | Responsabilidad |
|---|---|
| `sessions.ts` | Ciclo de vida de la sesión de verificación (multi-tenant, token de link, máquina de estados) |
| `liveness.ts` | PAD pasivo (anti-spoof) + verificación de desafío activo opcional |
| `quality.ts` | Anti-anteojos + brillo/nitidez/pose gating |
| `document.ts` | Cédula PY: PDF417 + MRZ + OCR + recorte de foto + autenticidad por cruce |
| `match.ts` | Verificación 1:1 selfie↔foto del documento |
| `decision.ts` | Combina señales → identidad verificada + LoA + motivos |
| `identities.ts` | Store de identidades verificadas + evidencia |
| `tenants.ts` | Tenants + API keys + aislamiento |
| `web/` | Página de captura en navegador (getUserMedia) |

### Stack on-prem (server 34)
node + onnxruntime-node + sharp + pg + express (heredado) · PaddleOCR (sidecar Python) · decodificador PDF417 (zxing-cpp wasm / `pdf417-decoder`) · parser MRZ (`mrz`) · modelo PAD anti-spoof (Silent-Face / MiniFASNet onnx) · modelo de anteojos (Qualcomm face_attrib_net convertido TFLite→ONNX) · MediaPipe Face Detection (solo UX in-browser).

---

## 5. Modelo de datos (PostgreSQL propio, multi-tenant)

Todas las tablas llevan `tenant_id`; toda query/API key queda scopeada a su tenant.

| Tabla | Campos clave | Para qué |
|---|---|---|
| `tenants` | id, nombre, slug, estado, `policies` JSONB (LoA requerido, retención, desafíos liveness) | Organizaciones consumidoras |
| `api_keys` | id, tenant_id, key_hash, label, scopes, estado, last_used | Auth por tenant (hash, nunca plano) |
| `verification_sessions` | id, tenant_id, external_ref, **estado**, link_token, callback_url, assurance_required, redirect_url, expires_at, completed_at, result JSONB | Una verificación = una sesión |
| `verification_checks` | id, session_id, tenant_id, tipo (liveness\|quality\|document\|match), score, passed, detail JSONB | Resultado granular por módulo (auditable) |
| `verified_identities` | id, tenant_id, session_id, ci, nombre, fecha_nac, nacionalidad, tipo_doc, **assurance_level**, face_embedding (bytea 512D), created_at | Identidad verificada resultante |
| `evidence` | id, session_id, tenant_id, tipo (selfie\|doc_front\|doc_back\|frames), storage_path, sha256 | Imágenes en disco/CIFS (patrón v9) + hash de integridad |
| `audit_log` | id, tenant_id, session_id, actor, evento, detail JSONB, ip, created_at | Traza para cumplimiento |
| `consents` | id, session_id, tenant_id, texto/version, aceptado_at, ip | Consentimiento explícito (dato biométrico) |

**Privacidad/retención:** retención configurable por tenant (borrado de evidencia/biometría); `face_embedding` separable de las imágenes; `consents` deja registro legal del tratamiento de dato biométrico.

---

## 6. Flujo de verificación + LoA

1. **Tenant crea sesión** (`POST /v1/sessions`): `external_ref`, `callback_url`, `assurance_required` (L1/L2/L3), `redirect_url`, `locale` → `{session_id, verification_url, expires_at}`.
2. **Usuario abre el link** → consentimiento (registra `consents`) → captura.
3. **Captura web** (getUserMedia): selfie (+ frames cortos para liveness) + cédula frente + dorso.
4. **Pipeline server-side (secuencial, cortocircuito, fail-closed):**

| Orden | Módulo | Hace | Si falla |
|---|---|---|---|
| a | `quality` | Detecta cara (SCRFD), brillo/nitidez/pose + anti-anteojos | needs_recapture |
| b | `liveness` | PAD anti-spoof (+ desafío activo si la policy lo exige) | rejected |
| c | `document` | PDF417 (dorso) + MRZ + OCR (frente) → datos; recorta foto; autenticidad por cruce PDF417↔MRZ↔OCR | rejected |
| d | `match` | Embedding(selfie) vs embedding(foto-doc) → coseno | rejected |
| e | `decision` | Combina los 4 → verified/rejected + LoA + motivos | — |

5. **Persistencia:** `verified_identity` + `verification_checks` + `evidence` + `audit_log`.
6. **Callback/webhook** firmado al tenant + resultado vía `GET /v1/sessions/:id`.

**Máquina de estados:** `created → capturing → processing → verified | rejected | needs_recapture | expired`.

**Niveles de aseguramiento (LoA), configurable por tenant:**
- **L1:** documento legible + datos consistentes (sin match ni liveness).
- **L2:** L1 + match 1:1 doc↔selfie OK.
- **L3:** L2 + liveness OK (persona viva presente). ← objetivo del flujo completo.

**Contratos de módulos:**
- `quality(image)` → `{faceOk, brightness, sharpness, pose, glassesPct, passed, reasons[]}`
- `liveness(selfie, frames?, challenge?)` → `{score, passed, attackType?}`
- `document(front, back)` → `{pdf417{}, mrz{}, ocr{}, docFaceCrop, authenticity{consistent, checks[]}, passed}`
- `match(selfieEmb, docFaceEmb)` → `{cosine, passed}`
- `decision(checks, tenantPolicy)` → `{decision, loa, reasons[]}`

---

## 7. Módulos ML (todo on-prem)

| Módulo | Modelo / librería | Runtime | Notas |
|---|---|---|---|
| Detect/align/embed | SCRFD-10G + ArcFace facenox (de v9) | onnxruntime-node | Base de todo |
| Quality/pose | Landmarks SCRFD (yaw/pitch/roll) + luma/Laplaciano | node | Brillo, nitidez, frontalidad |
| Anti-anteojos | Qualcomm face_attrib_net (TFLite→ONNX) | onnxruntime-node | Ojos abiertos, anteojos, máscara, lentes sol. Paridad con lo validado en Flutter |
| Liveness/PAD | Silent-Face-Anti-Spoofing (MiniFASNet) | onnxruntime-node | Pasivo, RGB, print/replay. Opcional: desafío activo (parpadeo/giro en frames) |
| PDF417 (dorso) | zxing-cpp (wasm) / `pdf417-decoder` | node | Datos estructurados confiables |
| MRZ (ICAO 9303) | OCR de líneas + parser `mrz` (dígitos verificadores) | node + OCR | OCR-B muy legible |
| OCR visual (frente) | **PaddleOCR** (sidecar Python) | python | Mejor precisión en cédulas |
| Match 1:1 | engine: coseno(selfie, foto-doc) | onnxruntime-node | Umbral propio (1:1 ≠ 1:N), calibrable |
| Decisión/LoA | reglas por policy de tenant | node | Fusión ML más adelante |

---

## 8. APIs + página de captura

### A) API del tenant (Bearer API key)
| Endpoint | Hace |
|---|---|
| `POST /v1/sessions` | Crea verificación → `{session_id, verification_url, expires_at}` |
| `GET /v1/sessions/:id` | Estado + resultado (decision, loa, datos extraídos, scores, evidencia) |
| `GET /v1/sessions` | Listado con filtros |
| `DELETE /v1/sessions/:id` | Borrado de evidencia/identidad (derecho a supresión) |
| `POST /v1/tenants` · `POST /v1/tenants/:id/api-keys` | Alta de tenants y keys (consola/admin) |

**Webhook:** `POST callback_url` firmado HMAC al completar (`session.verified` / `session.rejected`), reintentos con backoff + dead-letter.

### B) Captura del usuario (auth por `link_token`)
| Endpoint | Hace |
|---|---|
| `GET /verify/:token` | Sirve la web app de captura |
| `POST /verify/:token/consent` | Registra consentimiento |
| `POST /verify/:token/selfie` | Sube selfie + frames |
| `POST /verify/:token/document` | Sube cédula frente + dorso |
| `POST /verify/:token/submit` | Dispara el pipeline (o auto al completar uploads) |
| `GET /verify/:token/status` | Estado (SSE + fallback polling) |

### Página de captura (`web/`)
SPA liviana mobile-first servida por el servicio. Pasos: `consentimiento → selfie (guía de encuadre + frames + desafío activo opcional) → cédula frente (guía anti-reflejo) → cédula dorso (encuadre PDF417) → "procesando" (SSE) → resultado/redirect`. Pistas de encuadre con MediaPipe Face Detection (solo UX); liveness/calidad/anti-spoof autoritativo corre server-side.

### Seguridad
API keys con hash; webhooks firmados HMAC; `link_token` de un solo uso, expirable e inadivinable; rate-limit por tenant; CORS acotado.

---

## 9. Manejo de errores (fail-closed: un crash nunca produce "verified")

| Tipo | Casos | Acción |
|---|---|---|
| Recuperable → `needs_recapture` | Calidad (blur, anteojos, pose, sin cara), documento ilegible, mala luz | Guía + reintento (máx. 3) |
| Rechazo duro → `rejected` | Liveness falla (spoof), mismatch doc↔selfie, inconsistencia/vencimiento del doc, máx. intentos | Sesión rechazada + motivo + webhook |
| Expiración → `expired` | TTL del `link_token` | Link inválido |
| Error de sistema → 5xx | Modelo no carga, sidecar OCR caído, DB | Sesión `error`, alerta, reintentable; nunca verified |

- Idempotencia en creación de sesión y uploads. Webhooks con reintento+backoff y dead-letter.

---

## 10. Testing

- **Unit por módulo** (aislado/mockeable) con fixtures de imágenes: quality, liveness, document (PDF417/MRZ/OCR/autenticidad), match, decision.
- **Set de evaluación etiquetado** (selfies + cédulas reales/spoof/mismatch/vencidas) → **calibración de umbrales como tarea de primera clase**: liveness FAR/FRR, umbral match 1:1, precisión OCR (medir, no adivinar).
- **Integración:** pipeline completo sobre fixtures → decisión/LoA esperada.
- **E2E:** tenant de prueba + Playwright manejando la página de captura con cámara falsa → verified/rejected.
- **Seguridad:** reuso/expiración de token, **acceso cross-tenant (debe denegarse)**, rate-limit, firma de webhook.

---

## 11. Despliegue

- Docker `teko-verify`: node (principal) + sidecar Python PaddleOCR (compose, red interna). `--restart unless-stopped`.
- **PostgreSQL propio** (base `teko` dedicada). **Migraciones SQL versionadas**.
- **Túnel Cloudflare propio** (HTTPS para getUserMedia). **Ojo:** SSE se buffea en el quick-tunnel (lección v9) → fallback polling.
- Config por env (puertos, `DATABASE_URL` de teko, rutas de modelos, TTL de token, umbrales).
- Evidencia en disco/CIFS (patrón v9) + job de retención.
- Observabilidad: logs estructurados + `audit_log` + health + métricas (sesiones/min, tasa de aprobación, latencia por módulo).

---

## 12. Límites honestos (alcance realista)
- **Liveness pasivo** cubre foto/pantalla (print/replay); no garantiza contra máscaras 3D sofisticadas → desafío activo opcional como refuerzo.
- **Autenticidad documental** desde foto de celular = cruce de datos (PDF417↔MRZ↔OCR) + dígitos verificadores + vencimiento; **no** es peritaje físico (hologramas/UV).
- **Match 1:1** contra foto de cédula vieja/baja-res requiere calibración de umbral (desafío clásico de KYC) → parámetro tuneable.

---

## 13. Preguntas abiertas / futuro
- Consola de administración de tenants (¿alcance en B o posterior?).
- Normativa PY de protección de datos personales / dato biométrico (revisar para el texto de consentimiento y retención).
- Set de evaluación: ¿de dónde salen cédulas etiquetadas para calibrar? (posible reuso del background de dataset OCR médico).
- Origen de la conversión Qualcomm TFLite→ONNX (validar que onnxruntime-node corre el modelo convertido con paridad).
- Sub-proyecto A (núcleo SSI) y C (credenciales) quedan para specs futuros.
