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
