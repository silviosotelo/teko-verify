# Teko Verify — Runbook de deploy y operación

KYC/verificación de identidad on-prem. Estado: **live en producción** sobre subdominio durable.

## URLs (live)
- **Captura (cliente):** `https://teko.rohekawebservices.online/verify/<token>`
  - Flag opcional: `?detector=ml` → usa el detector ML DocAligner (default = OpenCV, con fallback automático).
- **Admin:** `https://teko.rohekawebservices.online/admin-ui/`  (login `admin` / `TekoAdmin2026!` — **ROTAR, ver Seguridad**)
- **Health:** `https://teko.rohekawebservices.online/health`

## Arquitectura
- **Backend** `teko-verify` (TS/Node 22, express, :4400) — pipeline quality→liveness→document→match→decision (L1/L2/L3 por sesión vía `effectivePolicy`).
- **Sidecar** `paddleocr-sidecar` (PaddleOCR 3.6.0; `/ocr`, `/doc-crop`, `/ocr-enhanced`).
- **Postgres** dedicado.
- **Detectores de documento (frontend, Web Worker):** OpenCV.js (default, `docWorker.js`) · DocAligner ONNX (`docWorkerMl.js`, flag `?detector=ml`) → ambos alimentan el gating geométrico (`docAnalyze.ts`). Fallback ML→OpenCV→manual (timeout 7s).
- **Modelos ONNX** (volumen `/home/soporte/teko/models/`): SCRFD detect, ArcFace recognizer, MiniFASNet PAD ×2 (ensemble 2.7+4.0), face_attrib (anteojos), DocAligner (en `web/public/`).

## Deploy (server 34)
```
ssh soporte@192.168.41.34            # repo /home/soporte/teko
cd /home/soporte/teko
docker compose up -d --build teko-verify     # backend (PUBLIC_BASE_URL ya fijo en compose)
docker compose restart paddleocr-sidecar     # si se tocó ocr/
node dist/db/migrate.js                       # migraciones (0001..0005)
```
- **web/** (captura) y **admin/** (dashboard) van por **volumen**: `scp -r web/dist/* … :/home/soporte/teko/web/dist/` y `admin/dist/*`. `web/public/*` (opencv.js, ort/, *.onnx, mediapipe/) también.

## Túnel Cloudflare (named tunnel — durable)
- Container `teko-cloudflared` (`cloudflared tunnel run --token …`, `restart unless-stopped`, red host → localhost:4400). Sobrevive reinicios.
- DNS: CNAME `teko` → `<tunnel-id>.cfargotunnel.com` proxied (zone rohekawebservices.online).
- Reiniciar: `docker restart teko-cloudflared`. Logs: `docker logs --tail 20 teko-cloudflared`.

## Admin / herramientas
- **Probar verificación:** subir imágenes o cámara, selector L1/L2/L3 estricto.
- **Inspector OCR:** cajas PaddleOCR sobre la imagen + anclaje por campo + MRZ; variantes raw/deskew/production.
- **Detalle de verificación** (estilo Didit): módulos con checks, miniaturas+lightbox, datos personales editables.

## Seguridad — PENDIENTE (ver `docs/specs/2026-06-17-security-review.md`)
- 🔴 **C1:** admin expuesto a internet → proteger con **Cloudflare Access** (OTP a `informatica@santaclara.com.py`) o sacar `/admin*` del túnel público.
- 🔴 **C2:** rotar el password admin débil → crear operador nuevo con scrypt (sin borrar el viejo) antes de quitar el `admin` default.
- ✅ Ya aplicado: helmet/headers, anti-fuga de stack, rate-limit login, CORS allowlist, evidencia auth-gated (sin IDOR), token single-use+TTL.

## Calibración / datos PENDIENTES
- **PAD anti-spoof:** ensemble 2-modelos integrado, pero `LIVENESS_THRESHOLD` (0.70) sin calibrar → necesita **eval set etiquetado de spoofs reales** (print/replay).
- **Umbrales match/liveness:** idem, necesitan eval set.
- **PII de prueba:** `/tmp/batch` (57 cédulas reales de clientes) → purgar.

## Gotchas críticos (no romper)
- MiniFASNet PAD: input **CRUDO 0..255 (NO /255)** + crop scale 2.7/4.0 desde original. `/255` satura.
- OCR documento: producción = crudo-primero + fallback upscale + cross-fill MRZ; **NO doc-crop** (rompe anclaje por píxeles). Orientación 0/90/180/270.
- MRZ PY: CI real en `optionalData` (no en documentNumber = serial de tarjeta).
