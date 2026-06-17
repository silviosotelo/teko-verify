# Teko Verify — Revisión de seguridad (KYC público)

Fecha: 2026-06-17
Alcance: backend Express `src/` expuesto a Internet vía Cloudflare named tunnel en
`https://teko.rohekawebservices.online` (todo `:4400`, incl. `/admin-ui` y `/admin/*`).
Datos: PII biométrica (selfies/liveness) + cédulas reales → Ley 7593/2025 (dato sensible).
Modo: conservador, sistema en vivo. No se tocó captura, pipeline ML/OCR ni el túnel.

Verificado contra código + endpoints en vivo. Resultado general: **la base ya estaba
sólidamente endurecida** (auth real, rate-limit, CORS allowlist, anti-IDOR). Se cerró
la brecha principal pendiente: cabeceras de seguridad y fuga de stack traces.

---

## CRÍTICO

### C1. Admin (login + dashboard) en el túnel público — MITIGACIÓN, NO IMPLEMENTADA (decisión del usuario)
- **Hallazgo:** `/admin-ui` y `/admin/*` quedan accesibles desde Internet. El acceso
  depende de un único factor: usuario/contraseña de operador. Aunque el login tiene
  rate-limit estricto (ver A1), exponer la superficie admin de un sistema con PII
  biométrica a todo Internet es riesgo innecesario.
- **Evidencia:** `GET /admin-ui` y `POST /admin/login` responden públicamente (probado).
- **Recomendación (NO implementar sin tu decisión):** poner el admin detrás de
  **Cloudflare Access** (Zero Trust, login con tu IdP/email + MFA), **o** no rutear
  `/admin*` ni `/admin-ui*` por el túnel público (servirlo solo en LAN/VPN), **o**
  IP-allowlist en Cloudflare. Cualquiera de las tres elimina la exposición sin tocar
  el flujo de captura (que sí debe ser público).

### C2. Password bootstrap débil y conocido (`admin` / `TekoAdmin2026!`) — ROTAR (no se cambió)
- **Hallazgo:** la credencial bootstrap es débil y está documentada/compartida. Es,
  hoy, la única llave del admin público (combinado con C1 = riesgo real de takeover).
- **Por qué NO se cambió:** es el único acceso; rotarla a ciegas desde aquí podía
  dejar el dashboard sin acceso (lockout). Decisión: dejar la rotación al usuario.
- **Cómo rotar (seguro, sin lockout):** crear un operador nuevo con clave fuerte ANTES
  de quitar el viejo. El bootstrap solo siembra si la tabla está vacía
  (`bootstrapAdminOperator`, `src/admin/router.ts`), así que para rotar:
  1. Logueá con el operador actual.
  2. (Falta endpoint de alta de operadores en la API admin — ver M3.) Mientras tanto,
     insertá un operador nuevo en DB con hash scrypt:
     en el contenedor `node -e "const {hashPassword}=require('./dist/lib/crypto');
     console.log(hashPassword('UNA_CLAVE_FUERTE'))"` y luego
     `INSERT INTO admin_operators (username,password_hash,role) VALUES ('tu_user','<hash>','owner');`
  3. Verificá login con el nuevo, y recién entonces
     `DELETE FROM admin_operators WHERE username='admin';`
  4. Actualizá/quitá `TEKO_ADMIN_BOOTSTRAP_USER/PASSWORD` del entorno.

---

## ALTO

### A1. Rate-limit / anti-brute-force del login admin — OK (verificado), sin cambios
- El login monta `adminLoginRateLimiter()` ANTES del guard: ventana 5 min, máx 10
  intentos por **IP+usuario** (`src/lib/rateLimit.ts`). En vivo: `x-ratelimit-limit: 10`.
- Login devuelve `invalid_credentials` genérico y corre scrypt contra un hash dummy
  cuando el usuario no existe → **sin enumeración por timing**. Token de sesión opaco
  (`randomBytes(32)`), TTL 8 h, validado server-side (no estático). **Correcto.**

### A2. Cabeceras de seguridad ausentes (helmet) — ARREGLADO
- **Hallazgo:** sin HSTS, sin `X-Content-Type-Options`, sin `Referrer-Policy`, sin
  anti-clickjacking; además `x-powered-by: Express` filtraba el stack.
