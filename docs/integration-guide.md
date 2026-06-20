# Teko Verify — Guía de integración

Esta guía describe cómo integrar **Teko Verify** (KYC / verificación de identidad) en tu producto: autenticación, creación de verificaciones, el modelo **hosted**, estados, webhooks firmados y consulta de la decisión. Todos los contratos están verificados contra el código del server (`src/api/tenant.ts`, `src/admin/router.ts`, `src/webhooks/*`).

- **Base URL (producción on-prem):** `https://teko.rohekawebservices.online`
- **Panel admin:** `https://teko.rohekawebservices.online/admin-ui`
- **SDK server-side:** ver [`/sdk`](../sdk/README.md) (`@teko/verify-sdk`).

El flujo es **hosted**: tu backend crea una sesión, recibe un `verificationUrl`, y redirige al titular a esa URL. Teko corre la captura (documento + selfie), los checks y la decisión, y te notifica por webhook. Tu backend consulta el resultado.

---

## 1. Autenticación

La API del tenant (`/v1/*`) se autentica con una **API key** del tenant vía header Bearer:

```
Authorization: Bearer tk_live_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxx
```

- Formato: `tk_live_<id8>_<random>`. El server guarda **sólo el hash SHA-256**; el secreto plano se muestra **una sola vez** al crearla.
- La key deriva el **tenant** (organización) y, opcionalmente, la **app** (proyecto) a la que pertenece. Todo el scope de datos queda atado a ese tenant.
- Fail-closed: sin key, key inválida o tenant inactivo → `401`.

### Crear una API key (panel admin)

Desde el panel admin (operador autenticado), o vía la API admin:

```
POST /admin/tenants/:tenantId/api-keys
Authorization: Bearer <admin-session-token>
Content-Type: application/json

{ "label": "backend-prod", "appId": "<opcional>", "scopes": ["sessions:read","sessions:write"] }
```

Respuesta (**el secreto `apiKey` se devuelve UNA sola vez**):

```json
{
  "id": "…",
  "prefix": "tk_live_xxxxxxxx",
  "apiKey": "tk_live_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxx",
  "label": "backend-prod",
  "scopes": ["sessions:read", "sessions:write"],
  "createdAt": "…"
}
```

Guardá `apiKey` en un secreto del backend. Para revocar: `DELETE /admin/tenants/:tenantId/api-keys/:keyId`.

---

## 2. Crear una verificación

```
POST /v1/sessions
Authorization: Bearer <api-key>
Content-Type: application/json
```

### Body (todos los campos son opcionales)

| Campo | Tipo | Descripción |
|---|---|---|
| `externalRef` | string | Tu referencia (p.ej. el id de usuario). **Da idempotencia**: repetir la misma `externalRef` devuelve la **misma** sesión (status `200`), no crea otra. |
| `email` | string | Si se envía, el server le manda el `verificationUrl` al titular por email (fail-open: no rompe la creación). Se valida el formato (`400 invalid_email`). |
| `workflowId` | string | Workflow concreto (versión) a usar. Si se omite, se usa el workflow default que mapea al LoA pedido. |
| `assuranceRequired` | `"L0"`..`"L4"` | Nivel de aseguramiento pedido. El nivel **efectivo** lo deriva el workflow resuelto. Default: política del tenant. |
| `documentType` | string | Tipo de documento esperado (whitelist; default `ci_py`). `400 invalid_document_type` si no es válido. |
| `appId` | string | App (proyecto) bajo la org. Precedencia: `appId` del body → app de la API key → app Default. `400 app_not_found` si no existe. |
| `callbackUrl` | string | URL que recibe los webhooks de **esta** sesión (firmada con el secreto del tenant). Suscrita implícitamente a **todos** los eventos. |
| `redirectUrl` | string | A dónde redirigir al titular al terminar el flujo hosted. |
| `locale` | string | Locale de la UI hosted (p.ej. `es`). |

### Respuesta

`201 Created` (o `200 OK` si fue idempotente sobre una `externalRef` existente):

```json
{
  "sessionId": "…",
  "verificationUrl": "https://teko.rohekawebservices.online/verify/<linkToken>",
  "expiresAt": "2026-06-17T18:00:00.000Z"
}
```

> El campo se llama **`verificationUrl`** (no `verifyUrl`). El `verificationUrl` lleva un `linkToken` inadivinable, de un solo uso y expirable (TTL del workflow/tenant, típicamente 15 min — ver `expiresAt`).

