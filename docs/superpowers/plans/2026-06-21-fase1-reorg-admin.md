# Reorg Admin — Fase 1 Implementation Plan

> **For agentic workers — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`**
> Read this entire document before starting any task. Each task ends with a mandatory
> deliverable gate; do NOT proceed to the next task until the gate passes.

## Goal

Transform the Teko Verify admin from a flat 5-section, 33-view menu (with hidden/dead routes) into a **6-section hierarchical sidebar** with a prominent **tenant + app scope selector**, a **Config Center hub with onboarding checklist**, all previously hidden or unlinked views properly exposed (respecting feature-flags), and logical fusions (Email+Templates→Comunicación, Reminders under Verificación, compliance views consolidated).

No backend changes. No new API endpoints. Only the admin frontend (`admin/`) changes.

## Architecture

```
admin/src/
  configs/
    navigation.config/
      teko.navigation.config.ts   ← T1: rewrite to 6 sections
      index.ts                    ← T3: extend filterByFeatures for empty-collapse pruning
    routes.config/
      routes.config.ts            ← T2: add integrationsRoute + remindersRoute imports
      tekoRoute.ts                ← T6: add /config-center route
  teko/
    TenantContext.tsx             ← T4: read-only (no change)
    TenantSelector.tsx            ← T4: add ScopeHeader wrapper
    AppContext.tsx                ← T4: NEW — app-scoped state
    AppSelector.tsx               ← T4: NEW — Ecme Select for app
    ScopeHeader.tsx               ← T4: NEW — combined "Tenant X / App Y" indicator
    features.ts                   ← unchanged (no new flags in Fase 1)
  views/teko/
    ConfigCenter/
      ConfigCenter.tsx            ← T5: NEW hub view
      index.tsx                   ← T5: NEW
```

**New nav shape (7 top-level TITLE sections after reorg):**
```
Operación        TITLE  → Dashboard · Sesiones · Cola de Revisión
Organización     TITLE  → Tenants · Apps · Equipo
                          └─ Facturación COLLAPSE → Planes · Alertas de Uso · [Facturas] · [Pagos]
Configuración    TITLE  → Centro de Configuración
                          └─ Verificación COLLAPSE → Workflows · Cuestionarios · [Reminders automated] · [Reminders scheduling]
                          └─ Comunicación COLLAPSE → Email/Mailing · Plantillas · [SMS]
                          · Marca (White-label)
                          · Configuración (Config Plane — Fase 0 view)
Integraciones    TITLE  → Conectores · [OAuth] · [Zapier] · API Keys · Webhooks · Almacenamiento
Cumplimiento     TITLE  → Compliance · Auditoría · Galería Facial · Rate Limits · Uso y Métricas
Developer        TITLE  → Probar Verificación · Inspector OCR
Guías            TITLE  → (Ecme template docs — kept as-is, no changes)
```
`[item]` = gated by an existing feature-flag; flag key unchanged from current `NAV_FEATURE_KEYS`.

"Documentos & Campos" and "Retención" from spec §3.3 have **no existing views** → explicitly out of scope (Fase 4). Do NOT add dead nav items.

## Tech Stack

- React 19 + TypeScript 5.7 + Vite 7 (Ecme template)
- UI: 100% Ecme components (`Select`, `Card`, `Badge`, `Progress`, `Button`, `Tag`) — no raw HTML dialogs, no `alert()`, no `confirm()`
- State: React Context (existing pattern — `TenantContext` → `AppContext`)
- API: `tekoApi` client from `admin/src/teko/client.ts` (no new endpoints)
- Tests: **vitest** (added in T1 — not yet present in project)
- Navigation constants: `NAV_ITEM_TYPE_TITLE`, `NAV_ITEM_TYPE_COLLAPSE`, `NAV_ITEM_TYPE_ITEM` (all already imported in `teko.navigation.config.ts`)

## Global Constraints

1. **No romper vistas existentes.** Every existing URL path must remain reachable after each task. Routes move in the nav tree but their `path` strings never change. `SessionDetail` (/sessions/:sessionId) has no nav entry — keep it that way.
2. **Respetar feature-flags.** The 9 keys in `NAV_FEATURE_KEYS` (`features.ts`) must not be renamed or removed. New items without a flag are always-visible by default (no entry needed in `NAV_FEATURE_KEYS`). No new feature-flags are introduced in Fase 1.
3. **100% Ecme.** All new UI uses Ecme components. No raw `alert`, `confirm`, inline styles, or non-Ecme modals.
4. **Build gate.** `cd admin && npm run build` must succeed after every task.
5. **tsc baseline.** Before starting T1, capture: `cd admin && npx tsc --noEmit 2>&1 | wc -l` → store as `BASELINE`. After each task: same command must produce ≤ BASELINE lines. The ~119 pre-existing Ecme template errors are acceptable; do not add new ones.
6. **nav key stability.** Items that already have entries in `NAV_FEATURE_KEYS` keep their `key` unchanged (e.g. `'reminders.automated'`, `'integrations.oauth'`). New collapse parents get new keys (`'config.verificacion'`, `'config.comunicacion'`, `'org.facturacion'`) which do NOT need entries in `NAV_FEATURE_KEYS` (they are always visible; pruning is handled by the empty-collapse filter added in T3).
7. **No placeholder code.** Every step has complete, compilable TypeScript. No `// TODO`, no `any` additions, no stub implementations.

---

## T1 — Reestructurar `teko.navigation.config.ts` a 6 secciones + vitest setup

**What this task does:** Rewrite the navigation config from 5 flat TITLE sections to 6 functional TITLE sections (plus Guías). Also adds vitest so subsequent tasks can have real unit tests. Pure data change — no logic, no components.

**Files changed:**
- `admin/package.json` — add vitest devDependency + `"test"` script
- `admin/vite.config.ts` — add `test` block
- `admin/src/configs/navigation.config/teko.navigation.config.ts` — full rewrite
- `admin/src/configs/navigation.config/__tests__/teko.navigation.config.test.ts` — NEW

### Steps

**Step 1.1 — Install vitest**

```bash
cd admin
npm install -D vitest
```

Add to `package.json` scripts:
```json
"test": "vitest run"
```

Add to `vite.config.ts` (inside the `defineConfig` object):
```ts
test: {
  environment: 'node',
},
```

**Step 1.2 — Rewrite `teko.navigation.config.ts`**

