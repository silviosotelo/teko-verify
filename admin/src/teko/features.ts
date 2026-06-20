// Feature flags del panel Teko Verify (Sprint 1 "monetización-lite").
// `true` = la vista está implementada con backend real y se muestra en el menú.
// `false` = maqueta sin backend; se OCULTA del sidebar (sin borrar archivos/rutas).
//
// El ocultamiento se aplica en src/configs/navigation.config/index.ts mapeando
// la `key` de cada item de navegación contra estos flags (ver NAV_FEATURE_KEYS).
export const FEATURES = {
    billingPlans: true,
    usageAlerts: true,
    billingInvoices: false,
    billingPayments: false,
    sms: false,
    reminders: false,
    integrationsOAuth: false,
    integrationsZapier: false,
} as const

export type FeatureFlag = keyof typeof FEATURES

// Mapa de `key` de item de navegación → flag de FEATURES. Las keys que NO
// aparezcan acá se consideran siempre visibles. Sólo listamos las gated.
export const NAV_FEATURE_KEYS: Record<string, FeatureFlag> = {
    'billing.plans': 'billingPlans',
    'billing.usageAlerts': 'usageAlerts',
    'billing.invoices': 'billingInvoices',
    'billing.paymentMethods': 'billingPayments',
    'settings.sms': 'sms',
    'reminders.automated': 'reminders',
    'reminders.scheduling': 'reminders',
    'integrations.oauth': 'integrationsOAuth',
    'integrations.zapier': 'integrationsZapier',
}

// ¿Este item de navegación debe mostrarse según los flags?
export function isNavKeyEnabled(key: string): boolean {
    const flag = NAV_FEATURE_KEYS[key]
    return flag ? FEATURES[flag] : true
}
