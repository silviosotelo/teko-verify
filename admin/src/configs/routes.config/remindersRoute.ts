import { lazy } from 'react'
import type { Routes } from '@/@types/routes'

const remindersRoute: Routes = [
    {
        key: 'reminders.automated',
        path: '/reminders/automated',
        component: lazy(() => import('@/views/teko/RemindersAutomated')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'reminders.scheduling',
        path: '/reminders/scheduling',
        component: lazy(() => import('@/views/teko/RemindersScheduling')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
]

export default remindersRoute