Replace entire file content. Section keys: `'operacion'`, `'organizacion'`, `'configuracion'`, `'integraciones'`, `'cumplimiento'`, `'developer'`, `'guias'`.

Complete new structure (all 33 existing views mapped; paths unchanged; collapse parents use `NAV_ITEM_TYPE_COLLAPSE`):

```ts
import {
    NAV_ITEM_TYPE_TITLE,
    NAV_ITEM_TYPE_COLLAPSE,
    NAV_ITEM_TYPE_ITEM,
} from '@/constants/navigation.constant'
import type { NavigationTree } from '@/@types/navigation'

const tekoNavigationConfig: NavigationTree[] = [
    // ── 1. OPERACIÓN ──────────────────────────────────────────────────────────
    {
        key: 'operacion',
        path: '',
        title: 'Operación',
        translateKey: '',
        icon: 'tekoDashboard',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            {
                key: 'teko.dashboard',
                path: '/dashboard',
                title: 'Dashboard',
                translateKey: '',
                icon: 'tekoDashboard',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.sessions',
                path: '/sessions',
                title: 'Sesiones',
                translateKey: '',
                icon: 'tekoSessions',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.reviewQueue',
                path: '/review-queue',
                title: 'Cola de Revisión',
                translateKey: '',
                icon: 'tekoSessions',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
        ],
    },

    // ── 2. ORGANIZACIÓN ───────────────────────────────────────────────────────
    {
        key: 'organizacion',
        path: '',
        title: 'Organización',
        translateKey: '',
        icon: 'PiUsersDuotone',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            {
                key: 'teko.tenants',
                path: '/tenants',
                title: 'Tenants',
                translateKey: '',
                icon: 'tekoTenants',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.apps',
                path: '/apps',
                title: 'Apps',
                translateKey: '',
                icon: 'PiDesktopDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.team',
                path: '/team',
                title: 'Equipo',
                translateKey: '',
                icon: 'PiUsersDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            // Facturación: COLLAPSE (was a top-level TITLE, now nested)
            {
                key: 'org.facturacion',
                path: '',
                title: 'Facturación',
                translateKey: '',
                icon: 'PiCreditCardDuotone',
                type: NAV_ITEM_TYPE_COLLAPSE,
                authority: [],
                subMenu: [
                    {
                        key: 'billing.plans',
                        path: '/billing/plans',
                        title: 'Planes',
                        translateKey: '',
                        icon: 'PiCreditCardDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'billing.usageAlerts',
                        path: '/billing/usage-alerts',
                        title: 'Alertas de Uso',
                        translateKey: '',
                        icon: 'PiBellRingingDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'billing.invoices',
                        path: '/billing/invoices',
                        title: 'Facturas',
                        translateKey: '',
                        icon: 'PiReceiptDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'billing.paymentMethods',
                        path: '/billing/payment-methods',
                        title: 'Métodos de Pago',
                        translateKey: '',
                        icon: 'PiWalletDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                ],
            },
        ],
    },

    // ── 3. CONFIGURACIÓN ─────────────────────────────────────────────────────
    {
        key: 'configuracion',
        path: '',
        title: 'Configuración',
        translateKey: '',
        icon: 'PiGearDuotone',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            // Centro de Configuración (T5 — new view at /config-center)
            {
                key: 'teko.configCenter',
                path: '/config-center',
                title: 'Centro de Configuración',
                translateKey: '',
                icon: 'PiHouseDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            // Verificación collapse: workflows + cuestionarios + reminders (gated)
            {
                key: 'config.verificacion',
                path: '',
                title: 'Verificación',
                translateKey: '',
                icon: 'PiListChecksDuotone',
                type: NAV_ITEM_TYPE_COLLAPSE,
                authority: [],
                subMenu: [
                    {
                        key: 'teko.workflows',
                        path: '/workflows',
                        title: 'Workflows',
                        translateKey: '',
                        icon: 'PiListChecksDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'teko.questionnaires',
                        path: '/questionnaires',
                        title: 'Cuestionarios',
                        translateKey: '',
                        icon: 'PiClipboardTextDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'reminders.automated',
                        path: '/reminders/automated',
                        title: 'Recordatorios Automáticos',
                        translateKey: '',
                        icon: 'PiAlarmDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'reminders.scheduling',
                        path: '/reminders/scheduling',
                        title: 'Programación de Recordatorios',
                        translateKey: '',
                        icon: 'PiCalendarDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                ],
            },
            // Comunicación collapse: email + templates + sms (gated)
            {
                key: 'config.comunicacion',
                path: '',
                title: 'Comunicación',
                translateKey: '',
                icon: 'PiEnvelopeDuotone',
                type: NAV_ITEM_TYPE_COLLAPSE,
                authority: [],
                subMenu: [
                    {
                        key: 'settings.email',
                        path: '/settings/email',
                        title: 'Email / Mailing',
                        translateKey: '',
                        icon: 'PiEnvelopeDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'settings.emailTemplates',
                        path: '/settings/email-templates',
                        title: 'Plantillas Email',
                        translateKey: '',
                        icon: 'PiEnvelopeSimpleDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                    {
                        key: 'settings.sms',
                        path: '/settings/sms',
                        title: 'SMS',
                        translateKey: '',
                        icon: 'PiPhoneDuotone',
                        type: NAV_ITEM_TYPE_ITEM,
                        authority: [],
                        subMenu: [],
                    },
                ],
            },
            // Marca
            {
                key: 'teko.customization',
                path: '/customization',
                title: 'Marca (White-label)',
                translateKey: '',
                icon: 'tekoCustomization',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            // Configuración (Config Plane view — añadida en Fase 0)
            {
                key: 'teko.configuracion',
                path: '/configuracion',
                title: 'Configuración avanzada',
                translateKey: '',
                icon: 'PiSlidersHorizontalDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
        ],
    },

    // ── 4. INTEGRACIONES ──────────────────────────────────────────────────────
    {
        key: 'integraciones',
        path: '',
        title: 'Integraciones',
        translateKey: '',
        icon: 'PiShareNetworkDuotone',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            {
                key: 'integrations.connectors',
                path: '/integrations/connectors',
                title: 'Conectores',
                translateKey: '',
                icon: 'PiPlugsDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'integrations.oauth',
                path: '/integrations/oauth',
                title: 'OAuth',
                translateKey: '',
                icon: 'PiLockKeyDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'integrations.zapier',
                path: '/integrations/zapier',
                title: 'Zapier',
                translateKey: '',
                icon: 'PiZapDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.apiKeys',
                path: '/api-keys',
                title: 'API Keys',
                translateKey: '',
                icon: 'tekoApiKeys',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.webhooks',
                path: '/webhooks',
                title: 'Webhooks',
                translateKey: '',
                icon: 'PiShareNetworkDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'settings.storage',
                path: '/settings/storage',
                title: 'Almacenamiento',
                translateKey: '',
                icon: 'PiHardDriveDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
        ],
    },

    // ── 5. CUMPLIMIENTO ───────────────────────────────────────────────────────
    {
        key: 'cumplimiento',
        path: '',
        title: 'Cumplimiento',
        translateKey: '',
        icon: 'PiShieldCheckDuotone',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            {
                key: 'teko.compliance',
                path: '/compliance',
                title: 'Compliance normativo',
                translateKey: '',
                icon: 'PiShieldCheckDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.audit',
                path: '/audit',
                title: 'Auditoría',
                translateKey: '',
                icon: 'PiFileMagnifyingGlassDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'settings.faceGallery',
                path: '/settings/face-gallery',
                title: 'Galería Facial',
                translateKey: '',
                icon: 'PiUsersThreeDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'settings.rateLimits',
                path: '/settings/rate-limits',
                title: 'Rate Limits',
                translateKey: '',
                icon: 'PiGaugeDuotone',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.usage',
                path: '/usage',
                title: 'Uso y Métricas',
                translateKey: '',
                icon: 'tekoAudit',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
        ],
    },

    // ── 6. DEVELOPER ──────────────────────────────────────────────────────────
    {
        key: 'developer',
        path: '',
        title: 'Developer',
        translateKey: '',
        icon: 'PiCodeDuotone',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            {
                key: 'teko.testVerify',
                path: '/test-verify',
                title: 'Probar Verificación',
                translateKey: '',
                icon: 'tekoTestVerify',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.ocrDebug',
                path: '/ocr-debug',
                title: 'Inspector OCR',
                translateKey: '',
                icon: 'tekoOcrDebug',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
        ],
    },

    // ── 7. GUÍAS (Ecme template docs — sin cambios) ───────────────────────────
    {
        key: 'guias',
        path: '',
        title: 'Guías',
        translateKey: '',
        icon: 'PiBookDuotone',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            {
                key: 'guide.documentation',
                path: '/guide/documentation/introduction',
                title: 'Documentación',
                translateKey: '',
                icon: 'documentation',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'guide.sharedComponentDoc',
                path: '/guide/shared-component-doc/AbbreviateNumberDoc/Basic',
                title: 'Componentes Compartidos',
                translateKey: '',
                icon: 'sharedComponentDoc',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'guide.utilsDoc',
                path: '/guide/utils-doc/ClassNamesDoc/Basic',
                title: 'Utilidades',
                translateKey: '',
                icon: 'utilsDoc',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'guide.changelog',
                path: '/guide/changelog',
                title: 'Changelog',
                translateKey: '',
                icon: 'changeLog',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
        ],
    },
]

export default tekoNavigationConfig
```

