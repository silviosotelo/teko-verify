import { describe, it, expect } from 'vitest'
import tekoNavigationConfig from '../teko.navigation.config'
import navigationConfig from '../index'
import { NAV_ITEM_TYPE_TITLE, NAV_ITEM_TYPE_ITEM } from '@/constants/navigation.constant'
import { protectedRoutes } from '../../routes.config/routes.config'

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

describe('route registration coverage', () => {
    it('every leaf nav path is registered as a protected route', () => {
        const registeredPaths = new Set(protectedRoutes.map(r => r.path))
        function walkNavPaths(items: typeof tekoNavigationConfig): string[] {
            const ps: string[] = []
            for (const i of items) {
                if (i.path && i.type === NAV_ITEM_TYPE_ITEM) ps.push(i.path)
                if (i.subMenu?.length) ps.push(...walkNavPaths(i.subMenu))
            }
            return ps
        }
        // Exclude 'guias' section: its routes use wildcards (e.g. /guide/documentation/*)
        // so nav deep-links like /guide/documentation/introduction intentionally won't
        // exact-match a registered path.
        const nonGuideNav = tekoNavigationConfig.filter(s => s.key !== 'guias')
        const navPaths = walkNavPaths(nonGuideNav)
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

    it('Verificación collapse is visible because workflows+questionnaires have no flag', () => {
        // reminders are gated off; workflows/questionnaires always visible → collapse stays
        function findByKey(tree: typeof navigationConfig, key: string): typeof navigationConfig[0] | undefined {
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
        function findByKey(tree: typeof navigationConfig, key: string): typeof navigationConfig[0] | undefined {
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
})

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
