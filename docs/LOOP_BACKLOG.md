# Teko Verify — Loop backlog (terminar pendiente → montar subdominio)

Loop autopaceado: trabajar de arriba a abajo; el deploy del subdominio es el paso final.

## Prioridad
1. **[✓ 2022b79]** Business Console admin estilo Didit — detalle de verificación: header+nombre+badge de estado, fila de módulos con checks (Overview/ID Verification/Liveness/Face Match), tira de miniaturas + lightbox del documento, "Personal data" en 2 columnas editable. (`admin/`)
2. **[✓ LIVE: teko.rohekawebservices.online]** Deploy durable: subdominio en **rohekawebservices.online** vía **Cloudflare named tunnel** (cloudflared en el 34 + DNS CNAME por API) → reemplaza el trycloudflare efímero. `PUBLIC_BASE_URL` fijo. **(paso final)**
3. **[✓ diferido bb01a75 — informe+plan]** Fase 2: detector **ML** de documento (ID-card) en navegador (onnxruntime-web) — el objetivo final es ML, OpenCV fue puente.
4. **[pendiente]** Polish visual trust-driven del flujo cliente (refinar copys/jerarquía tras feedback real).
5. **[en curso]** Calibrar umbrales match/liveness; ensemble PAD anti-spoof; persistir imagen cruda; PDF multipágina (dorso pág2); orientación 180; split apellidos pegados; purgar PII de prueba.
   - Sub: split apellidos + persistir cruda → agente en curso. Calibración/PAD = esfuerzos grandes (eval set/GPU), diferir. Purga PII = al cerrar el loop.

## Stop
Loop termina cuando 1 y 2 estén hechos (núcleo "terminar + montar"); 3–5 best-effort hasta limpiar backlog o hasta que el usuario vuelva. Avisar por PushNotification al cerrar.

## Infra deploy (ref)
- CF token (válido/activo): gestiona DNS de rohekawebservices.online.
- Backend Teko: server 34, docker `teko-teko-verify-1` :4400.
- Subdominio sugerido: `teko.rohekawebservices.online` (o `verify.`).