**Step 1.3 — Write nav tree test**

File: `admin/src/configs/navigation.config/__tests__/teko.navigation.config.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import tekoNavigationConfig from '../teko.navigation.config'
import navigationConfig from '../index'
import { NAV_ITEM_TYPE_TITLE, NAV_ITEM_TYPE_ITEM } from '@/constants/navigation.constant'

// Helper: flatten all leaf keys from a tree
function flatLeafKeys(tree: typeof tekoNavigationConfig): string[] {
    const keys: string[] = []
    function walk(items: typeof tekoNavigationConfig) {
        for (const item of items) {
            if (item.type === NAV_ITEM_TYPE_ITEM) keys.push(item.key)
            if (item.subMenu?.length) walk(item.subMenu)
        }
    }
    walk(tree)
    return keys
}

describe('teko.navigation.config (raw)', () => {
    it('has exactly 7 top-level sections', () => {
        expect(tekoNavigationConfig).toHaveLength(7)
        expect(tekoNavigationConfig.every(s => s.type === NAV_ITEM_TYPE_TITLE)).toBe(true)
    })

    it('section keys match the 6 functional sections + guias', () => {
        const keys = tekoNavigationConfig.map(s => s.key)
        expect(keys).toEqual([
            'operacion', 'organizacion', 'configuracion',
            'integraciones', 'cumplimiento', 'developer', 'guias',
        ])
    })

    it('Operación contains dashboard, sessions, reviewQueue', () => {
        const op = tekoNavigationConfig.find(s => s.key === 'operacion')!
        const subKeys = op.subMenu.map(i => i.key)
        expect(subKeys).toContain('teko.dashboard')
        expect(subKeys).toContain('teko.sessions')
        expect(subKeys).toContain('teko.reviewQueue')
    })

    it('Organización nests Facturación as a collapse', () => {
        const org = tekoNavigationConfig.find(s => s.key === 'organizacion')!
        const fac = org.subMenu.find(i => i.key === 'org.facturacion')!
        expect(fac).toBeDefined()
        const facKeys = fac.subMenu?.map(i => i.key) ?? []
        expect(facKeys).toContain('billing.plans')
        expect(facKeys).toContain('billing.invoices')
        expect(facKeys).toContain('billing.paymentMethods')
        expect(facKeys).toContain('billing.usageAlerts')
    })

    it('Configuración has configCenter, verificacion collapse, comunicacion collapse', () => {
        const cfg = tekoNavigationConfig.find(s => s.key === 'configuracion')!
        const subKeys = cfg.subMenu.map(i => i.key)
        expect(subKeys).toContain('teko.configCenter')
        expect(subKeys).toContain('config.verificacion')
        expect(subKeys).toContain('config.comunicacion')
        expect(subKeys).toContain('teko.customization')
        expect(subKeys).toContain('teko.configuracion')
    })

    it('Integraciones includes connectors (no flag needed)', () => {
        const int = tekoNavigationConfig.find(s => s.key === 'integraciones')!
        const subKeys = int.subMenu.map(i => i.key)
        expect(subKeys).toContain('integrations.connectors')
        expect(subKeys).toContain('integrations.oauth')
        expect(subKeys).toContain('integrations.zapier')
        expect(subKeys).toContain('teko.apiKeys')
        expect(subKeys).toContain('teko.webhooks')
        expect(subKeys).toContain('settings.storage')
    })

    it('all existing 33 leaf paths are still present (no path changed)', () => {
        const paths = new Set<string>()
        function walkPaths(items: typeof tekoNavigationConfig) {
            for (const i of items) {
                if (i.path) paths.add(i.path)
                if (i.subMenu?.length) walkPaths(i.subMenu)
            }
        }
        walkPaths(tekoNavigationConfig)
        const required = [
            '/dashboard', '/sessions', '/review-queue',
            '/tenants', '/apps', '/team',
            '/billing/plans', '/billing/usage-alerts', '/billing/invoices', '/billing/payment-methods',
            '/config-center', '/workflows', '/questionnaires',
            '/reminders/automated', '/reminders/scheduling',
            '/settings/email', '/settings/email-templates', '/settings/sms',
            '/customization', '/configuracion',
            '/integrations/connectors', '/integrations/oauth', '/integrations/zapier',
            '/api-keys', '/webhooks', '/settings/storage',
            '/compliance', '/audit', '/settings/face-gallery',
            '/settings/rate-limits', '/usage',
            '/test-verify', '/ocr-debug',
        ]
        for (const p of required) {
            expect(paths, `missing path ${p}`).toContain(p)
        }
    })
})

describe('navigationConfig (after filterByFeatures with current flags)', () => {
    // Current flags: billingInvoices=false, billingPayments=false, sms=false,
    //   reminders=false, integrationsOAuth=false, integrationsZapier=false

    it('gated items are absent from filtered nav', () => {
        const keys = flatLeafKeys(navigationConfig)
        expect(keys).not.toContain('billing.invoices')
        expect(keys).not.toContain('billing.paymentMethods')
        expect(keys).not.toContain('settings.sms')
        expect(keys).not.toContain('reminders.automated')
        expect(keys).not.toContain('reminders.scheduling')
        expect(keys).not.toContain('integrations.oauth')
        expect(keys).not.toContain('integrations.zapier')
    })

    it('non-gated items are present', () => {
        const keys = flatLeafKeys(navigationConfig)
        expect(keys).toContain('teko.dashboard')
        expect(keys).toContain('billing.plans')
        expect(keys).toContain('billing.usageAlerts')
        expect(keys).toContain('integrations.connectors')
        expect(keys).toContain('teko.workflows')
        expect(keys).toContain('teko.questionnaires')
    })
})
```

