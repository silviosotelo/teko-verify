import authRoute from './authRoute'
import tekoRoute from './tekoRoute'
import type { Routes } from '@/@types/routes'

export const publicRoutes: Routes = [...authRoute]

export const protectedRoutes: Routes = [...tekoRoute]
