import classNames from 'classnames'
import type { CommonProps } from '@/@types/common'

interface LogoProps extends CommonProps {
    type?: 'full' | 'streamline'
    mode?: 'light' | 'dark'
    imgClass?: string
    logoWidth?: number | string
}

/**
 * Marca TEKO (Teko Verify). Reemplaza el logo PNG de ecme por una marca de texto
 * con el verde primario. `type='streamline'` (colapsado) muestra solo el badge.
 */
const Logo = (props: LogoProps) => {
    const { type = 'full', className, style } = props

    return (
        <div
            className={classNames(
                'logo flex items-center gap-2 px-1',
                className,
            )}
            style={style}
        >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-bold text-white">
                T
            </span>
            {type === 'full' && (
                <span className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                    TEKO
                </span>
            )}
        </div>
    )
}

export default Logo