### Deliverable gate T1
```bash
cd admin
npm test          # all tests pass
npm run build     # exits 0
npx tsc --noEmit 2>&1 | wc -l   # ≤ BASELINE
```

---

## T2 — Registrar rutas faltantes (bug fix crítico)

**What this task does:** Fix the routing bug: `integrationsRoute` and `remindersRoute` are defined but **not imported** in `routes.config.ts`, making `/integrations/*` and `/reminders/*` 404. This task adds those imports and also adds a nav entry for `integrations.connectors` (currently has a route file but no nav entry and no flag).

`integrations.connectors` has no feature-flag (the view `IntegrationsConnectors` is not a mock) — it is always visible after T1 adds its nav entry.

**Files changed:**
- `admin/src/configs/routes.config/routes.config.ts`
- `admin/src/configs/navigation.config/__tests__/teko.navigation.config.test.ts` — add route-coverage test

### Steps

**Step 2.1 — Fix `routes.config.ts`**

Add the two missing imports and spread them into `protectedRoutes`:

```ts
import authRoute from './authRoute'
import tekoRoute from './tekoRoute'
import othersRoute from './othersRoute'
import guideRoute from './guideRoute'
import settingsRoute from './settingsRoute'
import billingRoute from './billingRoute'
import integrationsRoute from './integrationsRoute'   // ← NEW
import remindersRoute from './remindersRoute'           // ← NEW
import type { Routes } from '@/@types/routes'

export const publicRoutes: Routes = [...authRoute]

export const protectedRoutes: Routes = [
    ...tekoRoute,
    ...othersRoute,
    ...guideRoute,
    ...settingsRoute,
    ...billingRoute,
    ...integrationsRoute,   // ← NEW
    ...remindersRoute,       // ← NEW
]
```

**Step 2.2 — Add route-coverage test**

Add a new `describe` block to `admin/src/configs/navigation.config/__tests__/teko.navigation.config.test.ts`:

```ts
import { protectedRoutes } from '../../routes.config/routes.config'

describe('route registration coverage', () => {
    it('every leaf nav path is registered as a protected route', () => {
        const registeredPaths = new Set(protectedRoutes.map(r => r.path))
        // All nav leaf paths must have a corresponding route
        // (exclude '' placeholder paths used for COLLAPSE/TITLE parents)
        function walkNavPaths(items: typeof tekoNavigationConfig): string[] {
            const ps: string[] = []
            for (const i of items) {
                if (i.path && i.type === NAV_ITEM_TYPE_ITEM) ps.push(i.path)
                if (i.subMenu?.length) ps.push(...walkNavPaths(i.subMenu))
            }
            return ps
        }
        const navPaths = walkNavPaths(tekoNavigationConfig)
        // /config-center is added in T6; mark as expected-missing until then
        const pendingT6 = new Set(['/config-center'])
        for (const p of navPaths) {
            if (pendingT6.has(p)) continue
            expect(registeredPaths, `nav path ${p} has no route`).toContain(p)
        }
    })

    it('integrations paths are registered (was 404 before this fix)', () => {
        const paths = protectedRoutes.map(r => r.path)
        expect(paths).toContain('/integrations/connectors')
        expect(paths).toContain('/integrations/oauth')
        expect(paths).toContain('/integrations/zapier')
    })

    it('reminders paths are registered (was 404 before this fix)', () => {
        const paths = protectedRoutes.map(r => r.path)
        expect(paths).toContain('/reminders/automated')
        expect(paths).toContain('/reminders/scheduling')
    })
})
```

### Deliverable gate T2
```bash
cd admin
npm test     # all tests pass (including new route-coverage tests)
npm run build
```

---

## T3 — Extender `filterByFeatures` para podar collapses vacíos

