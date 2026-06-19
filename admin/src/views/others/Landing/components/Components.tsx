import Container from './LandingContainer'
import { motion } from 'framer-motion'
import { Link } from 'react-router'
import componentsIcons from '../utils/components-icons.config'
import { PiFileText, PiCode, PiBook, PiShareNetwork, PiToolbox, PiCodeDuotone } from 'react-icons/pi'

const guideItems = [
    {
        id: 'guide-documentation',
        name: 'Documentación',
        link: '/guide/documentation/introduction',
        icon: <PiBook className="text-emerald-500 text-4xl" />,
        description: 'Guía completa de instalación, configuración y desarrollo',
    },
    {
        id: 'guide-shared-components',
        name: 'Componentes Compartidos',
        link: '/guide/shared-component-doc/AbbreviateNumberDoc/Basic',
        icon: <PiShareNetwork className="text-emerald-500 text-4xl" />,
        description: 'Documentación de 32+ componentes reutilizables',
    },
    {
        id: 'guide-utils',
        name: 'Utilidades',
        link: '/guide/utils-doc/ClassNamesDoc/Basic',
        icon: <PiToolbox className="text-emerald-500 text-4xl" />,
        description: 'Hooks, funciones y helpers del sistema',
    },
    {
        id: 'guide-changelog',
        name: 'Changelog',
        link: '/guide/changelog',
        icon: <PiCodeDuotone className="text-emerald-500 text-4xl" />,
        description: 'Historial de versiones y cambios',
    },
]

const Components = () => {
    return (
        <div id="components" className="relative z-20 py-20 md:py-40">
            <Container>
                <motion.div
                    className="text-center mb-12"
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, type: 'spring', bounce: 0.1 }}
                    viewport={{ once: true }}
                >
                    <motion.h2 className="my-6 text-4xl md:text-5xl">
                        Documentación y{' '}
                        <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                            Guías
                        </span>
                    </motion.h2>
                    <motion.p className="mx-auto max-w-[600px] text-muted dark:text-muted-dark">
                        Todo lo que necesitás para integrar y usar Teko Verify.
                    </motion.p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {guideItems.map((item, i) => (
                        <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{
                                duration: 0.3,
                                delay: i * 0.1,
                                type: 'spring',
                                bounce: 0.1,
                            }}
                            viewport={{ once: true }}
                        >
                            <Link
                                to={item.link}
                                className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 flex flex-col items-center p-6 rounded-2xl h-full transition-colors"
                            >
                                <div className="mb-4">{item.icon}</div>
                                <div className="font-bold text-lg mb-2">
                                    {item.name}
                                </div>
                                <div className="text-sm text-muted dark:text-muted-dark text-center">
                                    {item.description}
                                </div>
                            </Link>
                        </motion.div>
                    ))}
                </div>
            </Container>
        </div>
    )
}

export default Components
