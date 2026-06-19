import authRoute from './authRoute'
import tekoRoute from './tekoRoute'
import othersRoute from './othersRoute'
import guideRoute from './guideRoute'
import billingRoute from './billingRoute'
import integrationsRoute from './integrationsRoute'
import remindersRoute from './remindersRoute'
import settingsRoute from './settingsRoute'
import type { Routes } from '@/@types/routes'

export const publicRoutes: Routes = [...authRoute]

export const protectedRoutes: Routes = [
    ...tekoRoute,
    ...othersRoute,
    ...guideRoute,
    ...billingRoute,
    ...integrationsRoute,
    ...remindersRoute,
    ...settingsRoute,
]