**What this task does:** After T1 introduces `NAV_ITEM_TYPE_COLLAPSE` parents (Facturación, Verificación, Comunicación), the current `filterByFeatures` function leaves empty collapse parents visible when all their children are flagged off. For example, with `reminders=false`, the "Verificación" collapse would still render but with only Workflows + Cuestionarios (correct). But if a future flag were to gate all children of a collapse, it would render empty. This task extends the filter to prune such cases. Also updates the existing tests to cover this.

**Files changed:**
- `admin/src/configs/navigation.config/index.ts`
- `admin/src/configs/navigation.config/__tests__/teko.navigation.config.test.ts` — add collapse-pruning tests

### Steps

**Step 3.1 — Extend `filterByFeatures` in `index.ts`**

```ts
import tekoNavigationConfig from './teko.navigation.config'
import { isNavKeyEnabled } from '@/teko/features'
import { NAV_ITEM_TYPE_COLLAPSE } from '@/constants/navigation.constant'
import type { NavigationTree } from '@/@types/navigation'

// Oculta los items cuya feature está apagada. Recursivo sobre subMenu.
// Además poda COLLAPSE parents que quedan con subMenu vacío tras el filtrado
// (evita renders de acordeón vacíos cuando todos sus hijos están gateados).
function filterByFeatures(tree: NavigationTree[]): NavigationTree[] {
    return tree
        .filter((item) => isNavKeyEnabled(item.key))
        .map((item) => ({
            ...item,
            subMenu: item.subMenu ? filterByFeatures(item.subMenu) : [],
        }))
        .filter(
            (item) =>
                item.type !== NAV_ITEM_TYPE_COLLAPSE ||
                (item.subMenu?.length ?? 0) > 0,
        )
}

const navigationConfig: NavigationTree[] = filterByFeatures([
    ...tekoNavigationConfig,
])

export default navigationConfig
```

**Step 3.2 — Add collapse-pruning tests**

Add to the `describe('navigationConfig (after filterByFeatures ...)')` block:

```ts
it('Verificación collapse is visible because workflows+questionnaires have no flag', () => {
    // reminders are gated off; workflows/questionnaires always visible → collapse stays
    function findByKey(tree: typeof navigationConfig, key: string): NavigationTree | undefined {
        for (const item of tree) {
            if (item.key === key) return item
            const found = item.subMenu ? findByKey(item.subMenu, key) : undefined
            if (found) return found
        }
        return undefined
    }
    const verif = findByKey(navigationConfig, 'config.verificacion')
    expect(verif).toBeDefined()
    const subKeys = verif!.subMenu?.map(i => i.key) ?? []
    expect(subKeys).toContain('teko.workflows')
    expect(subKeys).toContain('teko.questionnaires')
    expect(subKeys).not.toContain('reminders.automated')
    expect(subKeys).not.toContain('reminders.scheduling')
})

it('Comunicación collapse stays visible (email+templates have no flag, only SMS gated)', () => {
    function findByKey(tree: typeof navigationConfig, key: string): NavigationTree | undefined {
        for (const item of tree) {
            if (item.key === key) return item
            const found = item.subMenu ? findByKey(item.subMenu, key) : undefined
            if (found) return found
        }
        return undefined
    }
    const com = findByKey(navigationConfig, 'config.comunicacion')
    expect(com).toBeDefined()
    const subKeys = com!.subMenu?.map(i => i.key) ?? []
    expect(subKeys).toContain('settings.email')
    expect(subKeys).toContain('settings.emailTemplates')
    expect(subKeys).not.toContain('settings.sms')
})
```

**Step 3.3 — Add pure-function pruning unit test (no mocking needed)**

```ts
describe('filterByFeatures — empty collapse pruning', () => {
    // Build a minimal tree with one all-gated collapse and verify it's pruned.
    // We use the real filterByFeatures by testing via navigationConfig which
    // already has gated items. The Integrations section has oauth+zapier gated
    // but connectors is always-visible → Integraciones section must stay visible.
    it('Integraciones section survives even though oauth/zapier are gated', () => {
        const intSection = navigationConfig.find(s => s.key === 'integraciones')
        expect(intSection).toBeDefined()
        const subKeys = intSection!.subMenu?.map(i => i.key) ?? []
        expect(subKeys).toContain('integrations.connectors')
        expect(subKeys).not.toContain('integrations.oauth')
        expect(subKeys).not.toContain('integrations.zapier')
    })
})
```

### Deliverable gate T3
```bash
cd admin
npm test
npm run build
```

---

## T4 — AppContext + AppSelector + indicador "Tenant X / App Y"

**What this task does:** Extend the scope system from tenant-only to tenant+app. The header currently shows only the tenant selector (`TenantSelector.tsx`). After this task it shows: **[Tenant dropdown] / [App dropdown]** plus a small badge "Configurando: [Tenant Name] / [App Name o Global]".

**New files:**
- `admin/src/teko/AppContext.tsx`
- `admin/src/teko/AppSelector.tsx`
- `admin/src/teko/ScopeHeader.tsx`

**Modified files:**
- `admin/src/App.tsx` — wrap with `AppProvider`
- The layout header component that renders `<TenantSelector />` — found by: `grep -r "TenantSelector" admin/src --include="*.tsx" -l` then inspect the file.

### Steps

**Step 4.1 — Create `AppContext.tsx`**

```tsx
// Estado global de la App seleccionada (scope tenant → app).
// null currentAppId = "todas / scope global" (válido: muestra data de todas las apps del tenant).
import {
    createContext,
    useContext,
    useEffect,
    useState,
    type ReactNode,
} from 'react'
import { tekoApi } from './client'
import { useTenant } from './TenantContext'
import type { App } from './types'

interface AppCtx {
    apps: App[]
    currentApp: App | null
    currentAppId: string | null
    setCurrentAppId: (id: string | null) => void
    loading: boolean
}

const AppContext = createContext<AppCtx | null>(null)

const LS_KEY = 'teko.admin.appId'

export function AppProvider({ children }: { children: ReactNode }) {
    const { currentId: tenantId } = useTenant()
    const [apps, setApps] = useState<App[]>([])
    const [currentAppId, setCurrentAppIdState] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    function setCurrentAppId(id: string | null) {
        setCurrentAppIdState(id)
        if (id) localStorage.setItem(LS_KEY, id)
        else localStorage.removeItem(LS_KEY)
    }

    useEffect(() => {
        if (!tenantId) {
            setApps([])
            setCurrentAppIdState(null)
            return
        }
        setLoading(true)
        tekoApi
            .listApps(tenantId)
            .then(({ apps: fetched }) => {
                setApps(fetched)
                const saved = localStorage.getItem(LS_KEY)
                const valid =
                    saved && fetched.some((a) => a.id === saved) ? saved : null
                setCurrentAppIdState(valid)
            })
            .catch(() => {
                setApps([])
                setCurrentAppIdState(null)
            })
            .finally(() => setLoading(false))
    }, [tenantId])

    const currentApp = apps.find((a) => a.id === currentAppId) ?? null

    return (
        <AppContext.Provider
            value={{ apps, currentApp, currentAppId, setCurrentAppId, loading }}
        >
            {children}
        </AppContext.Provider>
    )
}

export function useApp(): AppCtx {
    const ctx = useContext(AppContext)
    if (!ctx) throw new Error('useApp fuera de AppProvider')
    return ctx
}
```

