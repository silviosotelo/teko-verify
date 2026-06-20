# Auditoría Ecme — frontend admin Teko Verify

Fecha: 2026-06-20
Alcance: `admin/src/views/teko/*` (40 vistas) + `admin/src/teko`.
Objetivo: detectar componentes custom que NO sean Ecme 100% (regla `feedback_esign_frontend_ecme`:
prohibido `confirm/alert`/HTML crudo; usar componentes Ecme + `ConfirmDialog`/`useConfirm` + `toast`).
Referencia: catálogo `@/components/ui` + `@/components/shared`, docs en `RWS-CRM/docs`.

## ESTADO: REMEDIADO (2026-06-20)

Todas las violaciones de la lista priorizada fueron corregidas y verificadas:
- **`confirm/alert/prompt` nativos → 0** (eran 3: Apps, IntegrationsOAuth, Webhooks) → `ConfirmDialog` + `toast`.
  - Hallazgo: el `ConfirmDialog` real NO acepta `message/confirmLabel/cancelLabel` (la "referencia" RemindersAutomated los descartaba silenciosamente). Se usó la firma real: `children/confirmText/cancelText/onCancel/onConfirm`.
- **`<select>` nativos → 0** y **`<textarea>` nativos → 0** en todo `views/teko` (todos → `Select` / `Input textArea`).
- **`<input type=checkbox>` → `Checkbox`**; **`<button>` sueltos → `Button`/`Segment`**; **3 alerts Billing → `Alert type=danger`**.
- **Tablas OcrDebug (×2) → `Table`** compound; **forms Sessions/Team → `Form`+`FormItem`**.
- **Badges a mano → `Tag`** (SessionDetail ~8, ReviewQueue, Dashboard, EmailTemplates, Workflows, Webhooks), siguiendo el patrón ya en `src/teko/badges.tsx`.

**Verificación**: `tsc --noEmit` con baseline-diff por git-stash → **0 regresiones** (119 errores = baseline exacto, todos pre-existentes del template; el build de prod es `vite build` sin tsc). `vite build` → ✓ built. Re-sweep grep → 0 `confirm/select/textarea`.

**2 "violaciones fantasma" del informe NO existían** en el código (copy-paste del rango): OcrDebug "button toggle 461-473" (ya era `Segment`) y IntegrationsZapier "flujo OAuth 331-346" (no hay tal sección).

**Aclaración patrón `<form>`**: los `<form onSubmit>` nativos NO son violación en este codebase — la vista gold-standard `RemindersAutomated.tsx` (100% Ecme) los usa con componentes Ecme adentro. El informe inicial marcó inconsistentemente 2 (Sessions/Team), que se convirtieron a `<Form>` igual. Los demás (Tenants, Reminders×3, Integrations×3, ApiKeys, Apps) quedan como están = consistente con el estándar del proyecto.

**Excepciones legítimas que sobreviven al grep** (intencionales): `<input type=file className="hidden">` tras Button (OcrDebug×2, TestVerify, Customization), `<input type=color>` (Ecme no provee picker), `<button>` interactivos con layout propio (SessionDetail thumb/tabs/colapsable, Customization preview CTA con `style` dinámico).

**Pendiente (no bloqueante, requiere navegador)**: verificación visual del color semántico de los `Tag` (verde/rojo PoA/AML — `Tag` aplica color default sobre el className), ancho de los `Select size="sm"` en Workflows, y padding de badges convertidos.

---

## Resumen ejecutivo (auditoría original)

- **~57 violaciones** en **24 vistas**. **11 vistas ya están 100% Ecme.**
- **Severidad alta: 9** · media: ~37 · baja: ~11.
- Lo más grave (rompe regla explícita): **3 `confirm()` nativos** (Apps, IntegrationsOAuth, Webhooks),
  **2 tablas enteras a mano** (OcrDebug) y **2 `<form onSubmit>` nativos** (Sessions, Team).