### Con el SDK

```ts
import { TekoVerify } from "@teko/verify-sdk";

const teko = new TekoVerify({
  apiKey: process.env.TEKO_API_KEY!,                 // tk_live_...
  baseUrl: "https://teko.rohekawebservices.online",
});

const session = await teko.createSession({
  externalRef: "user-42",                            // idempotencia
  assuranceRequired: "L2",
  // email / workflowId / documentType / appId / callbackUrl / redirectUrl / locale opcionales
});
// session = { sessionId, verificationUrl, expiresAt }
res.redirect(session.verificationUrl);               // (c) redirigí al titular
```

### Modelo hosted

1. Tu backend llama `POST /v1/sessions`.
2. Redirigís al titular a `verificationUrl` (o se lo enviás por email/SMS).
3. Teko corre el flujo de captura + checks + decisión en su UI hosted.
4. Al terminar, Teko te notifica por **webhook** y (si configuraste `redirectUrl`) redirige al titular de vuelta.
5. Tu backend consulta el estado/decisión (`GET /v1/sessions/:id`) o confía en el webhook.

Errores de creación: `400` con `{ "error": "...", "detail": "..." }` (`invalid_email`, `invalid_document_type`, `invalid_workflow`, `app_not_found`, `create_session_failed`).

---

## 3. Estados de la sesión

`state` (campo de la sesión) evoluciona así:

| Estado | Terminal | Significado |
|---|---|---|
| `created` | no | Sesión creada; el titular todavía no abrió el `verificationUrl`. |
| `capturing` | no | El titular está capturando documento/selfie en el flujo hosted. |
| `processing` | no | Corriendo los checks (calidad, liveness, OCR, match 1:1, AML, etc.). |
| `review` | no | Evaluación interna previa a la decisión. |
| `in_review` | no | En **cola de revisión humana** (workflow `review: always | on_borderline`). |
| `verified` | **sí** | Aprobada. |
| `rejected` | **sí** | Rechazada. |
| `needs_recapture` | no | Calidad/liveness insuficiente; hay que recapturar. |
| `expired` | **sí** | El `linkToken` expiró antes de completar. |
| `error` | **sí** | Error de sistema; **nunca** queda `verified`. |

---

## 4. Webhooks

Teko notifica los eventos del ciclo de vida de la sesión vía HTTP `POST` firmado.

### Suscribirse (panel admin)

En `/admin-ui` → **Webhooks**, o vía la API admin:

```
POST /admin/tenants/:tenantId/webhooks
Authorization: Bearer <admin-session-token>
Content-Type: application/json

{ "url": "https://tu-backend/webhooks/teko", "events": ["session.approved","session.declined"], "appId": "<opcional>", "description": "prod" }
```

- `events`: subconjunto del catálogo, o `["*"]` (comodín = todos).
- La respuesta incluye `secret` **una sola vez** — guardalo, es la clave HMAC.
- Endpoints útiles: `GET .../webhooks` (lista, sin secreto), `PUT .../webhooks/:id` (editar url/events/enabled), `POST .../webhooks/:id/test` (ping), `GET .../webhooks/:id/deliveries` (log de entregas), `POST .../webhooks/:id/deliveries/:did/resend`.

Alternativa por sesión: el `callbackUrl` del `POST /v1/sessions` recibe todos los eventos de esa sesión, firmado con el **secreto del tenant**.

### Eventos

`session.created`, `session.status_updated`, `session.approved`, `session.declined`, `session.in_review`, `session.data_updated`.

### Payload (cuerpo JSON)

```json
{
  "id": "evt_8f0c…",
  "event": "session.approved",
  "createdAt": "2026-06-17T18:00:00.000Z",
  "data": {
    "sessionId": "…",
    "tenantId": "…",
    "externalRef": "user-42",
    "state": "verified",
    "assuranceRequired": "L2",
    "result": { "decision": "verified", "loa": "L2", "reasons": ["…"] }
  }
}
```

### Headers de cada entrega

| Header | Valor |
|---|---|
| `Content-Type` | `application/json` |
| `X-Teko-Event` | tipo de evento (p.ej. `session.approved`) |
| `X-Event-Id` | id único del evento (== `payload.id`); **estable entre reintentos** |
| `X-Timestamp` | unix seconds usados al firmar |
| `X-Signature` | `sha256v2=<hmac-hex>` |
| `X-Signature-Version` | `2` |