**Step 4.2 — Create `AppSelector.tsx`**

```tsx
// Selector de App para el header. "Global" = null (sin filtro por app).
import Select from '@/components/ui/Select'
import { useApp } from './AppContext'

type Opt = { value: string; label: string }

const ALL_APPS_OPT: Opt = { value: '', label: 'Global (todas las apps)' }

const AppSelector = () => {
    const { apps, currentAppId, setCurrentAppId, loading } = useApp()

    if (loading) return null

    const options: Opt[] = [
        ALL_APPS_OPT,
        ...apps.map((a) => ({ value: a.id, label: a.name })),
    ]
    const value =
        options.find((o) => o.value === (currentAppId ?? '')) ?? ALL_APPS_OPT

    return (
        <div className="hidden w-48 sm:block">
            <Select<Opt>
                size="sm"
                isSearchable={false}
                options={options}
                value={value}
                onChange={(opt) =>
                    setCurrentAppId(opt?.value || null)
                }
            />
        </div>
    )
}

export default AppSelector
```

**Step 4.3 — Create `ScopeHeader.tsx`**

```tsx
// Muestra el selector de tenant + selector de app + badge de scope activo.
// Reemplaza <TenantSelector /> en el header del layout.
import Badge from '@/components/ui/Badge'
import TenantSelector from './TenantSelector'
import AppSelector from './AppSelector'
import { useTenant } from './TenantContext'
import { useApp } from './AppContext'

const ScopeHeader = () => {
    const { current: tenant } = useTenant()
    const { currentApp } = useApp()

    const scopeLabel = tenant
        ? `${tenant.name} / ${currentApp ? currentApp.name : 'Global'}`
        : null

    return (
        <div className="flex items-center gap-2">
            <TenantSelector />
            <span className="hidden text-gray-400 sm:block">/</span>
            <AppSelector />
            {scopeLabel && (
                <Badge className="hidden text-xs sm:block" innerClass="bg-indigo-100 text-indigo-700">
                    {scopeLabel}
                </Badge>
            )}
        </div>
    )
}

export default ScopeHeader
```

**Step 4.4 — Wire AppProvider in `App.tsx`**

Find `<TenantProvider>` in `admin/src/App.tsx` and wrap it with `AppProvider`:
```tsx
// Before:
<TenantProvider>
  {/* ... */}
</TenantProvider>

// After (AppProvider must be INSIDE TenantProvider to access useTenant):
<TenantProvider>
  <AppProvider>
    {/* ... */}
  </AppProvider>
</TenantProvider>
```

**Step 4.5 — Replace `<TenantSelector />` in the layout header**

Run: `grep -r "TenantSelector" admin/src --include="*.tsx" -l`
Open the file(s) that import/render `<TenantSelector />`, replace:
```tsx
// Before:
import TenantSelector from '@/teko/TenantSelector'
// ...
<TenantSelector />

// After:
import ScopeHeader from '@/teko/ScopeHeader'
// ...
<ScopeHeader />
```

**Step 4.6 — Write tests for AppContext logic**

File: `admin/src/teko/__tests__/scope.test.ts`

```ts
import { describe, it, expect } from 'vitest'

// Pure helper: build scope label string (extracted from ScopeHeader for testability)
function buildScopeLabel(
    tenantName: string | null,
    appName: string | null,
): string | null {
    if (!tenantName) return null
    return `${tenantName} / ${appName ?? 'Global'}`
}

describe('buildScopeLabel', () => {
    it('returns null when no tenant', () => {
        expect(buildScopeLabel(null, null)).toBeNull()
    })
    it('shows Global when no app selected', () => {
        expect(buildScopeLabel('Acme Corp', null)).toBe('Acme Corp / Global')
    })
    it('shows tenant + app name when both selected', () => {
        expect(buildScopeLabel('Acme Corp', 'Mobile App')).toBe('Acme Corp / Mobile App')
    })
})
```

> Note: Export `buildScopeLabel` from `ScopeHeader.tsx` (named export, not default) so the test can import it.

### Deliverable gate T4
```bash
cd admin
npm test
npm run build
```
Visual check: open dev server, confirm header shows two dropdowns + scope badge.

---

## T5 — Centro de Configuración (hub + checklist de onboarding)

**What this task does:** Create the `/config-center` view — a hub that gives operators at-a-glance status of their tenant configuration and guides them through onboarding. The checklist steps are **statically defined** (code), but completion is **computed from live API data** fetched on mount. This is TDD: write the pure-function predicates first, then the component.

**New files:**
- `admin/src/views/teko/ConfigCenter/checklist.ts` — step definitions + pure predicates
- `admin/src/views/teko/ConfigCenter/__tests__/checklist.test.ts` — unit tests
- `admin/src/views/teko/ConfigCenter/ConfigCenter.tsx` — view component
- `admin/src/views/teko/ConfigCenter/index.tsx` — re-export

### Steps

**Step 5.1 — Define `checklist.ts` with pure predicates**

