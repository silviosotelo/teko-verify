import { lazy } from 'react'
import type { Routes } from '@/@types/routes'

const settingsRoute: Routes = [
    {
        key: 'settings.email',
        path: '/settings/email',
        component: lazy(() => import('@/views/teko/SettingsEmail')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'settings.storage',
        path: '/settings/storage',
        component: lazy(() => import('@/views/teko/SettingsStorage')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'settings.sms',
        path: '/settings/sms',
        component: lazy(() => import('@/views/teko/SettingsSMS')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'settings.emailTemplates',
        path: '/settings/email-templates',
        component: lazy(() => import('@/views/teko/EmailTemplates')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'settings.rateLimits',
        path: '/settings/rate-limits',
        component: lazy(() => import('@/views/teko/RateLimits')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'settings.faceGallery',
        path: '/settings/face-gallery',
        component: lazy(() => import('@/views/teko/FaceGallery')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
]

export default settingsRoute
