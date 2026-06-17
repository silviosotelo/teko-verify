# Teko Verify — Loop backlog (terminar pendiente → montar subdominio)

Loop autopaceado: trabajar de arriba a abajo; el deploy del subdominio es el paso final.

## Prioridad
1. **[✓ 2022b79]** Business Console admin estilo Didit — detalle de verificación: header+nombre+badge de estado, fila de módulos con checks (Overview/ID Verification/Liveness/Face Match), tira de miniaturas + lightbox del documento, "Personal data" en 2 columnas editable. (`admin/`)
2. **[✓ LIVE: teko.rohekawebservices.online]** Deploy durable: subdominio en **rohekawebservices.online** vía **Cloudflare named tunnel** (cloudflared en el 34 + DNS CNAME por API) → reemplaza el trycloudflare efímero. `PUBLIC_BASE_URL` fijo. **(paso final)**
3. **[✓ diferido bb01a75 — informe+plan]** Fase 2: detector **ML** de documento (ID-card) en navegador (onnxruntime-web) — el objetivo final es ML, OpenCV fue puente.
4. **[pendiente]** Polish visual trust-driven del flujo cliente (refinar copys/jerarquía tras feedback real).
5. **[parcial]** Robustez/limpieza:
   - **[✓ 0ab5367]** Split apellidos pegados desde MRZ (CI-gated, reconstruye `<`→C/K).
   - **[✓ 0ab5367]** Persistir imagen cruda (`doc_front_raw`/`doc_back_raw`, migración 0005).
   - **[✓ 11ca3d1]** Ensemble PAD anti-spoof (2 MiniFASNet 2.7+4.0, Apache) integrado; preserva live pass-through. Calibración `LIVENESS_THRESHOLD` pendiente de eval set de spoofs reales.
   - **[diferido]** Calibrar umbrales match/liveness → necesitan eval set etiquetado.
   - **[✓]** Runbook de deploy/operación en `docs/RUNBOOK.md`. Revisión de seguridad en `docs/specs/2026-06-17-security-review.md`.
   - **[✓ a587bdf]** Orientación 0/90/180/270 (cédula cabeza-abajo soportada). PDF pág2=dorso [diferido: no byte-seguro].
   - **[✓]** Chequeo de regresión post-cambios: las 3 cédulas siguen OK en el dominio live (89 tests).
   - **[gated]** Purga PII de prueba (`/tmp/batch` = 57 cédulas reales de clientes) → recomendado; decisión del usuario (¿se usan para entrenar el ML?).

## ML detector — RESUELTO ✓
- **[✓ d6f14b2]** **DocAligner (Apache-2.0)** integrado: Web Worker onnxruntime-web, 4 esquinas → gating geométrico post-filtro. Flag `?detector=ml`, default OpenCV, fallback ML→OpenCV→manual. Validado en cédula PY real (specimen sobre fondo: quad perfecto, has_obj 0.99). Pendiente: field-test en celu → si va bien, hacerlo default.

## Decisiones pendientes del usuario (gates)
- **ML Fase 2 (YOLO26):** mejor candidato técnico (n=2.4M params, NMS-free, Pose=4 esquinas/OBB, ONNX). Bloqueante = licencia **AGPL vs Enterprise**. Decisión (a) Enterprise/AGPL → entrenar YOLO26n-pose, o (b) sin-AGPL → U-Net MobileNetV3. + entrenar sobre MIDV+cédula PY (~1 sem GPU 34).
- **Polish visual del flujo cliente:** gated por tu prueba real en el celu.

## Loop CERRADO: núcleo (terminar pendiente + montar subdominio) ✓. Resto = gated por decisiones del usuario.

## Stop
Loop termina cuando 1 y 2 estén hechos (núcleo "terminar + montar"); 3–5 best-effort hasta limpiar backlog o hasta que el usuario vuelva. Avisar por PushNotification al cerrar.

## Infra deploy (ref)
- CF token (válido/activo): gestiona DNS de rohekawebservices.online.
- Backend Teko: server 34, docker `teko-teko-verify-1` :4400.
- Subdominio sugerido: `teko.rohekawebservices.online` (o `verify.`).