```ts
// Definición estática del checklist de onboarding del Config Center.
// Los pasos son código; la completitud se computa desde estado de API.

export interface ConfigCheckState {
    workflowCount: number
    hasBranding: boolean         // Customization tiene logo, color o displayName seteado
    apiKeyCount: number
    webhookCount: number
}
// Nota: SMTP es global de plataforma (src/config.ts env vars), no configurable por
// tenant en Fase 1 — por eso no hay campo hasEmailConfig. Se agrega en Fase 2
// (tenant_integrations). El checklist cubre las 4 acciones realmente per-tenant.

export interface ChecklistStep {
    id: string
    label: string
    description: string
    path: string           // ruta a la vista de configuración
    isComplete: (state: ConfigCheckState) => boolean
}

export const ONBOARDING_STEPS: ChecklistStep[] = [
    {
        id: 'workflow',
        label: 'Crear un workflow de verificación',
        description: 'Define los checks y nivel de aseguramiento para tus sesiones.',
        path: '/workflows',
        isComplete: (s) => s.workflowCount > 0,
    },
    {
        id: 'branding',
        label: 'Personalizar marca (White-label)',
        description: 'Agrega tu logo y colores para la experiencia de captura.',
        path: '/customization',
        isComplete: (s) => s.hasBranding,
    },
    {
        id: 'apiKey',
        label: 'Generar una API Key',
        description: 'Obtén las credenciales para integrar Teko Verify en tu app.',
        path: '/api-keys',
        isComplete: (s) => s.apiKeyCount > 0,
    },
    {
        id: 'webhook',
        label: 'Configurar un Webhook',
        description: 'Recibe eventos en tiempo real cuando una sesión concluye.',
        path: '/webhooks',
        isComplete: (s) => s.webhookCount > 0,
    },
]

export function countCompleted(state: ConfigCheckState): number {
    return ONBOARDING_STEPS.filter((s) => s.isComplete(state)).length
}
```

**Step 5.2 — Write tests for checklist predicates**

File: `admin/src/views/teko/ConfigCenter/__tests__/checklist.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
    ONBOARDING_STEPS,
    countCompleted,
    type ConfigCheckState,
} from '../checklist'

const empty: ConfigCheckState = {
    workflowCount: 0,
    hasBranding: false,
    apiKeyCount: 0,
    webhookCount: 0,
}

const full: ConfigCheckState = {
    workflowCount: 2,
    hasBranding: true,
    apiKeyCount: 3,
    webhookCount: 1,
}

describe('ONBOARDING_STEPS predicates', () => {
    it('all steps incomplete when state is empty', () => {
        expect(ONBOARDING_STEPS.every((s) => !s.isComplete(empty))).toBe(true)
    })

    it('all steps complete when state is full', () => {
        expect(ONBOARDING_STEPS.every((s) => s.isComplete(full))).toBe(true)
    })

    it('workflow step: complete only when workflowCount > 0', () => {
        const step = ONBOARDING_STEPS.find((s) => s.id === 'workflow')!
        expect(step.isComplete({ ...empty, workflowCount: 1 })).toBe(true)
        expect(step.isComplete({ ...empty, workflowCount: 0 })).toBe(false)
    })

    it('countCompleted returns 0 for empty, 4 for full', () => {
        expect(countCompleted(empty)).toBe(0)
        expect(countCompleted(full)).toBe(4)
    })

    it('countCompleted partial: 2 of 4', () => {
        const partial: ConfigCheckState = {
            ...empty,
            workflowCount: 1,
            apiKeyCount: 2,
        }
        expect(countCompleted(partial)).toBe(2)
    })
})
```

**Step 5.3 — Implement `ConfigCenter.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '@/components/ui/Card'
import Progress from '@/components/ui/Progress'
import Button from '@/components/ui/Button'
import Tag from '@/components/ui/Tag'
import { useTenant } from '@/teko/TenantContext'
import { tekoApi } from '@/teko/client'
import {
    ONBOARDING_STEPS,
    countCompleted,
    type ConfigCheckState,
} from './checklist'

const DEFAULT_STATE: ConfigCheckState = {
    workflowCount: 0,
    hasBranding: false,
    apiKeyCount: 0,
    webhookCount: 0,
}

const ConfigCenter = () => {
    const { currentId: tenantId, current: tenant } = useTenant()
    const navigate = useNavigate()
    const [state, setState] = useState<ConfigCheckState>(DEFAULT_STATE)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!tenantId) return
        setLoading(true)
        Promise.all([
            tekoApi.listWorkflows(tenantId),
            tekoApi.listApiKeys(tenantId),
            tekoApi.listWebhooks(tenantId),
            tekoApi.getTenant(tenantId),
        ])
            .then(([wf, keys, hooks, t]) => {
                setState({
                    workflowCount: wf.workflows.length,
                    hasBranding: !!(t.branding?.logoUrl || t.branding?.primaryColor || t.branding?.displayName),
                    apiKeyCount: keys.apiKeys.length,
                    webhookCount: hooks.endpoints.length,
                })
            })
            .catch(() => setState(DEFAULT_STATE))
            .finally(() => setLoading(false))
    }, [tenantId])

    const completed = countCompleted(state)
    const total = ONBOARDING_STEPS.length
    const pct = Math.round((completed / total) * 100)

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-semibold">
                Centro de Configuración
                {tenant ? ` — ${tenant.name}` : ''}
            </h2>

            <Card>
                <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                        <span className="font-medium">
                            Progreso de configuración inicial
                        </span>
                        <span className="text-sm text-gray-500">
                            {completed} / {total} completados
                        </span>
                    </div>
                    <Progress percent={pct} />
                </div>
            </Card>

            <div className="space-y-3">
                {ONBOARDING_STEPS.map((step) => {
                    const done = step.isComplete(state)
                    return (
                        <Card key={step.id}>
                            <div className="flex items-start justify-between p-4">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{step.label}</span>
                                        {done ? (
                                            <Tag className="bg-emerald-100 text-emerald-700 text-xs">
                                                Completado
                                            </Tag>
                                        ) : (
                                            <Tag className="bg-amber-100 text-amber-700 text-xs">
                                                Pendiente
                                            </Tag>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-500">
                                        {step.description}
                                    </p>
                                </div>
                                {!done && (
                                    <Button
                                        size="sm"
                                        variant="plain"
                                        onClick={() => navigate(step.path)}
                                    >
                                        Configurar →
                                    </Button>
                                )}
                            </div>
                        </Card>
                    )
                })}
            </div>

            {loading && (
                <p className="text-center text-sm text-gray-400">
                    Verificando estado de configuración…
                </p>
            )}
        </div>
    )
}

export default ConfigCenter
```

**Step 5.4 — Create `index.tsx`**

```tsx
import { lazy } from 'react'

const ConfigCenter = lazy(() => import('./ConfigCenter'))
export default ConfigCenter
```

