import { lazy } from 'react'
import type { Routes } from '@/@types/routes'

const billingRoute: Routes = [
    {
        key: 'billing.plans',
        path: '/billing/plans',
        component: lazy(() => import('@/views/teko/BillingPlans')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'billing.invoices',
        path: '/billing/invoices',
        component: lazy(() => import('@/views/teko/BillingInvoices')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'billing.paymentMethods',
        path: '/billing/payment-methods',
        component: lazy(() => import('@/views/teko/BillingPaymentMethods')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
    {
        key: 'billing.usageAlerts',
        path: '/billing/usage-alerts',
        component: lazy(() => import('@/views/teko/BillingUsageAlerts')),
        authority: [],
        meta: { pageContainerType: 'contained' },
    },
]

export default billingRoute