### Verificar la firma (algoritmo exacto — HMAC v2)

El server firma hoy con el esquema **v2**: la versión `2` va embebida en el input del
HMAC (anti-replay entre versiones) y el header lleva el prefijo `sha256v2=`.

```
firma_esperada = HMAC_SHA256(secret, `2.${X-Timestamp}.${rawBody}`)   // hex
válido  ⇔  timingSafeEqual("sha256v2=" + firma_esperada, X-Signature)
          &&  |now - X-Timestamp| <= 300   (segundos)
```

Reglas:

- El `rawBody` deben ser los **bytes exactos recibidos**. **No re-serialices el JSON** (el server firma el cuerpo canónico —claves ordenadas recursivamente, separadores compactos— tal cual lo manda; re-serializar puede reordenar claves y romper la firma).
- Comparación en **tiempo constante** (`crypto.timingSafeEqual`).
- **Ventana anti-replay:** rechazá si `|now - X-Timestamp| > 300s`.
- **Idempotencia:** deduplicá por `X-Event-Id` (los reintentos repiten el mismo id).
- **Reintentos:** primer intento síncrono; reintentos con backoff `60s → 4m → 15m`. Respondé `2xx` rápido para confirmar la entrega.
- **Fail-closed:** header faltante, timestamp no numérico o desfase → rechazá (`401`).

Ejemplo Node (sin SDK):

```js
const crypto = require("crypto");
function verify(rawBody, headers, secret) {
  const ts = parseInt(headers["x-timestamp"], 10);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now()/1000) - ts) > 300) return false;
  // v2: la versión "2" va dentro del HMAC y el header lleva el prefijo "sha256v2=".
  const expected = crypto.createHmac("sha256", secret).update(`2.${ts}.${rawBody}`).digest("hex");
  const recv = String(headers["x-signature"] || "").replace(/^sha256v2=/, "").replace(/^sha256=/, "");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(recv, "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
```

Con el SDK (forma estática por objeto):

```js
const { TekoVerify } = require("@teko/verify-sdk");
const ok = TekoVerify.verifyWebhookSignature({
  payload: rawBody,                       // bytes crudos
  signature: headers["x-signature"],      // "sha256v2=..."
  timestamp: headers["x-timestamp"],
  secret: process.env.TEKO_WEBHOOK_SECRET,
});
```

(También existe `verifyWebhookSignature(rawBody, req.headers, secret)`, que lee los headers por vos. Ambas detectan v1/v2 por el prefijo del header.)

---

## 5. Consultar el resultado / decisión

```
GET /v1/sessions/:sessionId
Authorization: Bearer <api-key>
```

Respuesta:

```json
{
  "sessionId": "…",
  "externalRef": "user-42",
  "state": "verified",
  "assuranceRequired": "L2",
  "result": {
    "decision": "verified",
    "loa": "L2",
    "reasons": ["…"],
    "extracted": { "ci": "…", "nombre": "…", "fechaNac": "…", "nacionalidad": "…", "tipoDoc": "ci_py" },
    "scores": { "match": 0.97 }
  },
  "evidence": [{ "type": "selfie", "storagePath": "…", "sha256": "…" }],
  "createdAt": "…",
  "completedAt": "…"
}
```

- `result` es `null` mientras no haya decisión. La **decisión** es `result.decision` (`verified | rejected | needs_recapture`) con su `loa` y `reasons`.
- Las imágenes de evidencia se sirven sólo desde el panel admin (autenticado), no por esta API.

### Polling (alternativa al webhook)

Si no podés exponer un endpoint de webhook, hacé **polling** del estado hasta un
estado terminal (`verified | rejected | expired | error`). Con el SDK:

```ts
async function waitForDecision(teko, sessionId, { everyMs = 5000, timeoutMs = 600000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const TERMINAL = new Set(["verified", "rejected", "expired", "error"]);
  while (Date.now() < deadline) {
    const s = await teko.getSession(sessionId);
    if (TERMINAL.has(s.state)) return s;       // s.result tiene decision/loa/reasons
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error("timeout esperando la decisión");
}
```

Preferí el **webhook** cuando puedas: es push (sin latencia de polling) y firmado.

### Right-to-erasure (borrado)

