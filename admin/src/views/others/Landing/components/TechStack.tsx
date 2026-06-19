import Container from './LandingContainer'
import { motion } from 'framer-motion'

const TechStack = () => {
    const backendTechs = [
        { name: 'Node.js 22', icon: '⚡', desc: 'Runtime de alto rendimiento' },
        { name: 'Express', icon: '🚂', desc: 'Web framework' },
        { name: 'TypeScript', icon: '🔷', desc: 'Tipado estático' },
        { name: 'PostgreSQL 16', icon: '🐘', desc: 'Base de datos relacional' },
        { name: 'ONNX Runtime', icon: '🤖', desc: 'Inferencia ML' },
        { name: 'PaddleOCR', icon: '📝', desc: 'OCR sidecar' },
        { name: 'Sharp', icon: '🖼️', desc: 'Procesamiento de imágenes' },
        { name: 'Docker', icon: '🐳', desc: 'Containerización' },
    ]

    const frontendTechs = [
        { name: 'React 19', icon: '⚛️', desc: 'UI library' },
        { name: 'Vite 7', icon: '⚡', desc: 'Build tool' },
        { name: 'Tailwind CSS 4', icon: '🎨', desc: 'Utility-first CSS' },
        { name: 'Zustand 5', icon: '📦', desc: 'State management' },
        { name: 'React Router 7', icon: '🧭', desc: 'Routing' },
        { name: 'Framer Motion', icon: '✨', desc: 'Animations' },
        { name: 'ApexCharts', icon: '📊', desc: 'Charts' },
        { name: 'ecme Template', icon: '💎', desc: 'Admin template' },
    ]

    const mlTechs = [
        { name: 'SCRFD', icon: '🔍', desc: 'Face detection' },
        { name: 'ArcFace', icon: '👤', desc: 'Face recognition 512D' },
        { name: 'MiniFASNet', icon: '🛡️', desc: 'PAD anti-spoofing' },
        { name: 'FairFace', icon: '🎂', desc: 'Age estimation' },
        { name: 'DocAligner', icon: '📐', desc: 'Document alignment' },
        { name: 'OpenCV.js', icon: '📄', desc: 'Document detection' },
        { name: 'MediaPipe', icon: '🎭', desc: 'Face landmarks' },
        { name: 'MRZ Parser', icon: '🛂', desc: 'Machine readable zones' },
    ]

    const renderTechSection = (title: string, items: typeof backendTechs, delay: number) => (
        <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay, type: 'spring', bounce: 0.1 }}
            viewport={{ once: true }}
            className="bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-800 p-6"
        >
            <h3 className="text-xl font-bold mb-6 text-center">{title}</h3>
            <div className="grid grid-cols-2 gap-3">
                {items.map((tech) => (
                    <div
                        key={tech.name}
                        className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-100 dark:border-gray-700 text-center hover:border-emerald-500/30 transition-colors"
                    >
                        <div className="text-2xl mb-1">{tech.icon}</div>
                        <div className="font-semibold text-sm">{tech.name}</div>
                        <div className="text-xs text-muted dark:text-muted-dark">
                            {tech.desc}
                        </div>
                    </div>
                ))}
            </div>
        </motion.div>
    )

    return (
        <div id="techstack" className="relative z-20 py-20 md:py-40">
            <Container>
                <motion.div
                    className="text-center mb-12"
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, type: 'spring', bounce: 0.1 }}
                    viewport={{ once: true }}
                >
                    <motion.h2 className="my-6 text-4xl md:text-5xl">
                        Stack{' '}
                        <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                            Tecnológico
                        </span>
                    </motion.h2>
                    <motion.p className="mx-auto max-w-[600px] text-muted dark:text-muted-dark">
                        Tecnologías modernas y probadas para una plataforma
                        enterprise-grade.
                    </motion.p>
                </motion.div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {renderTechSection('Backend API', backendTechs, 0.1)}
                    {renderTechSection('Frontend', frontendTechs, 0.2)}
                    {renderTechSection('Machine Learning', mlTechs, 0.3)}
                </div>
            </Container>
        </div>
    )
}

export default TechStack
