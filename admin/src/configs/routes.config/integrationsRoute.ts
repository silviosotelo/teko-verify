import { lazy } from 'react'
import type { Routes } from '@/@types/routes'

const integrationsRoute: Routes = [
    {
        key: 'integrations.connectors',
        path: '/integrations/connectors',
        component: lazy(() => import('@/views/teko/IntegrationsConnectors')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'integrations.oauth',
        path: '/integrations/oauth',
        component: lazy(() => import('@/views/teko/IntegrationsOAuth')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'integrations.zapier',
        path: '/integrations/zapier',
        component: lazy(() => import('@/views/teko/IntegrationsZapier')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'integrations.providers',
        path: '/integrations/providers',
        component: lazy(() => import('@/views/teko/TenantIntegrations')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
]

export default integrationsRoute
