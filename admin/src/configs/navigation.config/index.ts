import tekoNavigationConfig from './teko.navigation.config'
import { isNavKeyEnabled } from '@/teko/features'
import { NAV_ITEM_TYPE_COLLAPSE } from '@/constants/navigation.constant'
import type { NavigationTree } from '@/@types/navigation'

// Oculta los items cuya feature está apagada. Recursivo sobre subMenu.
// Además poda COLLAPSE parents que quedan con subMenu vacío tras el filtrado
// (evita renders de acordeón vacíos cuando todos sus hijos están gateados).
function filterByFeatures(tree: NavigationTree[]): NavigationTree[] {
    return tree
        .filter((item) => isNavKeyEnabled(item.key))
        .map((item) => ({
            ...item,
            subMenu: item.subMenu ? filterByFeatures(item.subMenu) : [],
        }))
        .filter(
            (item) =>
                item.type !== NAV_ITEM_TYPE_COLLAPSE ||
                (item.subMenu?.length ?? 0) > 0,
        )
}

const navigationConfig: NavigationTree[] = filterByFeatures([
    ...tekoNavigationConfig,
])

export default navigationConfig
