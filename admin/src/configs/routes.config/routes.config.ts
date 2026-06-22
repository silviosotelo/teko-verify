import authRoute from './authRoute'
import tekoRoute from './tekoRoute'
import othersRoute from './othersRoute'
import guideRoute from './guideRoute'
import settingsRoute from './settingsRoute'
import billingRoute from './billingRoute'
import integrationsRoute from './integrationsRoute'
import remindersRoute from './remindersRoute'
import type { Routes } from '@/@types/routes'

export const publicRoutes: Routes = [...authRoute]

export const protectedRoutes: Routes = [
    ...tekoRoute,
    ...othersRoute,
    ...guideRoute,
    ...settingsRoute,
    ...billingRoute,
    ...integrationsRoute,
    ...remindersRoute,
]
