import {
    NAV_ITEM_TYPE_TITLE,
    NAV_ITEM_TYPE_ITEM,
} from '@/constants/navigation.constant'
import type { NavigationTree } from '@/@types/navigation'

const tekoNavigationConfig: NavigationTree[] = [
    {
        key: 'teko',
        path: '',
        title: 'Teko Verify',
        translateKey: '',
        icon: 'tekoDashboard',
        type: NAV_ITEM_TYPE_TITLE,
        authority: [],
        subMenu: [
            {
                key: 'teko.dashboard',
                path: '/dashboard',
                title: 'Dashboard',
                translateKey: '',
                icon: 'tekoDashboard',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.sessions',
                path: '/sessions',
                title: 'Sesiones',
                translateKey: '',
                icon: 'tekoSessions',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.testVerify',
                path: '/test-verify',
                title: 'Probar',
                translateKey: '',
                icon: 'tekoTestVerify',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.tenants',
                path: '/tenants',
                title: 'Tenants',
                translateKey: '',
                icon: 'tekoTenants',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.apiKeys',
                path: '/api-keys',
                title: 'API Keys',
                translateKey: '',
                icon: 'tekoApiKeys',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
            {
                key: 'teko.audit',
                path: '/audit',
                title: 'Auditoría',
                translateKey: '',
                icon: 'tekoAudit',
                type: NAV_ITEM_TYPE_ITEM,
                authority: [],
                subMenu: [],
            },
        ],
    },
]

export default tekoNavigationConfig