- El patrón más repetido: **`<select>` nativo** (≥12 casos) y **badges/pills hechos con `<span className="rounded-full ...">`** (≥12 casos) en vez de `<Select>` y `<Tag>`/`<Badge>`.

## Vistas 100% Ecme (sin tocar)
Audit · Compliance · FaceGallery · RateLimits · RemindersAutomated · RemindersScheduling ·
SettingsSMS · SettingsStorage · Tenants · Usage · BillingUsageAlerts · (dir `teko/`).

## Violaciones por severidad

### 🔴 ALTA (rompe regla "no HTML crudo / no confirm")
| Archivo:línea | Qué hay | Reemplazo Ecme |
|---|---|---|
| Apps/Apps.tsx:78 | `confirm()` nativo (borrar app) | `ConfirmDialog` + `toast` |
| IntegrationsOAuth.tsx:268 | `confirm()` nativo (revocar credenciales) | `ConfirmDialog` + `toast` |
| Webhooks/Webhooks.tsx:149 | `confirm()` nativo (eliminar destino) | `ConfirmDialog` + `toast` |
| OcrDebug.tsx:500-576 | `<table>` nativa (datos extraídos) | `Table` / `DataTable` |
| OcrDebug.tsx:587-640 | `<table>` nativa (líneas OCR crudas) | `Table` / `DataTable` |
| Sessions.tsx:409-419 | `<form onSubmit>` nativo (crear sesión) | `Form` + `FormItem` |
| Team.tsx:325 | `<form onSubmit>` nativo (invitar operador) | `Form` + `FormItem` |
| SessionDetail.tsx:134-140, 771-784, 870-882, 987-999 | StatusBadge / risk / AML / PoA: badges custom con `<span rounded-full ring-1>` | `Badge` con variant/color |
| ReviewQueue.tsx:107-118 | badge de estado con `<span>` tailwind | `Badge` / `Tag` |

### 🟠 MEDIA (elemento interactivo nativo)
| Archivo:línea | Qué hay | Reemplazo Ecme |
|---|---|---|
| ApiKeys.tsx:224-231 | `<select>` nativo (app) | `Select` |
| ApiKeys.tsx:239-246 | `<input type=checkbox>` nativo | `Checkbox` |
| Customization.tsx:143-155 | `<button>` nativo (preset) | `Button` |
| Customization.tsx:334-341 | `<textarea>` nativo | `Input textArea` |
| EmailTemplates.tsx:123-126 | `<select>` nativo (tipo) | `Select` |
| EmailTemplates.tsx:129 | `<textarea>` nativo (HTML body) | `Input textArea` / `RichTextEditor` |
| IntegrationsConnectors.tsx:278-287 | `<select>` nativo (filtro estado) | `Select` |
| IntegrationsConnectors.tsx:461-473 | `<button>` nativo (toggle eventos) | `Button` / `Segment` |
| IntegrationsOAuth.tsx:331-346 | `<button>` nativo (flujo OAuth) | `Button` / `Segment` |
| IntegrationsOAuth.tsx:545-556 | `<select>` nativo (vincular app) | `Select` |
| IntegrationsOAuth.tsx:594-603, 672-681 | `<input type=checkbox>` nativo ×2 | `Checkbox` |
| IntegrationsZapier.tsx:331-346, 553-573 | `<button>` nativo ×2 (flujo/trigger) | `Button` / `Segment` |
| OcrDebug.tsx:461-473 | `<button>` nativo (toggle) | `Segment` |
| Questionnaires.tsx:231-238 | `<button>` nativo (copiar ID) | `Button` |
| Questionnaires.tsx:315-320, 370-375 | `<textarea>` nativo ×2 (JSON) | `Input textArea` |
| Sessions.tsx:257, 298 | `<input type=checkbox>` nativo ×2 | `Checkbox` |
| Sessions.tsx:429-433 | `<select>` nativo (nivel aseguramiento) | `Select` |
| SettingsEmail.tsx:305-313 | `<select>` nativo (tipo) | `Select` |
| SettingsEmail.tsx:314-320 | `<textarea>` nativo (cuerpo HTML) | `Input textArea` |
| SessionDetail.tsx:276-304 | EvidenceThumb `<button>` custom | `Button` |
| SessionDetail.tsx:453-507 | ModuleTab múltiples `<button>` custom | `Tabs` / `Button` |
| Team.tsx:293-308, 356-366 | `<select>` nativo ×2 (rol) | `Select` |
| TestVerify.tsx:510 | `<input type=email>` nativo | `Input type=email` |
| Webhooks.tsx:370-382 | `<button rounded-full>` pill custom | `Tag`/`Badge` clickable |
| Workflows.tsx:236, 249, 259, 279 | `<select>` nativo ×4 (liveness/AML/review/LoA) | `Select` |
| BillingInvoices.tsx:265-267 | `<div>` alert de error custom | `Alert type=danger` |
| BillingPaymentMethods.tsx:220-222 | `<div>` alert de error custom | `Alert type=danger` |
| BillingPlans.tsx:304-306 | `<div>` alert de error custom | `Alert type=danger` |

