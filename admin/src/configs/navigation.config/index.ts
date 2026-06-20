import tekoNavigationConfig from './teko.navigation.config'
import { isNavKeyEnabled } from '@/teko/features'
import type { NavigationTree } from '@/@types/navigation'

// Oculta del sidebar los items cuya feature está apagada (FEATURES en
// src/teko/features.ts). Recursivo sobre subMenu: si un item gated tiene flag
// false se descarta; los no-gated se mantienen. No borra rutas ni archivos.
function filterByFeatures(tree: NavigationTree[]): NavigationTree[] {
    return tree
        .filter((item) => isNavKeyEnabled(item.key))
        .map((item) => ({
            ...item,
            subMenu: item.subMenu ? filterByFeatures(item.subMenu) : [],
        }))
}

const navigationConfig: NavigationTree[] = filterByFeatures([
    ...tekoNavigationConfig,
])

export default navigationConfig