- **Fix:** se agregó `helmet` (`src/server.ts`) + `app.disable("x-powered-by")`.
  Conservador para no romper el sistema en vivo:
  - **CSP desactivada** globalmente (las SPAs de captura/admin usan inline de bundler;
    una CSP estricta las rompería). Pendiente: CSP a medida (Bajo, ver B1).
  - **frameguard NO global**: la página de captura `/verify/:token` puede embeberse en
    iframe del tenant; un DENY global rompería ese embed. Se aplica `X-Frame-Options:
    DENY` **solo** a `/admin` y `/admin-ui` (anti-clickjacking donde importa).
  - **HSTS** habilitado (el túnel es siempre HTTPS).

### A3. Fuga de stack trace en errores no manejados — ARREGLADO
- **Hallazgo:** `POST /admin/login` con JSON malformado devolvía **HTML con el stack
  completo** (`SyntaxError … /app/node_modules/body-parser/…`), revelando rutas y
  dependencias internas (el contenedor no corre con `NODE_ENV=production`).
- **Fix:** handler de errores terminal + 404 JSON genéricos en `src/server.ts`. Ahora
  JSON malformado → `400 {"error":"invalid_request_body"}`, payload grande → `413`,
  resto → `500 {"error":"internal_error"}`. El detalle real se loguea server-side, no
  se envía al cliente. Reemplaza el handler por defecto de Express.

---

## MEDIO

### M1. CORS — OK (verificado), sin cambios
- Allowlist explícita por env `TEKO_CORS_ORIGINS`; sin allowlist NO refleja Origin
  (fail-closed, same-origin). En vivo: `Origin: https://evil.example` → **sin**
  `Access-Control-Allow-Origin`. **Correcto.** (CORS no es capa de autorización, ok.)

### M2. `detail: (e as Error).message` en respuestas de error de endpoints — DEJADO (bajo riesgo, recomendado limpiar)
- Varios catch en `tenant.ts`/`admin.ts`/`capture.ts` devuelven `detail` con el
  `.message` de la excepción (p.ej. `create_session_failed`, `login_error`). Es solo
  el mensaje (no el stack), pero un error de PG podría revelar nombres de columnas/
  constraints. No se removió por ser invasivo (≈15 sitios) y de bajo riesgo; el peor
  caso (stack en errores no manejados) ya está cerrado por A3.
- **Recomendación:** gatear `detail` detrás de `TEKO_DEBUG_ERRORS` (off en prod).

### M3. No hay endpoint admin para alta/gestión de operadores — DEJADO (mejora, no vuln)
- La rotación de C2 hoy exige tocar DB a mano. Un endpoint `POST /admin/operators`
  (solo `owner`, con `requireRole`) facilitaría rotar sin SQL manual. No es una
  vulnerabilidad; ayuda a remediar C2 de forma segura.

---

## BAJO

### B1. CSP a medida — DEJADO
- Definir una Content-Security-Policy específica para las SPAs (captura/admin) cuando
  haya tiempo de probar que no rompe los bundles. Hoy desactivada a propósito (A2).

### B2. Rate-limit in-memory (no compartido entre instancias) — ACEPTABLE
- Documentado en el código: single-container on-prem. Si se escala a multi-instancia,
  respaldar en Redis. Sin acción hoy.

---

## Controles verificados que YA estaban bien (sin cambios)
- **IDOR / acceso a evidencia:** las fotos de captura se sirven por `link_token` (la
  credencial del titular) y por **tipo**, nunca por ruta cruda (anti path-traversal,
  `evidenceStore`). La evidencia del dashboard exige `adminGuard` (Bearer de sesión) y
  valida que la sesión pertenezca al tenant. URLs de evidencia no adivinables
  (`base64url` de 32 bytes). **Sin acceso sin auth.**
- **Tokens de verificación:** `link_token` inadivinable (32 bytes), single-use
  (`usedAt`) + TTL, fail-closed (404/410/409). Anti-replay correcto.
- **`/v1` exige API key:** `authenticateTenant` (Bearer → sha256 → tenant activo),
  scoping por tenant, idempotencia por `external_ref`.
- **Validación de input:** magic-bytes (JPEG/PNG; PDF solo en doc/admin), cap de
  tamaño por imagen (8 MiB), cap de frames (12), límite JSON 25 MiB.
- **API keys / passwords:** solo se persiste sha256 / scrypt+salt; comparación en
  tiempo constante.

---

## Cambios aplicados (deploy incluido)
- `src/server.ts`: helmet (HSTS/nosniff/referrer-policy), `disable('x-powered-by')`,
  frameguard DENY solo en admin, handler de errores + 404 JSON sin stack.
- `package.json`: +`helmet`.
- `npx tsc --noEmit` limpio; 89/89 tests verdes.
