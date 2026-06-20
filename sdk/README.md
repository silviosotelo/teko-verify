# @teko/verify-sdk

SDK **server-side** (TypeScript) para [Teko Verify](https://teko.rohekawebservices.online) — KYC / verificación de identidad. Cero dependencias de runtime: usa los módulos nativos de Node (`crypto`, `fetch`). Requiere Node >= 18.

> La API key es un **secreto del tenant**: usá este SDK sólo en tu backend, nunca en el browser.

## Instalación

Es un paquete del monorepo (`teko/sdk`). Compilalo con `tsc` y consumí `dist/`, o importá el fuente directo en un proyecto TS:

```bash
cd sdk && npm install && npm run build
```

## Uso

### 1. Crear una verificación y redirigir (flujo hosted)

```ts
import { TekoVerify } from "@teko/verify-sdk";

const teko = new TekoVerify({
  apiKey: process.env.TEKO_API_KEY!, // tk_live_...
  baseUrl: "https://teko.rohekawebservices.online",
});

// En tu handler de "iniciar verificación":
const session = await teko.createSession({
  externalRef: "user-42",          // idempotencia: misma ref → misma sesión
  email: "titular@example.com",     // opcional: el server le manda el link por email
  // workflowId / assuranceRequired / documentType / callbackUrl / redirectUrl / locale opcionales
});

// Redirigí al titular al flujo hosted:
res.redirect(session.verificationUrl);
// session = { sessionId, verificationUrl, expiresAt }
```

### 2. Consultar estado / decisión

```ts
const status = await teko.getSession(session.sessionId);
// status.state: created | capturing | processing | review | in_review
//             | verified | rejected | needs_recapture | expired | error

const decision = await teko.getDecision(session.sessionId);
// null si todavía no hay decisión, o { decision, loa, reasons, extracted?, scores? }
if (decision?.decision === "verified") { /* aprobado */ }
```

Otros métodos: `teko.listSessions({ state, externalRef, from, to, limit, offset })`,
`teko.deleteSession(id)` (derecho a supresión).

### 3. Recibir y verificar un webhook

Suscribite a los webhooks en el **panel admin** (`/admin-ui` → Webhooks). Al crear el endpoint se muestra el **secreto UNA sola vez** — guardalo.

Necesitás el **cuerpo CRUDO** (raw body) para verificar la firma. En Express:

```ts
import express from "express";
import { TekoVerify, WebhookEventPayload } from "@teko/verify-sdk";

const app = express();

// Cuerpo crudo SÓLO en la ruta del webhook (no uses express.json acá).
app.post("/webhooks/teko", express.raw({ type: "*/*" }), (req, res) => {
  const raw = req.body as Buffer; // bytes exactos recibidos
  const ok = TekoVerify.verifyWebhookSignature({
    payload: raw,                              // bytes crudos, no re-serializar
    signature: req.header("x-signature")!,     // "sha256v2=..."
    timestamp: req.header("x-timestamp")!,
    secret: process.env.TEKO_WEBHOOK_SECRET!,
  });
  if (!ok) return res.sendStatus(401);
  const event = JSON.parse(raw.toString("utf8")) as WebhookEventPayload;

  // Idempotencia: deduplicá por event.id (== header X-Event-Id).
  // if (alreadyProcessed(event.id)) return res.sendStatus(200);

  switch (event.event) {
    case "session.approved": /* ... */ break;
    case "session.declined": /* ... */ break;
    // session.created | session.status_updated | session.in_review | session.data_updated
  }
  res.sendStatus(200); // respondé 2xx rápido; reintentos: 60s / 4m / 15m
});
```

## Verificación de firma (algoritmo)

El server firma hoy con el esquema **v2** (header `X-Signature: sha256v2=<hex>` +
`X-Signature-Version: 2`). El SDK soporta v2 y mantiene v1 por compatibilidad,
detectando la versión por el prefijo del header igual que el server:

- v2 (actual): `expected = HMAC_SHA256(secret, \`2.${X-Timestamp}.${rawBody}\`)` en hex.
- v1 (legacy): `expected = HMAC_SHA256(secret, \`${X-Timestamp}.${rawBody}\`)` en hex.
- compara contra `X-Signature` en **tiempo constante** (`crypto.timingSafeEqual`).
- rechaza si `|now - X-Timestamp| > 300s` (anti-replay; configurable con `windowSec`).
- **fail-closed**: header faltante/mal formado, timestamp no numérico o desfase → `false` (nunca lanza).

Dos formas equivalentes:

- `TekoVerify.verifyWebhookSignature({ payload, signature, timestamp, secret, windowSec?, nowSec? })`
  — helper estático por objeto (recomendado).
- `verifyWebhookSignature(rawBody, headers, secret, options?)` — conveniencia que lee
  `X-Signature` / `X-Timestamp` de los headers HTTP.

`payload` / `rawBody` deben ser los **bytes exactos** del cuerpo recibido (string o
Buffer). No re-serialices el JSON: el server firma el cuerpo canónico (claves ordenadas
recursivamente, separadores compactos) tal cual lo manda.

## Scripts

```bash
npm run build      # tsc → dist/
npm run typecheck  # tsc --noEmit
npm run test       # vitest run (firma determinística + parseo)
```
