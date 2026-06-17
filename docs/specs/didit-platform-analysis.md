# Didit Platform Analysis — Blueprint for Teko Verify

> Competitive teardown of **Didit** (KYC/identity verification platform) to guide the build-out of **Teko Verify**.
> Sources: the live Didit Business Console (logged in with the owner's account on 2026-06-17) and the public developer docs at `docs.didit.me`.
> Console screenshots: `C:\Users\sotelos\Downloads\didit_console\` (numbered `04_*`–`34_*` for this capture; `_dump_*.json` hold the raw page text/links per section).
> Everything here is described in our own words as a functional spec. No proprietary Didit source code is reproduced.

---

## 0. Account model & top-level structure

Didit's console is multi-level: **Organization → Application → Workflow → Session**.

- **Organization** (`/console/{orgId}/...`) — the billing/legal entity. Holds team, roles, SSO, billing, audit logs, branding domain. Can contain multiple Applications.
- **Application** (`/console/{orgId}/{appId}/...`) — a product/integration. Owns its own API keys, webhooks, workflows, customization, and the verification data (users, sessions). The app has an environment toggle shown in the header: **Producción / Sandbox**.
- **Workflow** — a reusable, versioned definition of which checks run and in what order (see §3). Pinned per session by `workflow_id` + `workflow_version`.
- **Session** — a single end-user verification attempt against a workflow.

This is a cleaner separation than Teko today (Teko has Tenant → API key → Session, with policy on the tenant). The Org/App split lets one customer run several products with isolated keys/branding under one bill.

---

## 1. Console page map (each section, purpose, options)

Left-nav is grouped: **Inicio**, **Directorio** (Users, Businesses), **Verificaciones** (User verifications, Business verifications, Transactions), **Configurar** (Workflows, Customization, Questionnaires, Lists), **Gestionar** (Integrate, API keys, Webhooks, Team members, Reports). A persistent global search (Ctrl-K: "search pages, sessions, users, businesses"), a running spend counter, an org switcher, and a "Setup guide 3/8" progress checklist are always visible.

| Section | Route | Purpose / what it shows | Key options |
|---|---|---|---|
| **Inicio / Dashboard** | `/{app}` | KYC/KYB/transaction performance at a glance. Widgets: "Requires review" queue, recent activity feed, **Volume** chart, **Transaction volume**, **ID document locations** (by country), **IP locations**, **Warnings analysis**, **Conversion rate** + conversion-by-country, **Resend/funnel info** (1st/2nd/3rd+ step, abandoned), **Demographics** (gender, age), **Devices** (device/browser/OS). | Date range (last 30 days), filter by workflow, **Export**, add/edit widgets (customizable dashboard). |
| **Users (Directorio)** | `/{app}/users` | Directory of verified end-users (entities), keyed by `vendor_data`. Aggregates all sessions of a person. | Search, filter. Underpins "reusable KYC" and entity status (ACTIVE/FLAGGED/BLOCKED). |
| **Businesses** | `/{app}/businesses` | KYB entity directory (companies, UBOs, officers). | — |
| **User verifications (KYC)** | `/{app}/kyc/verifications` | The session list — the workhorse table. Columns: subject name, country, document type, workflow, source ("Hosted/Alojada"), datetime, status badge (e.g. APROBADO). Opening a row opens a full detail panel (see §1a). A header banner shows "N sessions awaiting your review". | Filter by status, workflow, date; open detail; export. |
| **Business verifications (KYB)** | `/{app}/kyb/verifications` | Same, for company verifications. | — |
| **Transactions** | `/{app}/transactions` | Transaction-monitoring / KYT records (txn screening, risk score, severity). | — |
| **Workflows** | `/{app}/workflows` | List of verification flows. Columns: name, **workflow_id (UUID)**, type (KYC/KYB), **structure (SIMPLE / advanced graph)**, status (PUBLICADO / archived), enabled features, **price range per session**, last updated. The owner account has 4: *Biometric Authentication* ($0.10–0.13), *Adaptive Age Estimation* ($0.10–0.28), *KYC + AML* ($0.42–0.65), *Custom KYC* ($0.00–0.33). | **New workflow**, All/Archived tabs, open editor. |
| **Customization** | `/{app}/customization` | White-label editor for the hosted flow (see §1b). | Brand (logo/colors), Email templates, Domain; toggles: skip welcome screen, hide progress bar, public app name (≤30 chars), Privacy Policy URL, callback delay (s). Live per-screen preview. |
| **Questionnaires** | `/{app}/questionnaires` | Build structured forms that can be dropped into a workflow as a step (collect declarations, source-of-funds, etc.). | Create/edit questionnaire. |
| **Lists** | `/{app}/lists` | Allow/deny / watch lists (e.g. block documents, countries, or users) used by workflow branch logic. | Create list, add entries. |
| **Integrate** | `/{app}/integrate` | Guided 5-step integration wizard (see §4). Generates a ready-to-paste AI prompt (.env + code) for Cursor/Claude Code with the customer's real key, workflow_id, SDK choice. | Pick API key, workflow, create webhook, choose SDK (Web JS/TS, iOS, Android, React Native, Flutter), copy prompt, links to docs/OpenAPI. |
| **API keys** | `/{app}/developers/api-keys` | Table: name, status (ACTIVO), masked secret key, created, last used, created by. | **Create API key**, rotate, revoke. |
| **Webhooks** | `/{app}/developers/webhooks` | Table of destinations: URL, status, signing secret, version (v3), subscribed events ("Escuchando"), last delivery. | **Add destination**, **Test webhook**, copy AI handler prompt, link to webhook docs. |
| **Team members** | `/console/{org}/settings/team` | Invite/manage members at the org level. | Invite, assign role. |
| **Reports** | `/{app}/reports` | Exportable reports/analytics over sessions. | — |
| **Org settings** | `/console/{org}/settings` | Org-level admin. Tabs: **Account** (logo, name, legal name, contact email, website, billing address, tax id, ToS URL), **Team**, **Roles**, **Security**, **SSO**, **Usage**, **Billing**, **Audit logs**, **Terms & policies**, plus per-app settings. | Manage org identity, members, RBAC roles, SSO, usage metering, invoices, audit trail. |

### 1a. Verification detail panel (the most important screen to copy)

Opening a session shows a tabbed detail with these sub-views: **Resumen (Overview) · Verificación de ID · Prueba de vida (Liveness) · Coincidencia facial (Face match) · Análisis de dispositivo e IP · Eventos (timeline)**. Plus a **Webhooks** sub-table (deliveries for that session, last 30 days) and a **session chat** + **document carousel/lightbox** (preview all images/PDFs).

- **Header**: subject name + session number (#1), country, document type, workflow + source (Hosted), created timestamp, and the big **status badge** (APROBADO).
- **Overview**: contact details (issuer state, email, phone), **Tags / risk labels** ("No risk labels found — passed all automated fraud checks"), **Session details** (session_id, created, vendor_data, workflow + version), and a **Cost breakdown** per feature (each line FREE/priced + total).
- **ID Verification**: every extracted field rendered as an **editable form** (operator can correct + "Save changes"): document type (with dropdown of all supported types: Passport, ID card, Driver's license, Residence permit, Health insurance card, Tax card, Social security card), document number, personal number, issuing state, nationality, first/last name, DOB, expiry date, issue date, gender, marital status, place of birth, document subtype (ID document / diplomatic card), and **custom fields** ("Add custom field"). Plus a per-feature **checklist** of fraud sub-checks ("no risks detected").
- **Liveness**: liveness score (95.74%), face quality (97.5%), face luminance (45.7%) + checklist.
- **Face match**: similarity score (70.29%) + checklist.
- **Device & IP analysis**: an interactive map + device 1 card: city/country, IP, device platform (mobile), brand (Apple), model (iPhone), OS (iOS), browser (Mobile Safari), ISP, **device fingerprint**, **VPN/Tor flag**, **data-center flag**, timezone, and distance between document location / proof-of-address location.
- **Events**: a full forensic timeline — session created → link opened → each step transition (ID front → ID back → Liveness → Face match → IP analysis → Finished) with durations, every file upload, button press, and the final "session status changed In Progress → Approved", each row stamped with device + IP + geo.

This per-session forensic timeline + per-feature scores + inline-editable extracted data + manual-review queue is the single biggest UX gap vs Teko's current admin review screen.

### 1b. Customization / white-label

Configurable per app: brand (logo, colors), transactional email templates, custom domain for the hosted flow; behavior toggles (skip welcome screen, hide progress bar), public app name, privacy-policy URL, callback delay. A live preview renders each hosted screen (Welcome → choose document/country → prepare document → capture front/back → prepare for selfie → liveness → "You've been verified"), with a language selector and "Secured by" footer. White-label must be enabled in the flow editor.

---

## 2. Verification feature catalogue (the checks Didit offers)

Each is a workflow node and can also be called as a one-shot standalone endpoint (`POST /v3/{feature}/`). Per-feature results come back as arrays (e.g. `id_verifications[]`) tagged with the `node_id` that produced them.

| Feature | What it does | Inputs | Notable outputs |
|---|---|---|---|
| **ID Document Verification** | OCR + authenticity for 14,000+ doc types across 220+ countries. | front (+ optional back) image | All personal fields, MRZ (parsed + check digits), barcodes (PDF417/QR), portrait crop, per-image quality score, printed + geocoded + parsed address, warnings[]. |
| **Liveness — Passive** | Anti-spoof / deepfake detection from a selfie, no user action. | selfie | status, score, face_quality, face_luminance, reference image, video. |
| **Liveness — Active** | Challenge-driven (smile, etc.). | selfie/video | as above. |
| **Face Match (1:1)** | Compare live selfie to ID portrait. | user_image + ref_image | similarity score 0–100, decision vs threshold (default 30), face boxes/age/gender. |
| **Face Search (1:N)** | Search a face against the gallery (dedupe / re-use). | face | matches[] with similarity. (Free in Didit pricing.) |
| **AML / Sanctions / PEP / Adverse media** | Screen name against watchlists; optional ongoing monitoring. | full_name (+ DOB, nationality, doc no., entity type) | score, total_hits, hits[] (datasets: PEP/SANCTION/ADVERSE_MEDIA, match scores, linked entities), per-hit review_status (False Positive / Confirmed Match / Inconclusive / Unreviewed). |
| **Proof of Address (PoA)** | Extract + validate address from a bill/statement. | document (image/PDF ≤15MB) | issuer, dates, holder name, address (parsed), classification (utility/bank/gov), name-match score vs ID, tampering flags, configurable max age + language allowlist. |
| **NFC / eMRTD chip read** | Read e-passport/e-ID chip and verify authenticity (SOD/DG). | chip scan | chip_data, portrait, signature image, authenticity, certificate summary. |
| **Age Estimation / Verification** | Estimate age from selfie; gate below threshold (default 18). "Adaptive" falls back to full ID if uncertain. | selfie | estimated age (float), liveness score. |
| **Phone Verification** | SMS/voice OTP + line intelligence. | phone | carrier, line type, is_disposable, is_virtual. |
| **Email Verification** | OTP + deliverability + breach/disposable checks. | email | breaches[] with data classes, disposable flag. |
| **Device & IP Analysis** | Fingerprint device, geolocate IP, detect VPN/Tor/data-center, cross-session match. | passive (browser) | device/OS/browser/ISP, geo, fingerprint, VPN/Tor + data-center flags, distance metrics. |
| **Database / Registry Validation** | Validate identity against gov/registry sources. | identity fields | match_type (full/partial/none), per-source outcomes. |
| **Reusable KYC** | Re-use a prior verified identity across apps/partners via shared `vendor_data`. | prior session ref | matches[] surfaced inside id/liveness/face_match. |
| **Business / KYB** | Registry lookup, UBO/officer discovery, entity+person AML, document collection. | company id/country | registry_checks, officers[], beneficial_owners[] (with per-UBO KYC session links), ownership tree, document cross-checks. |
| **Transaction Monitoring (KYT)** | Real-time txn + crypto-wallet screening, case management. | transactions | score, severity (LOW…CRITICAL), status. |
| **Questionnaires** | Collect structured declarations as a workflow step. | form answers | structured answers. |

Teko today implements: Quality, Document/OCR (CI Paraguay only), Passive + Active Liveness (PAD), Face Match 1:1. Everything else above is a gap (see §6).

---

## 3. Verification flow / workflow orchestration

Workflows are built in the console and pinned per session. Two authoring modes:

- **Simple** — pick a template, toggle features on/off.
- **Advanced** — a visual drag-and-drop **graph editor** with branches and custom logic.

Node types (per docs):
- **Feature nodes** — ID, Liveness, Face Match, NFC, AML, Phone/Email, PoA, Database validation, Device & IP, Age estimation, Questionnaire.
- **Branch nodes** — route on country, risk score, document type, age, date of issue, or status.
- **Action nodes** — add/remove tags, set metadata, add review notes.
- **Webhook node** — make an HTTP call mid-flow and branch on a JSON path of the response.
- **Status nodes** (terminal) — Approved / Declined / In Review.

Each feature result carries the originating `node_id`, so the console can map results back onto the graph. Built-in templates: KYC, Adaptive Age Verification, Biometric Authentication, Address Verification, Questionnaire Verification.

**Client (end-user) flow** (observed in the events timeline + customization preview): open hosted link → Welcome → select document type + country → capture front → capture back → liveness intro → passive/active liveness capture → (face match + device/IP run server-side) → "You've been verified". Each transition is timestamped and logged with device/IP/geo. The flow is hosted by Didit (a `url` returned at session creation), embeddable via iframe/WebView or native SDKs.

---

## 4. API model, webhooks, statuses, data

**Two hosts:** `https://verification.didit.me` (all `/v3/...` verification ops, auth `x-api-key`) and `https://apx.didit.me` (org/app/account management, auth `Authorization: Bearer <JWT>`). An `environment` field ("live"/"sandbox") distinguishes context; no separate sandbox host.

### Auth
- Verification API: header **`x-api-key: <key>`** — long-lived server-side secret (never shipped to browser/app bundle).
- Management API: **Bearer JWT**.
- Programmatic key issuance: `POST /auth/v2/programmatic/register/` then `/verify-email/` (returns `application.api_key`). Keys also created/rotated in console.
- Errors: 401 invalid key, 403 missing scope (e.g. `read:sessions`), 429 rate-limited (`Retry-After`, `X-RateLimit-*`; GET decision ~600/min).

### Core endpoints
- **`POST /v3/session/`** — create a session. Body: `workflow_id` (req), `vendor_data` (your stable user id), `callback` (redirect URL; Didit appends `verificationSessionId` + `status`), `callback_method` (initiator/completer/both), `metadata`, `language`, `contact_details` {email, phone, send_notification_emails, email_lang}, `expected_details` {first_name, last_name, date_of_birth, nationality, id_country, expected_document_types}, `portrait_image` (base64, **required for Biometric Authentication** workflows, disallowed otherwise). Returns: `session_id`, `session_number`, `session_token` (authorizes the end user to the hosted flow), `url` (hosted flow), `status`, echoes of vendor_data/metadata/workflow.
- **`GET /v3/session/{id}/decision/`** — retrieve decision + all feature results. Needs `read:sessions`. `?include=events` adds the event timeline + cost breakdown. Returns `session_kind` (user/business), `status`, `features`, `reviews[]` (each feature has its own `review_status`), `expected_details`, `contact_details`, `environment`, plus all the `*_verifications[]` / `liveness[]` / `face_matches[]` / `aml_screenings[]` arrays. Media are short-lived presigned URLs.
- **Standalone one-shot:** `POST /v3/id-verification/`, `/v3/passive-liveness/`, `/v3/face-match/`, `/v3/aml/`, `/v3/age-estimation/`, `/v3/poa/` — each takes `save_api_request`, `vendor_data`, `metadata`; returns `request_id`, `status`, `warnings`.
- Listing, manual review/override, and data deletion/retention are handled in the console (no dedicated public REST path was documented for those at capture time; decisions are read primarily via the GET above + webhooks).

### Session statuses (full enum, verbatim)
`Not Started`, `In Progress`, `Awaiting User`, `In Review`, `Approved`, `Declined`, `Resubmitted`, `Expired`, `Kyc Expired`, `Abandoned`.
- *Not Started* created, user hasn't begun · *In Progress* user is in the flow · *Awaiting User* paused needing more input · *In Review* completed, routed to manual review · *Approved*/*Declined* final · *Resubmitted* user redid after a resubmit request (carries `resubmit_info`) · *Expired* link/window lapsed · *Kyc Expired* a previously-approved KYC aged out · *Abandoned* started but not finished in time.
- Each **feature** carries its own status independently (session can be Approved while one feature is In Review). AML hit review states: False Positive / Unreviewed / Confirmed Match / Inconclusive. Transaction states: APPROVED / IN_REVIEW / DECLINED / AWAITING_USER with severity UNKNOWN…CRITICAL.

### Webhooks
- Configured as **destinations** (HTTPS URL + `webhook_version: "v3"` + `subscribed_events[]` → returns a `secret_shared_key`). Multiple destinations, no wildcard (every event listed explicitly). Console has a **Test webhook** button.
- **Events (verbatim):** `status.updated`, `data.updated`, `user.status.updated`, `user.data.updated`, `business.status.updated`, `business.data.updated`, `activity.created`, `transaction.created`, `transaction.status.updated`.
- **Envelope:** `event_id` (UUID idempotency), `webhook_type`, `timestamp` (unix s, refreshed per retry), `created_at`, `application_id`, `environment`, `status`. Session events add `session_id`, `session_kind`, `workflow_id`, `workflow_version`, `vendor_data`, `metadata`, `decision` (mirrors the GET decision; present on Approved/Declined/In Review/Abandoned), `resubmit_info`. Entity events add `vendor_user_id`/`vendor_business_id`, `status` (ACTIVE/FLAGGED/BLOCKED), `previous_status`, `changed_fields`, `changes`. Transaction events add `transaction_id`, `score`, `severity`, `amount`, `currency`, `direction`.
- **Signatures (HMAC-SHA256):** `X-Signature-V2` (recommended — over canonical JSON: sorted keys, compact separators), `X-Signature` (over raw bytes), `X-Signature-Simple` (fallback over `{timestamp}:{session_id}:{status}:{webhook_type}`). Constant-time compare. **Replay protection:** reject if `|now − X-Timestamp| > 300s`.
- **Retries:** on 5xx/404/timeout → retry ~1 min, then ~4 min, then dropped; fresh timestamp + signature per retry. Any 2xx = success → respond fast, process async.

### Data returned (ID verification, representative)
`status`, `document_type`/`document_subtype`, `document_number`, `personal_number`, `first_name`/`last_name`/`full_name`, `date_of_birth`, `age`, `gender`, `nationality` (ISO-3), `place_of_birth`, `marital_status`, `date_of_issue`, `expiration_date`, `issuing_state(_name)`, `address` (printed), `formatted_address` (geocoded), `parsed_address` (structured + coords), `portrait_image`, `front/back_image` (presigned) + quality scores, `mrz` (full parsed), `extra_fields`, `barcodes`, `warnings[]`, `matches[]`, `node_id`. Other features return their own objects (liveness scores, face-match score, NFC chip data + authenticity, PoA address + name-match, AML hits, device/IP, etc.).

### SDKs / integration surface
Hosted URL (redirect), iframe, WebView, and native SDKs: **Web (`@didit-protocol/sdk-web`), iOS, Android, React Native, Flutter**. Plus an AI-prompt generator and MCP integration.

---

## 5. Integration flow & validations observed

**5-step Integrate wizard:** (1) get/choose API key → (2) choose workflow (its `workflow_id`) → (3) add a webhook destination (its signing secret) → (4) connect app: choose SDK, copy `.env` secrets + a ready AI prompt → (5) run first session (auto-completes when the first API call lands). The wizard hard-warns: **API key + webhook secret are server-side only, never committed or shipped to the client**.

**Validations / processes observed:**
- `portrait_image` is required for and only allowed on Biometric Authentication workflows — the create call is rejected otherwise. Biometric auth matches a live selfie 1:1 against a reference portrait, which can be pulled from a prior KYC session's liveness reference image (link by reusing the same `vendor_data`).
- Hosted upload accepts JPG/JPEG/PNG/WEBP/TIFF < 5MB for documents; portrait ≤ 2MB.
- Idempotency at the webhook layer via `event_id`; replay window 300s; constant-time signature compare.
- Manual-review queue: sessions can land in **In Review**; the dashboard surfaces "N awaiting review" and the detail panel lets an operator edit extracted fields and approve/decline.
- Cost is computed and shown per feature per session (free tier shows GRATIS lines).

---

## 6. Gap vs Teko today — prioritized roadmap

Teko Verify today (per repo inventory): Org=Tenant model; checks = Quality, Document/OCR (**CI Paraguay only**), Passive+Active Liveness (PAD), Face Match 1:1; LoA L0–L3 decision engine (L4/NFC reserved); `/v1/sessions` API (create/get/list/delete) with Bearer API keys; hosted capture SPA (`/verify/:token`); admin SPA (tenants, sessions, api-keys, metrics, test session); HMAC-signed webhooks (`session.verified`/`session.rejected`); Postgres multi-tenant with audit log + consent (Ley 7593/2025). Stack: Node/Express/TS, Postgres 16, ONNX (SCRFD, ArcFace, MiniFASNet, glasses attrib), PaddleOCR sidecar.

### P0 — closes the credibility gap, modest effort
1. **Configurable workflows/templates** instead of a single hardcoded pipeline. Even a "simple" mode (toggle which checks run + set thresholds per workflow, versioned, referenced by `workflow_id`) unlocks multiple products per customer. Teko's per-tenant `policies` JSONB is the seed; promote it to a first-class versioned `workflows` table.
2. **Richer verification statuses.** Adopt Didit's superset: add `awaiting_user`, `in_review`, `abandoned`, `expired` (Teko has expired), `kyc_expired`, `resubmitted`. Add a **manual review queue** + "N awaiting review" dashboard widget and operator approve/decline with field editing — Teko already has a `review` state; surface it as a queue.
3. **Forensic event timeline per session.** Log every step transition, file upload, button press with timestamp + device/IP/geo, and render it in the admin detail (Didit's "Eventos" tab). High investigative value, low build cost (it's structured audit rows Teko largely already records).
4. **Device & IP analysis.** Capture device fingerprint, IP geolocation, VPN/Tor/data-center flags at capture time. Cheap, high signal, and a distinct feature node.
5. **Expand webhook events + versioning.** Add `status.updated`/`data.updated` granularity, `event_id` idempotency, replay-window check, and a console **Test webhook** + delivery log per session.

### P1 — feature parity that customers will ask for
6. **AML / PEP / sanctions screening** (name screening + ongoing monitoring). No ML needed in-house — integrate a data provider; biggest functional gap for regulated customers.
7. **Multi-document & multi-country.** Generalize OCR/MRZ beyond CI Paraguay (passport, driver's license, residence permit; TD1/TD2/TD3). Largest moat Didit has (14k doc types).
8. **Proof of Address** extraction + name-match + address parsing/geocoding.
9. **Reusable KYC / entity directory.** A `users`/entity table keyed by `vendor_data` that aggregates sessions and exposes entity status (ACTIVE/FLAGGED/BLOCKED) + 1:N face search for dedupe.
10. **White-label customization** (logo/colors/domain/email templates, skip-welcome, hide-progress, privacy URL) with a live per-screen preview.
11. **Org → App split** with per-app keys/webhooks/branding under one org/bill; **RBAC roles**, **team invites**, **audit logs**, **usage/billing** pages.

### P2 — advanced / differentiators
12. **Advanced graph workflow editor** (branch on country/risk/doc-type/age; action nodes for tags/metadata; webhook node; terminal status nodes).
13. **NFC/eMRTD chip reading** (the reserved L4) for e-passports.
14. **Age estimation** node (Teko extracts DOB but doesn't estimate/gate from selfie).
15. **KYB** (business verification, UBO/officer discovery) and **Transaction Monitoring (KYT)**.
16. **Questionnaires** + **Lists** (allow/deny) as workflow building blocks.
17. **Native SDKs** (iOS/Android/RN/Flutter) + iframe/WebView embedding beyond the hosted link, and an **Integrate wizard** that emits ready `.env` + code.

---

## Appendix — capture inventory

Console screenshots and per-section text dumps in `C:\Users\sotelos\Downloads\didit_console\`:
`04_sec_root`/dashboard, `19_users`, `20_businesses`, `21_kyc_verifications`, `22_kyb_verifications`, `23_transactions`, `24_workflows`, `25_customization`, `26_questionnaires`, `27_lists`, `28_integrate`, `29_developers_api-keys`, `30_developers_webhooks`, `31_reports`, `32_settings_team`, `33_org_settings`, `34_verification_detail` (+ matching `_dump_*.json`). Capture scripts: `C:\Users\sotelos\teko\scripts\didit_console_capture.mjs` and `didit_console_sections.mjs`. Login succeeded with no captcha/MFA challenge.
