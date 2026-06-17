# Teko Verify — Workflows, máquina de estados y cola de revisión (P0 #1)

Implementa la arquitectura Workflow → Session de Didit con revisión humana, sin
romper el flujo de captura ni el pipeline ML/OCR. On-prem, fail-closed.

## 1. Workflows (configurables + versionados)

- Tabla `workflows` (por tenant): `id, tenant_id, name, version, definition (JSONB),
  is_default`. **Editar un workflow = crear una nueva fila con `version+1`** (la
  vigente de un `name` = `max(version)`). Migración `0007_workflows_review.sql`.
- `WorkflowDefinition` (JSONB) declara qué checks corren y con qué umbrales/política:
  ```jsonc
  {
    "document": { "required": true },
    "liveness": { "required": true, "mode": "active", "threshold": 0.6 },
    "match":    { "required": true, "threshold": 0.4 },
    "quality":  { "glassesMaxPct": 0.5 },
    "review":   { "mode": "auto" | "always" | "on_borderline",
                  "borderlineBand": { "matchMin": 0.38, "matchMax": 0.45,
                                      "livenessMin": 0.55, "livenessMax": 0.7 } }
  }
  ```
- La **sesión snapshotea** la definición usada: columnas `workflow_id`,
  `workflow_version`, `workflow_snapshot (JSONB)`. El pipeline decide con ESE
  snapshot, no con el L1/L2/L3 fijo.
- **Compatibilidad (nada se rompe):** `src/lib/workflow.ts` DERIVA de la definición
  el LoA equivalente (`liveness.required→L3`, `match.required→L2`, `document→L1`) y
  los thresholds, produciendo la misma `TenantPolicy` que consume `decision()` /
  `needsMatch` / `needsLiveness`. Se siembran 3 workflows default por tenant
  (`default-l1/-l2/-l3`) que mapean EXACTO a la escalera actual con `review:auto`.
  Las sesiones SIN snapshot (viejas) caen al comportamiento previo (LoA por sesión).
- Creación de sesión: `POST /v1/sessions` acepta opcional `workflowId`; si se omite,
  snapshotea el default que mapea al `assuranceRequired` pedido. `test-session` y
  `test-verify` del admin siguen igual (LoA por sesión).
- CRUD admin (detrás de `canWrite`): `GET/POST /admin/tenants/:id/workflows`,
  `PUT /admin/tenants/:id/workflows/:name` (edición = nueva versión).

## 2. Máquina de estados

```
created ──▶ capturing ──▶ processing ──┬─▶ verified        (terminal, OK)
   │           │  ▲           │         ├─▶ rejected        (terminal, KO)
   │           │  └──────┐    ├─▶ review ──▶ verified|rejected   (confirm titular)
   │           ▼         │    │
   │     needs_recapture─┘    └─▶ in_review ──▶ verified|rejected (revisión humana)
   │                                  ▲
   └──────────────────────────────────┘
 cualquier estado no-terminal + TTL  ──▶ expired
 excepción del pipeline              ──▶ error   (NUNCA verified)
```

- **`in_review`** (NUEVO): cola de revisión HUMANA. No terminal del lado sistema (un
  operador lo resuelve), pero terminal del lado titular (token consumido, no captura
  más). El pre-veredicto del motor viaja como SUGERENCIA en `result`.
- **Mapeo conceptual Didit ↔ Teko (alias, sin renombrar para no romper front/admin/
  webhooks):** `verified ≡ approved`, `rejected ≡ declined`, `capturing ≡
  in_progress`. El CHECK de la columna acepta además los nombres Didit
  (`in_progress/approved/declined/abandoned`) de forma permisiva, sin productor hoy.

### Transiciones a `in_review`
Tras computar TODOS los checks, si la política de revisión del workflow lo pide, la
sesión va a `in_review` en vez de auto-decidir:
- `review.mode = "always"` → siempre.
- `review.mode = "on_borderline"` → si `match`/`liveness` caen en su banda dudosa.
- `review.mode = "auto"` (o sin snapshot) → auto-decisión (comportamiento actual).
Aplica tanto en `processSession` (/submit) como en `finalizeFromChecks` (/confirm).
`goToReview` NO crea identidad ni dispara webhook; persiste checks + evidencia (en el
camino /submit) y deja la sugerencia.

## 3. Cola de revisión manual

- `GET /admin/review-queue?tenantId=&limit=&offset=` → sesiones `in_review`
  (cross-tenant; el operador revisa todo). Devuelve la sugerencia del motor + scores.
- `POST /admin/sessions/:id/review { decision: "approve"|"decline", reason? }`
  (operator-auth, `canWrite`): `applyReviewDecision` reconstruye los checks,
  aplica la decisión, crea `verified_identity` si aprueba (re-infiriendo el embedding
  de la selfie), marca terminal (`verified|rejected`), sella `reviewed_by/reviewed_at`,
  registra el revisor en `audit_log` (`session.reviewed`) y dispara el webhook.
  Fail-closed: cualquier excepción → `error`.
- **Admin UI (ecme):** vista **Cola de revisión** (`/review-queue`) y editor de
  **Workflows** (`/workflows`); botones **Aprobar/Rechazar con motivo** en el detalle
  de sesión cuando está `in_review`.

## 4. Diferido (próxima vuelta)
- Editor-grafo visual de workflows (hoy: editor JSON con validación).
- Estados Didit `abandoned`/`in_progress` con productor propio (hoy: alias permitidos
  en el CHECK, canónico = capturing/expired).
- `latencyByModule` real en métricas; persistencia durable del store de sesiones admin.
