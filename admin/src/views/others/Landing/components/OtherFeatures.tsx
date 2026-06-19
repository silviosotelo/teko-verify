import { motion } from 'framer-motion'
import Container from './LandingContainer'
import { PiShieldCheck, PiClock, PiDatabase, PiUsersThree, PiPlugDuotone, PiChartLine } from 'react-icons/pi'

const OtherFeatures = () => {
    const features = [
        {
            icon: <PiShieldCheck className="text-4xl text-emerald-500" />,
            title: 'Seguridad',
            items: [
                'Helmet headers por defecto',
                'HMAC signing en webhooks',
                'RBAC granular (5 roles)',
                'Token único por sesión',
                'SHA-256 en API key hashing',
                'Fail-closed en errores',
            ],
        },
        {
            icon: <PiClock className="text-4xl text-emerald-500" />,
            title: 'Tiempo Real',
            items: [
                'SSE para timeline forense',
                'Polling de estado',
                'Webhooks con retry',
                'Dead-letter tracking',
                'Rate limiting por API',
                'Session events timeline',
            ],
        },
        {
            icon: <PiDatabase className="text-4xl text-emerald-500" />,
            title: 'Datos',
            items: [
                '17 migraciones SQL',
                'Repository pattern',
                'Evidencia con SHA-256',
                'Embeddings 512D face',
                'Retention configurable',
                'Audit log completo',
            ],
        },
        {
            icon: <PiUsersThree className="text-4xl text-emerald-500" />,
            title: 'Multi-Tenant',
            items: [
                'Tenants independientes',
                'White-label por tenant',
                'App scoping',
                'API keys por app',
                'Workflows por tenant',
                'Branding personalizado',
            ],
        },
        {
            icon: <PiPlugDuotone className="text-4xl text-emerald-500" />,
            title: 'Integraciones',
            items: [
                'Webhooks HMAC-signed',
                'REST API completa',
                'SDK TypeScript',
                'SMTP / Office365',
                'CORS allowlist',
                'Docker Compose',
            ],
        },
        {
            icon: <PiChartLine className="text-4xl text-emerald-500" />,
            title: 'Observabilidad',
            items: [
                'Pino logging',
                'Health checks',
                'Latency tracking',
                'Audit trail',
                'Session events',
                'Error tracking',
            ],
        },
    ]

    return (
        <div className="relative z-20 py-20 md:py-40">
            <Container>
                <motion.div
                    className="text-center mb-12"
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, type: 'spring', bounce: 0.1 }}
                    viewport={{ once: true }}
                >
                    <motion.h2 className="my-6 text-4xl md:text-5xl">
                        Características{' '}
                        <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                            Enterprise
                        </span>
                    </motion.h2>
                    <motion.p className="mx-auto max-w-[600px] text-muted dark:text-muted-dark">
                        Construido para producción desde el día uno.
                    </motion.p>
                </motion.div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {features.map((feature, i) => (
                        <motion.div
                            key={feature.title}
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{
                                duration: 0.3,
                                delay: i * 0.08,
                                type: 'spring',
                                bounce: 0.1,
                            }}
                            viewport={{ once: true }}
                            className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-800 p-6"
                        >
                            <div className="mb-4">{feature.icon}</div>
                            <h4 className="font-bold text-lg mb-4">
                                {feature.title}
                            </h4>
                            <ul className="space-y-2">
                                {feature.items.map((item) => (
                                    <li
                                        key={item}
                                        className="flex items-start gap-2 text-sm text-muted dark:text-muted-dark"
                                    >
                                        <span className="text-emerald-500 mt-0.5 shrink-0">
                                            •
                                        </span>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </motion.div>
                    ))}
                </div>
            </Container>
        </div>
    )
}

export default OtherFeatures
