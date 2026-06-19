import Button from '@/components/ui/Button'
import { motion } from 'framer-motion'
import TextGenerateEffect from './TextGenerateEffect'
import { MODE_DARK, MODE_LIGHT } from '@/constants/theme.constant'
import { useNavigate } from 'react-router'
import type { Mode } from '@/@types/theme'

const HeroContent = ({ mode }: { mode: Mode }) => {
    const navigate = useNavigate()

    const handleLogin = () => {
        navigate('/sign-in')
    }

    const handleDashboard = () => {
        navigate('/dashboards/ecommerce')
    }

    return (
        <div className="max-w-7xl mx-auto px-4 flex min-h-screen flex-col items-center justify-between">
            <div className="flex flex-col min-h-screen pt-20 md:pt-40 relative overflow-hidden">
                <div>
                    <TextGenerateEffect
                        wordClassName="text-2xl md:text-4xl lg:text-8xl font-bold max-w-7xl mx-auto text-center mt-6 relative z-10"
                        words="Verificación de Identidad Inteligente"
                        wordsCallbackClass={({ word }) => {
                            if (word === 'Identidad') {
                                return 'bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent'
                            }

                            if (word === 'Inteligente') {
                                return 'bg-gradient-to-r from-teal-500 to-cyan-500 bg-clip-text text-transparent'
                            }

                            return ''
                        }}
                    />
                    <motion.p
                        initial={{ opacity: 0, translateY: 40 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ duration: 0.3, delay: 0.5 }}
                        className="text-center mt-6 text-base md:text-xl text-muted dark:text-muted-dark max-w-5xl mx-auto relative z-10 font-normal"
                    >
                        Plataforma KYC 100% on-premise con verificación de documento,
                        detección de vivencia, matching facial, screening AML/PEP,
                        estimación de edad y búsqueda facial 1:N. Todo ejecutándose
                        localmente, sin datos salen de tu infraestructura.
                    </motion.p>
                    <motion.div
                        initial={{ opacity: 0, translateY: 40 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ duration: 0.3, delay: 0.6 }}
                        className="flex items-center gap-4 justify-center mt-10 relative z-10"
                    >
                        <Button variant="solid" onClick={handleLogin}>
                            Iniciar Sesión
                        </Button>
                        <Button variant="outline" onClick={handleDashboard}>
                            Ver Demo
                        </Button>
                    </motion.div>
                </div>
                <div className="p-2 lg:p-4 border border-gray-200 bg-gray-50 dark:bg-gray-700 dark:border-gray-700 rounded-2xl lg:rounded-[32px] mt-20 relative">
                    <div className="absolute inset-x-0 bottom-0 h-40 w-full bg-gradient-to-b from-transparent via-white to-white dark:via-black/50 dark:to-black scale-[1.1] pointer-events-none" />
                    <div className="bg-white dark:bg-black dark:border-gray-700 border border-gray-200 rounded-[24px]">
                        <div className="relative">
                            <div className="bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 rounded-[24px] p-8 md:p-12 min-h-[300px] flex flex-col justify-center items-center text-white">
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ delay: 0.8, duration: 0.5 }}
                                    className="text-center"
                                >
                                    <div className="text-6xl md:text-8xl mb-6">🛡️</div>
                                    <h3 className="text-2xl md:text-4xl font-bold mb-4">
                                        Teko Verify
                                    </h3>
                                    <div className="flex flex-wrap gap-3 justify-center">
                                        {['Documento KYC', 'Liveness PAD', 'Face Match', 'AML/PEP', '1:N Search', 'Age Est.'].map(
                                            (feature, i) => (
                                                <motion.span
                                                    key={feature}
                                                    initial={{ opacity: 0, y: 20 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: 1 + i * 0.15 }}
                                                    className="bg-white/20 backdrop-blur-sm rounded-full px-4 py-2 text-sm font-medium"
                                                >
                                                    {feature}
                                                </motion.span>
                                            ),
                                        )}
                                    </div>
                                </motion.div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default HeroContent