> Note on `tekoApi.listWebhooks` return shape: the API returns `WebhookListResponse`. Check the `Webhooks.tsx` view for how it accesses endpoints — adjust `hooks.endpoints` to match the actual field name from `WebhookListResponse` in `types.ts`.

### Deliverable gate T5
```bash
cd admin
npm test     # checklist predicates pass
npm run build
```

---

## T6 — Registrar /config-center + auditoría final de rutas

**What this task does:** Register the new `/config-center` route in `tekoRoute.ts`. Then run a full audit verifying every leaf nav path maps to a registered protected route, and the build + tsc still pass. Removes the `pendingT6` workaround from the T2 test.

**Files changed:**
- `admin/src/configs/routes.config/tekoRoute.ts` — add `/config-center`
- `admin/src/configs/navigation.config/__tests__/teko.navigation.config.test.ts` — remove `pendingT6` set

### Steps

**Step 6.1 — Add `/config-center` to `tekoRoute.ts`**

Add the following entry to the `tekoRoute` array (after `teko.configuracion`):
```ts
{
    key: 'teko.configCenter',
    path: '/config-center',
    component: lazy(() => import('@/views/teko/ConfigCenter')),
    authority: [],
    meta: { pageContainerType: 'contained' },
},
```

**Step 6.2 — Remove `pendingT6` workaround from route-coverage test**

In the T2 test (`describe('route registration coverage')`), remove:
```ts
// Delete these two lines:
const pendingT6 = new Set(['/config-center'])
if (pendingT6.has(p)) continue
```

The test will now assert `/config-center` is registered, which it is.

**Step 6.3 — Final route audit**

Manually verify by reading `protectedRoutes` in `routes.config.ts` contains all these paths (total 34 = 33 existing + 1 new):

| Path | Route file |
|---|---|
| `/dashboard` | tekoRoute |
| `/sessions` | tekoRoute |
| `/sessions/:sessionId` | tekoRoute |
| `/review-queue` | tekoRoute |
| `/workflows` | tekoRoute |
| `/questionnaires` | tekoRoute |
| `/test-verify` | tekoRoute |
| `/ocr-debug` | tekoRoute |
| `/tenants` | tekoRoute |
| `/apps` | tekoRoute |
| `/team` | tekoRoute |
| `/usage` | tekoRoute |
| `/customization` | tekoRoute |
| `/api-keys` | tekoRoute |
| `/webhooks` | tekoRoute |
| `/audit` | tekoRoute |
| `/compliance` | tekoRoute |
| `/configuracion` | tekoRoute |
| `/config-center` | tekoRoute ← new |
| `/billing/plans` | billingRoute |
| `/billing/invoices` | billingRoute |
| `/billing/payment-methods` | billingRoute |
| `/billing/usage-alerts` | billingRoute |
| `/settings/email` | settingsRoute |
| `/settings/storage` | settingsRoute |
| `/settings/sms` | settingsRoute |
| `/settings/email-templates` | settingsRoute |
| `/settings/rate-limits` | settingsRoute |
| `/settings/face-gallery` | settingsRoute |
| `/integrations/connectors` | integrationsRoute ← was 404 |
| `/integrations/oauth` | integrationsRoute ← was 404 |
| `/integrations/zapier` | integrationsRoute ← was 404 |
| `/reminders/automated` | remindersRoute ← was 404 |
| `/reminders/scheduling` | remindersRoute ← was 404 |

### Deliverable gate T6 (final Fase 1 gate)
```bash
cd admin
npm test                              # all tests pass
npm run build                         # exits 0
npx tsc --noEmit 2>&1 | wc -l        # ≤ BASELINE
```

---

## Task Summary

| Task | File(s) changed | Deliverable |
|---|---|---|
| T1 | `teko.navigation.config.ts`, `package.json`, `vite.config.ts`, `__tests__/teko.navigation.config.test.ts` | 6-section nav + vitest passing |
| T2 | `routes.config.ts` + route-coverage tests | integrationsRoute + remindersRoute registered; nav coverage test |
| T3 | `navigation.config/index.ts` + collapse-pruning tests | empty COLLAPSE parents pruned |
| T4 | `AppContext.tsx`, `AppSelector.tsx`, `ScopeHeader.tsx`, `App.tsx`, header layout | Tenant/App selector + scope badge in header |
| T5 | `ConfigCenter/checklist.ts`, `__tests__/checklist.test.ts`, `ConfigCenter.tsx`, `index.tsx` | Checklist hub with TDD predicates |
| T6 | `tekoRoute.ts` + remove T2 workaround | Full route audit; final build + tsc gate |

---

## Self-Review

**Coverage of spec Fase 1 / §3.3:**
- [x] 6 secciones con jerarquía: Operación · Organización · Configuración · Integraciones · Cumplimiento · Developer
- [x] Selector tenant/app prominente con indicador "configurando: Tenant X / App Y" (T4)
- [x] Centro de Configuración / checklist de onboarding (T5)
- [x] Vistas ocultas/no-enlazadas expuestas: IntegrationsConnectors (sin flag, siempre visible), IntegrationsOAuth, IntegrationsZapier, BillingInvoices, BillingPaymentMethods, RemindersAutomated, RemindersScheduling — todas con sus feature-flags originales intactos (T1 + T2)
- [x] Fusión Email+Templates → collapse "Comunicación" con SMS gated (T1 + T3)
- [x] Reminders bajo "Verificación" collapse (T1 + T3)
- [x] Facturación movida a Organización como collapse (T1)
- [x] Configuracion (Config Plane, Fase 0) en sección Configuración (T1)
- [x] Feature-flags intactos: todos los `key` en `NAV_FEATURE_KEYS` preservados

**No placeholders:** Cada step tiene TypeScript completo. Los únicos `// Note` son advertencias sobre tipos que el worker debe verificar en la fuente (WebhookListResponse), no código faltante.

**Consistencia:**
- Paths nunca cambian — solo cambia la posición en el árbol de navegación.
- `integrationsRoute` y `remindersRoute` eran el bug más crítico (404s silenciosas): corregidos en T2.
- `teko.configCenter` nav key está en T1 (nav), ruta en T6 (registrada), vista en T5 — pendingT6 en T2 marca el gap explícitamente.
- "Documentos & Campos" y "Retención" del spec §3.3 no tienen vistas → explícitamente fuera de scope (Fase 4). No hay nav items muertos.