### 🟡 BAJA (badge/pill a mano, style estático)
| Archivo:línea | Qué hay | Reemplazo Ecme |
|---|---|---|
| Dashboard.tsx:500 | badge `<span rounded-full bg-primary/10>` | `Badge` |
| EmailTemplates.tsx:110 | badge `<span rounded-full bg-green-100>` | `Badge` |
| Workflows.tsx:197 | badge `<span ... rounded-full>` | `Badge` |
| SessionDetail.tsx:651-671, 796, 942-947, 950-955 | tags de IP/país/device/AML con `<span>`/`<li>` | `Tag` / `Badge` |
| Customization.tsx:289-293 | `<input type=color>` nativo | Input hex + preview (Ecme no trae color picker) |
| Customization.tsx:313-319 | `<input type=file>` nativo (verificar oculto tras Upload) | `Upload` |

## Patrones agregados (para arreglo por lote)
1. **`<select>` nativo → `Select`**: ApiKeys, EmailTemplates, IntegrationsConnectors, IntegrationsOAuth, Sessions, SettingsEmail, Team(×2), Workflows(×4). ~12 casos — el cluster más grande.
2. **Badge/pill a mano (`<span className="rounded-full ...">`) → `Tag`/`Badge`**: SessionDetail (~8), ReviewQueue, Dashboard, EmailTemplates, Workflows, Webhooks. ~12 casos. Conviene crear un `StatusBadge` Ecme reutilizable y reemplazar todos.
3. **`<textarea>` nativo → `Input textArea`**: Customization, EmailTemplates, Questionnaires(×2), SettingsEmail.
4. **`<input type=checkbox>` nativo → `Checkbox`**: ApiKeys, IntegrationsOAuth(×2), Sessions(×2).
5. **`confirm()` nativo → `ConfirmDialog`+`toast`**: Apps, IntegrationsOAuth, Webhooks.
6. **`<div>` alert de error → `Alert type=danger`**: los 3 Billing*.
7. **`<button>` nativo → `Button`/`Segment`**: Customization, Integrations*, OcrDebug, Questionnaires, SessionDetail.
8. **`<table>`/`<form>` nativos → `Table`/`DataTable` y `Form`/`FormItem`**: OcrDebug(×2), Sessions, Team.

## Plan sugerido de remediación (orden por impacto/esfuerzo)
1. **Quick wins de alta** — 3 `confirm()` → `ConfirmDialog` (patrón ya usado en RemindersAutomated). 3 `Alert` de Billing.
2. **Componente `StatusBadge` Ecme** central → reemplazar los ~12 badges a mano (sobre todo SessionDetail).
3. **`<select>` → `Select`** en lote (~12).
4. **`<textarea>`/`<input checkbox>`/`<button>`** sueltos.
5. **Estructural**: OcrDebug tablas → `Table`; Sessions/Team `<form>` → `Form`+`FormItem`.
