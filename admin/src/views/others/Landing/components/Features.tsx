import Container from './LandingContainer'
import { motion } from 'framer-motion'
import Switcher from '@/components/ui/Switcher'
import presetThemeSchemaConfig from '@/configs/preset-theme-schema.config'
import classNames from '@/utils/classNames'
import { TbCheck } from 'react-icons/tb'
import { Link } from 'react-router'
import type { Mode } from '@/@types/theme'

type FeaturesProps = {
    mode: Mode
    onModeChange: (value: boolean) => void
    schema: string
    setSchema: (value: string) => void
}

const FeatureCard = ({
    icon,
    title,
    description,
    delay,
}: {
    icon: string
    title: string
    description: string
    delay: number
}) => (
    <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay, type: 'spring', bounce: 0.1 }}
        viewport={{ once: true }}
        className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 hover:border-emerald-500/30 transition-colors"
    >
        <div className="text-4xl mb-4">{icon}</div>
        <h4 className="font-bold text-lg mb-2">{title}</h4>
        <p className="text-muted dark:text-muted-dark">{description}</p>
    </motion.div>
)

const TekoFeatures = [
    {
        icon: '📄',
        title: 'Verificación de Documentos',
        description:
            'Extracción OCR de CI paraguayo y pasaporte con detección de fraude, autenticidad y análisis de seguridad. Soporte para MRZ y códigos de barras.',
    },
    {
        icon: '🎭',
        title: 'Detección de Vivencia',
        description:
            'Anti-spoofing pasivo (MiniFASNet ensemble) + desafíos activos con MediaPipe face landmarks. Detección de fotos, videos y máscaras 3D.',
    },
    {
        icon: '👤',
        title: 'Matching Facial 1:1',
        description:
            'Comparación facial con embeddings ArcFace de 512D y similarity cosine. Umbral configurable por nivel de assurance (L0-L4).',
    },
    {
        icon: '🔍',
        title: 'Búsqueda Facial 1:N',
        description:
            'Deduplicación y anti-fraude con búsqueda en galería de rostros existentes. Detección de usuarios duplicados y returners.',
    },
    {
        icon: '🌐',
        title: 'Screening AML/PEP',
        description:
            'Screening contra datasets locales de sanctions, PEP y watchlists. Threshold configurable, scoring y decision engine.',
    },
    {
        icon: '🎂',
        title: 'Estimación de Edad',
        description:
            'FairFace ResNet-34 para estimación de edad facial con detección de underage. Buckets de edad y confidence scores.',
    },
    {
        icon: '🏠',
        title: 'Comprobante de Domicilio',
        description:
            'OCR de recibos y documentos de domicilio con validación de nombre, dirección y antigüedad del documento.',
    },
    {
        icon: '🔒',
        title: '100% On-Premise',
        description:
            'Todos los modelos ONNX, OCR PaddleLocal, datos en tu PostgreSQL. Sin dependencia de servicios externos ni cloud.',
    },
    {
        icon: '⚙️',
        title: 'Workflows Configurables',
        description:
            'Motor de workflows versionados con módulos configurables: quality, liveness, match, aml, face search, questionnaire.',
    },
    {
        icon: '👥',
        title: 'Multi-Tenant + RBAC',
        description:
            'Arquitectura multi-tenant con white-label por tenant. Roles: owner, admin, reviewer, viewer, operator.',
    },
    {
        icon: '📡',
        title: 'Webhooks + SSE',
        description:
            'Webhooks HMAC-signed con retry y dead-letter. SSE para timeline forense en tiempo real.',
    },
    {
        icon: '📊',
        title: 'Dashboard + Métricas',
        description:
            'Dashboard con métricas en tiempo real, approval rates, latency por módulo, usage analytics y audit log.',
    },
]

