import Container from './LandingContainer'
import Button from '@/components/ui/Button'
import AuroraBackground from './AuroraBackground'
import { motion } from 'framer-motion'
import { MODE_DARK, MODE_LIGHT } from '@/constants/theme.constant'
import { useNavigate } from 'react-router'
import type { Mode } from '@/@types/theme'
import { PiEnvelope, PiPhone, PiGlobe, PiShieldCheck } from 'react-icons/pi'

const LandingFooter = ({ mode }: { mode: Mode }) => {
    const year = new Date().getFullYear()

    const navigate = useNavigate()

    const handlePreview = () => {
        navigate('/dashboard')
    }

    return (
        <div id="footer" className="relative z-20">
            <Container className="relative">
                <div className="py-10 md:py-40">
                    <AuroraBackground
                        className="rounded-3xl"
                        auroraClassName="rounded-3xl"
                    >
                        <motion.div
                            initial={{ opacity: 0.0, y: 40 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{
                                delay: 0.3,
                                duration: 0.3,
                                ease: 'easeInOut',
                            }}
                            className="relative flex flex-col gap-4 items-center justify-center py-20 px-8 text-center"
                        >
                            <h2 className="text-5xl font-bold mb-4">
                                ¿Listo para verificar identidad?
                            </h2>
                            <p className="text-muted dark:text-muted-dark max-w-2xl mb-10 text-lg">
                                Teko Verify es una plataforma completa de KYC
                                on-premise. Sin dependencia de servicios cloud,
                                sin datos salen de tu infraestructura.
                            </p>
                            <div className="flex items-center gap-4">
                                <Button variant="solid" onClick={handlePreview}>
                                    Ir al Dashboard
                                </Button>
                            </div>
                        </motion.div>
                    </AuroraBackground>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mt-20 pb-12">
                        <div>
                            <h4 className="font-bold text-lg mb-4">Teko Verify</h4>
                            <p className="text-muted dark:text-muted-dark text-sm">
                                Plataforma KYC 100% on-premise con verificación
                                de documento, liveness, face matching, AML y más.
                            </p>
                        </div>
                        <div>
                            <h4 className="font-bold text-lg mb-4">
                                Plataforma
                            </h4>
                            <ul className="space-y-2 text-sm text-muted dark:text-muted-dark">
                                <li>Verificación de Documentos</li>
                                <li>Detección de Vivencia</li>
                                <li>Matching Facial</li>
                                <li>Screening AML/PEP</li>
                                <li>Workflows Configurables</li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-lg mb-4">
                                Administración
                            </h4>
                            <ul className="space-y-2 text-sm text-muted dark:text-muted-dark">
                                <li>Dashboard + Métricas</li>
                                <li>Cola de Revisión</li>
                                <li>Multi-Tenant + RBAC</li>
                                <li>White Label</li>
                                <li>Audit Log</li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-bold text-lg mb-4">Contacto</h4>
                            <ul className="space-y-3 text-sm text-muted dark:text-muted-dark">
                                <li className="flex items-center gap-2">
                                    <PiEnvelope className="text-emerald-500" />
                                    info@teko.dev
                                </li>
                                <li className="flex items-center gap-2">
                                    <PiPhone className="text-emerald-500" />
                                    +595 000 000 000
                                </li>
                                <li className="flex items-center gap-2">
                                    <PiGlobe className="text-emerald-500" />
                                    teko.dev
                                </li>
                                <li className="flex items-center gap-2">
                                    <PiShieldCheck className="text-emerald-500" />
                                    Ley 7593/2025 - Protección de Datos
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-800 pt-8 text-center text-sm text-muted dark:text-muted-dark">
                        <p>
                            © {year} Teko Verify. Todos los derechos reservados.
                            Plataforma de verificación de identidad con Ley 7593
                            (Protección de Datos Personales - Paraguay).
                        </p>
                    </div>
                </div>
            </Container>
        </div>
    )
}

export default LandingFooter
