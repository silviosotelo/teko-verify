import { useState } from 'react'
import Button from '@/components/ui/Button'
import Container from './LandingContainer'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router'

type DemoProps = {
    mode: string
}

const demoCategories = [
    {
        id: 'verification',
        name: 'Verificación',
        icon: '🔍',
        demos: [
            { name: 'Captura de Documento', path: '/test-verify' },
            { name: 'Cola de Revisión', path: '/review-queue' },
            { name: 'Inspector OCR', path: '/ocr-debug' },
        ],
    },
    {
        id: 'admin',
        name: 'Administración',
        icon: '⚙️',
        demos: [
            { name: 'Dashboard', path: '/dashboard' },
            { name: 'Tenants', path: '/tenants' },
            { name: 'Equipo', path: '/team' },
        ],
    },
    {
        id: 'config',
        name: 'Configuración',
        icon: '🔧',
        demos: [
            { name: 'Workflows', path: '/workflows' },
            { name: 'API Keys', path: '/api-keys' },
            { name: 'Webhooks', path: '/webhooks' },
        ],
    },
]

const DemoCard = ({
    name,
    path,
}: {
    name: string
    path: string
}) => {
    const navigate = useNavigate()

    return (
        <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate(path)}
            className="bg-gray-50 dark:bg-gray-700 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 cursor-pointer hover:border-emerald-500/30 transition-colors"
        >
            <div className="font-bold text-lg mb-1">{name}</div>
            <div className="text-sm text-muted dark:text-muted-dark">
                Click para navegar →
            </div>
        </motion.div>
    )
}

const Demos = ({ mode }: DemoProps) => {
    const [selectedTab, setSelectedTab] = useState('verification')

    const currentCategory = demoCategories.find(
        (c) => c.id === selectedTab,
    )

    return (
        <div id="demos" className="relative z-20 py-20 md:py-40">
            <motion.div
                className="text-center mb-12"
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, type: 'spring', bounce: 0.1 }}
                viewport={{ once: true }}
            >
                <motion.h2 className="my-6 text-4xl md:text-5xl">
                    Explorá la{' '}
                    <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                        Plataforma
                    </span>
                </motion.h2>
                <motion.p className="mx-auto max-w-[600px] text-muted dark:text-muted-dark">
                    Navegá por las diferentes secciones de Teko Verify.
                </motion.p>
            </motion.div>

            <Container>
                <div className="flex gap-8">
                    <div className="min-w-[200px] hidden md:block">
                        <div className="flex flex-col gap-2">
                            {demoCategories.map((cat) => (
                                <button
                                    key={cat.id}
                                    className={`font-semibold px-3 rounded-lg flex items-center w-full whitespace-nowrap gap-x-2 transition-colors duration-150 h-12 ${
                                        cat.id === selectedTab
                                            ? 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10'
                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-gray-100 dark:hover:bg-gray-700'
                                    }`}
                                    onClick={() => setSelectedTab(cat.id)}
                                >
                                    <span className="text-2xl">
                                        {cat.icon}
                                    </span>
                                    <span>{cat.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
                        <AnimatePresence mode="wait">
                            {currentCategory?.demos.map((demo, i) => (
                                <motion.div
                                    key={demo.name}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                    transition={{ delay: i * 0.1 }}
                                >
                                    <DemoCard
                                        name={demo.name}
                                        path={demo.path}
                                    />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            </Container>
        </div>
    )
}

export default Demos