const Features = ({ mode, onModeChange, schema, setSchema }: FeaturesProps) => {
    return (
        <div id="features" className="relative z-20 py-20 md:py-40">
            <Container>
                <motion.div
                    className="text-center mb-16"
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, type: 'spring', bounce: 0.1 }}
                    viewport={{ once: true }}
                >
                    <motion.h2 className="my-6 text-4xl md:text-5xl font-bold">
                        Plataforma KYC{' '}
                        <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                            Completa
                        </span>
                    </motion.h2>
                    <motion.p className="mx-auto max-w-[600px] text-muted dark:text-muted-dark">
                        Todo lo que necesitas para verificación de identidad
                        empresarial, ejecutado 100% en tu infraestructura.
                    </motion.p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
                    {TekoFeatures.map((feature, i) => (
                        <FeatureCard
                            key={feature.title}
                            icon={feature.icon}
                            title={feature.title}
                            description={feature.description}
                            delay={0.1 + i * 0.05}
                        />
                    ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <motion.div
                        initial={{ opacity: 0, x: -40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, type: 'spring', bounce: 0.1 }}
                        viewport={{ once: true }}
                        className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-800 p-8"
                    >
                        <h3 className="text-2xl font-bold mb-6">
                            Pipeline de Verificación
                        </h3>
                        <div className="space-y-4">
                            {[
                                { step: '1', label: 'Captura de Documento', desc: 'OCR + MRZ + Barcode + Authenticity' },
                                { step: '2', label: 'Captura Selfie + Liveness', desc: 'Face detection + PAD + Active challenges' },
                                { step: '3', label: 'Face Matching 1:1', desc: 'ArcFace embedding + cosine similarity' },
                                { step: '4', label: 'Quality Check', desc: 'Brightness, sharpness, pose, glasses' },
                                { step: '5', label: 'AML Screening', desc: 'Local dataset matching + scoring' },
                                { step: '6', label: 'Face Search 1:N', desc: 'Dedup + anti-fraud gallery' },
                                { step: '7', label: 'Age Estimation', desc: 'FairFace ResNet-34 analysis' },
                                { step: '8', label: 'Decision Engine', desc: 'Verdict + LoA + configurable thresholds' },
                            ].map((item) => (
                                <div key={item.step} className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
                                        {item.step}
                                    </div>
                                    <div>
                                        <div className="font-semibold">{item.label}</div>
                                        <div className="text-sm text-muted dark:text-muted-dark">
                                            {item.desc}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, x: 40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, type: 'spring', bounce: 0.1 }}
                        viewport={{ once: true }}
                        className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-800 p-8"
                    >
                        <h3 className="text-2xl font-bold mb-6">
                            Niveles de Assurance
                        </h3>
                        <div className="space-y-4">
                            {[
                                {
                                    loa: 'L0',
                                    title: 'Nivel Básico',
                                    desc: 'Solo calidad de imagen. Sin liveness ni match.',
                                    checks: ['Quality'],
                                },
                                {
                                    loa: 'L1',
                                    title: 'Nivel Bajo',
                                    desc: 'Quality + Liveness pasivo + Document OCR.',
                                    checks: ['Quality', 'Liveness', 'Document'],
                                },
                                {
                                    loa: 'L2',
                                    title: 'Nivel Medio',
                                    desc: 'L1 + Face matching 1:1 + AML screening.',
                                    checks: ['Quality', 'Liveness', 'Document', 'Match', 'AML'],
                                },
                                {
                                    loa: 'L3',
                                    title: 'Nivel Alto',
                                    desc: 'L2 + Face search 1:N + Age estimation + Proof of address.',
                                    checks: ['Quality', 'Liveness', 'Document', 'Match', 'AML', 'Face Search', 'Age'],
                                },
                                {
                                    loa: 'L4',
                                    title: 'Nivel Máximo',
                                    desc: 'L3 + Active liveness challenges + Human review mandatory.',
                                    checks: ['Quality', 'Liveness', 'Document', 'Match', 'AML', 'Face Search', 'Age', 'Review'],
                                },
                            ].map((item) => (
                                <div
                                    key={item.loa}
                                    className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-emerald-500/30 transition-colors"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-3">
                                            <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold px-3 py-1 rounded-lg text-sm">
                                                {item.loa}
                                            </span>
                                            <span className="font-semibold">{item.title}</span>
                                        </div>
                                    </div>
                                    <p className="text-sm text-muted dark:text-muted-dark mb-2">
                                        {item.desc}
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                        {item.checks.map((check) => (
                                            <span
                                                key={check}
                                                className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-2 py-0.5 rounded-full"
                                            >
                                                {check}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                </div>
            </Container>
        </div>
    )
}

export default Features
