import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Table from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'
import toast from '@/components/ui/toast'
import Notification from '@/components/ui/Notification'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import { PiShieldCheck, PiDownload, PiCalendar, PiCheckCircle, PiXCircle } from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const ComplianceView = () => {
    const { currentId, loading: tLoading } = useTenant()
    const [report, setReport] = useState<Record<string, unknown> | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [generatedAt, setGeneratedAt] = useState('')

    const generate = async () => {
        if (!currentId) return
        setLoading(true)
        setError('')
        try {
            const res = await tekoApi.compliance(currentId)
            setReport(res.summary)
            setGeneratedAt(res.generatedAt)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Error al generar reporte')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (currentId) generate()
    }, [currentId])

    if (tLoading) return <div className="flex justify-center p-8"><Spinner size={40} /></div>

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold">Reportes de Cumplimiento</h3>
                    <p className="text-sm text-gray-500 mt-1">Resumen de cumplimiento normativo (GDPR / Ley 7593/2025)</p>
                </div>
                <Button variant="solid" loading={loading} icon={<PiShieldCheck />} onClick={generate}>
                    Generar reporte
                </Button>
            </div>

            {error && <Alert showIcon type="danger">{error}</Alert>}

            {loading ? (
                <div className="flex justify-center p-8"><Spinner size={40} /></div>
            ) : report ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                        <h5 className="font-semibold mb-4">Resumen</h5>
                        <div className="space-y-3">
                            {Object.entries(report).map(([key, val]) => (
                                <div key={key} className="flex justify-between py-1.5 border-b text-sm">
                                    <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                                    <span className="font-medium">
                                        {typeof val === 'object' ? JSON.stringify(val).slice(0, 60) : String(val)}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {generatedAt && (
                            <div className="mt-4 text-xs text-gray-400 flex items-center gap-1">
                                <PiCalendar /> Generado: {new Date(generatedAt).toLocaleString('es-PY')}
                            </div>
                        )}
                    </Card>

                    <Card>
                        <h5 className="font-semibold mb-4">Estado de Cumplimiento</h5>
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
                                <PiCheckCircle className="text-green-500 text-xl" />
                                <div>
                                    <div className="font-medium text-sm">Consentimiento Biométrico</div>
                                    <div className="text-xs text-gray-500">Registrado según Ley 7593/2025</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
                                <PiCheckCircle className="text-green-500 text-xl" />
                                <div>
                                    <div className="font-medium text-sm">Derecho al Olvido</div>
                                    <div className="text-xs text-gray-500">Eliminación de datos implementada</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
                                <PiCheckCircle className="text-green-500 text-xl" />
                                <div>
                                    <div className="font-medium text-sm">Retención de Datos</div>
                                    <div className="text-xs text-gray-500">Configurable por tenant</div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            ) : (
                <div className="text-center py-12 text-gray-400">
                    <PiShieldCheck className="mx-auto mb-2 text-4xl" />
                    <p>Haz clic en "Generar reporte" para ver el resumen de cumplimiento</p>
                </div>
            )}
        </div>
    )
}

export default ComplianceView