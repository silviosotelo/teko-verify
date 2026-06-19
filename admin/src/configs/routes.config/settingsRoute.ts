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
]

export default settingsRoute
