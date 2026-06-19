import { useState } from 'react'
import Button from '@/components/ui/Button'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router'
import { PiMoon, PiSun, PiSignIn, PiList } from 'react-icons/pi'
import type { Mode } from '@/@types/theme'

const NavigationBar = ({
    toggleMode,
    mode,
}: {
    toggleMode: () => void
    mode: Mode
}) => {
    const navigate = useNavigate()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-lg border-b border-gray-200 dark:border-gray-800">
            <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
                <div
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => navigate('/dashboard')}
                >
                    <span className="text-2xl">🛡️</span>
                    <span className="font-bold text-lg">
                        Teko{' '}
                        <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                            Verify
                        </span>
                    </span>
                </div>

                <div className="hidden md:flex items-center gap-6">
                    <a
                        href="#features"
                        className="text-sm hover:text-emerald-500 transition-colors"
                    >
                        Funcionalidades
                    </a>
                    <a
                        href="#techstack"
                        className="text-sm hover:text-emerald-500 transition-colors"
                    >
                        Tech Stack
                    </a>
                    <a
                        href="#components"
                        className="text-sm hover:text-emerald-500 transition-colors"
                    >
                        Guías
                    </a>
                    <a
                        href="#footer"
                        className="text-sm hover:text-emerald-500 transition-colors"
                    >
                        Contacto
                    </a>
                </div>

                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleMode}
                        className="w-10 h-10 p-0 rounded-lg"
                    >
                        {mode === 'light' ? (
                            <PiMoon className="text-lg" />
                        ) : (
                            <PiSun className="text-lg" />
                        )}
                    </Button>
                    <Button
                        variant="solid"
                        size="sm"
                        onClick={() => navigate('/sign-in')}
                        className="flex items-center gap-2"
                    >
                        <PiSignIn />
                        <span className="hidden sm:inline">Iniciar Sesión</span>
                    </Button>
                    <button
                        className="md:hidden w-10 h-10 flex items-center justify-center"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    >
                        <PiList className="text-xl" />
                    </button>
                </div>
            </div>

            {mobileMenuOpen && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="md:hidden border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
                >
                    <div className="px-4 py-3 flex flex-col gap-3">
                        <a
                            href="#features"
                            className="text-sm py-2"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            Funcionalidades
                        </a>
                        <a
                            href="#techstack"
                            className="text-sm py-2"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            Tech Stack
                        </a>
                        <a
                            href="#components"
                            className="text-sm py-2"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            Guías
                        </a>
                        <a
                            href="#footer"
                            className="text-sm py-2"
                            onClick={() => setMobileMenuOpen(false)}
                        >
                            Contacto
                        </a>
                    </div>
                </motion.div>
            )}
        </nav>
    )
}

export default NavigationBar