```bash
curl -sS -X DELETE "$BASE/v1/sessions/<sessionId>" -H "Authorization: Bearer $API_KEY"
# → {"sessionId":"…","deleted":true,"purged":["selfie","doc_front","doc_back"]}
```

```ts
const { deleted, purged } = await teko.deleteSession(sessionId);
```

Borra la sesión, su **evidencia** (imágenes en disco/CIFS) y la **identidad
verificada** asociada. `purged` lista los tipos de evidencia eliminados. Operación
idempotente desde el punto de vista del integrador: un id inexistente devuelve `404`.

Otros endpoints del tenant:

- `GET /v1/sessions?state=&externalRef=&from=&to=&limit=&offset=` — listado paginado.
- `DELETE /v1/sessions/:id` — borrado de evidencia/identidad (derecho a supresión).

---

## 6. Ejemplo end-to-end (curl)

```bash
BASE="https://teko.rohekawebservices.online"
API_KEY="tk_live_xxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxx"

# 1) Crear la verificación
curl -sS -X POST "$BASE/v1/sessions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"externalRef":"user-42","assuranceRequired":"L2"}'
# → {"sessionId":"…","verificationUrl":"https://…/verify/<token>","expiresAt":"…"}

# 2) Redirigir al titular a verificationUrl (flujo hosted) — lo hace tu app web.

# 3) Consultar el estado / decisión
curl -sS "$BASE/v1/sessions/<sessionId>" -H "Authorization: Bearer $API_KEY"
# → {"state":"verified","result":{"decision":"verified","loa":"L2",…}, …}
```

---

## 7. Manejo de errores

Todas las respuestas de error son JSON `{ "error": "<code>", ... }`. Tratá según el status:

| Status | `error` | Significado | Qué hacer |
|---|---|---|---|
| `400` | `invalid_email`, `invalid_document_type`, `invalid_workflow`, `app_not_found`, `create_session_failed` | Input inválido (con `detail` cuando aplica). | Corregí el body; no reintentes sin cambios. |
| `401` | `missing_api_key`, `invalid_api_key`, `tenant_inactive` | Sin key, key inválida/revocada o tenant inactivo. | Revisá el header `Authorization`/la key; no reintentes. |
| `402` | `quota_exceeded` | Cuota mensual del plan agotada. La sesión **no** se creó. Trae `used` y `quota`. | Subí de plan o esperá el próximo período; mostrá un aviso. |
| `404` | `session_not_found` | La sesión no existe para este tenant. | No reintentes. |
| `429` | `rate_limited` | Superaste el rate limit del tenant. Trae `retryAfterSeconds` y header `Retry-After`. | **Reintentá** tras `Retry-After` (backoff). |

```json
// 402 quota_exceeded
{ "error": "quota_exceeded", "detail": "Monthly verification quota reached for plan 'free'.", "used": 100, "quota": 100 }
// 429 rate_limited
{ "error": "rate_limited", "retryAfterSeconds": 42 }
```

Con el SDK, los errores no-2xx se lanzan como `TekoApiError` (con `.status` y `.body`):

```ts
import { TekoApiError } from "@teko/verify-sdk";
try {
  await teko.createSession({ externalRef: "user-42" });
} catch (e) {
  if (e instanceof TekoApiError) {
    if (e.status === 402) { /* quota_exceeded: e.body.used / e.body.quota */ }
    else if (e.status === 429) { /* rate_limited: backoff y reintentar */ }
    else if (e.status === 401) { /* key inválida */ }
  }
}
```

---

## 8. Notas de seguridad

- **La API key es secreta**: sólo en el backend, nunca en el browser ni en apps móviles. Rotá/revocá si se filtra.
- **Verificá SIEMPRE la firma** de los webhooks con el `rawBody` (sin re-serializar) antes de procesar.
- **Idempotencia** por `X-Event-Id`: un mismo evento puede llegar más de una vez (reintentos / reenvío manual).
- **Ventana anti-replay de 300s**: ajustá el reloj del server (NTP) o vas a rechazar firmas válidas.
- **HTTPS** obligatorio para los endpoints de webhook.
- **No confíes sólo en el redirect** del titular como prueba de aprobación: confirmá con `GET /v1/sessions/:id` o con el webhook firmado.
- El `linkToken` del `verificationUrl` es de **un solo uso** y expira (`expiresAt`); no lo persistas como identificador.
