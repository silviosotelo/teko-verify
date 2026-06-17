import { lazy } from 'react'
import type { Routes } from '@/@types/routes'

/**
 * Rutas del dashboard Teko Verify. `authority: []` = abiertas a cualquier
 * operador autenticado (el AuthorityGuard de ecme pasa con authority vacía).
 */
const tekoRoute: Routes = [
    {
        key: 'teko.dashboard',
        path: '/dashboard',
        component: lazy(() => import('@/views/teko/Dashboard')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.sessions',
        path: '/sessions',
        component: lazy(() => import('@/views/teko/Sessions')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.sessionDetail',
        path: '/sessions/:sessionId',
        component: lazy(() => import('@/views/teko/SessionDetail')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.reviewQueue',
        path: '/review-queue',
        component: lazy(() => import('@/views/teko/ReviewQueue')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.workflows',
        path: '/workflows',
        component: lazy(() => import('@/views/teko/Workflows')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.testVerify',
        path: '/test-verify',
        component: lazy(() => import('@/views/teko/TestVerify')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.ocrDebug',
        path: '/ocr-debug',
        component: lazy(() => import('@/views/teko/OcrDebug')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.tenants',
        path: '/tenants',
        component: lazy(() => import('@/views/teko/Tenants')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.apiKeys',
        path: '/api-keys',
        component: lazy(() => import('@/views/teko/ApiKeys')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.webhooks',
        path: '/webhooks',
        component: lazy(() => import('@/views/teko/Webhooks')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'teko.audit',
        path: '/audit',
        component: lazy(() => import('@/views/teko/Audit')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
]

export default tekoRoute
