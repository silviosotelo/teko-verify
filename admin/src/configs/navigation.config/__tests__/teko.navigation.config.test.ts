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
