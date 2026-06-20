import { useState } from 'react'
import { motion } from 'framer-motion'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Dialog from '@/components/ui/Dialog'
import ConfirmDialog from '@/components/shared/ConfirmDialog'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Skeleton from '@/components/ui/Skeleton'
import Spinner from '@/components/ui/Spinner'
import { tekoApi } from '@/teko/client'
import { useTenant } from '@/teko/TenantContext'
import classNames from '@/utils/classNames'
import {
    PiCreditCard,
    PiVisa,
    PiMasterCardLogo,
    PiPlus,
    PiTrash,
    PiCheckCircle,
    PiCreditCard as PiCards,
    PiEye,
    PiEyeSlash,
} from 'react-icons/pi'

interface PaymentMethod {
    id: string
    last4: string
    brand: 'visa' | 'mastercard' | 'amex' | 'discover'
    expiryMonth: number
    expiryYear: number
    isDefault: boolean
    holderName: string
    createdAt: string
}

const MOCK_METHODS: PaymentMethod[] = [
    {
        id: 'pm_1',
        last4: '4242',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2027,
        isDefault: true,
        holderName: 'Juan Pérez',
        createdAt: '2026-01-15',
    },
    {
        id: 'pm_2',
        last4: '5555',
        brand: 'mastercard',
        expiryMonth: 6,
        expiryYear: 2026,
        isDefault: false,
        holderName: 'Juan Pérez',
        createdAt: '2025-06-20',
    },
]

function BrandIcon({ brand }: { brand: PaymentMethod['brand'] }) {
    const config: Record<string, { color: string; label: string }> = {
        visa: { color: 'text-blue-700', label: 'Visa' },
        mastercard: { color: 'text-red-500', label: 'Mastercard' },
        amex: { color: 'text-blue-500', label: 'Amex' },
        discover: { color: 'text-orange-500', label: 'Discover' },
    }
    const { color } = config[brand] ?? {}
    return (
        <span className={classNames('text-2xl font-bold font-mono', color)}>
            {brand === 'visa' && 'V'}
            {brand === 'mastercard' && (
                <span className="flex -space-x-2">
                    <span className="w-5 h-5 rounded-full bg-red-500" />
                    <span className="w-5 h-5 rounded-full bg-yellow-400" />
                </span>
            )}
            {brand === 'amex' && 'A'}
            {brand === 'discover' && 'D'}
        </span>
    )
}

function CardVisual({ method }: { method: PaymentMethod }) {
    return (
        <div
            className={classNames(
                'relative overflow-hidden rounded-xl p-5 text-white',
                method.brand === 'visa'
                    ? 'bg-gradient-to-br from-blue-700 to-blue-900'
                    : method.brand === 'mastercard'
                        ? 'bg-gradient-to-br from-gray-800 to-gray-950'
                        : 'bg-gradient-to-br from-blue-500 to-cyan-600',
            )}
        >
            <div className="absolute right-4 top-4 opacity-20">
                <PiCards className="w-24 h-24" />
            </div>
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-6">
                    <BrandIcon brand={method.brand} />
                    {method.isDefault && (
                        <Badge variant="solid" color="emerald" className="text-xs">
                            <PiCheckCircle className="w-3 h-3" />
                            Default
                        </Badge>
                    )}
                </div>
                <div className="font-mono text-lg tracking-widest mb-4">
                    •••• •••• •••• {method.last4}
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-xs opacity-70">Titular</div>
                        <div className="text-sm font-medium">{method.holderName}</div>
                    </div>
                    <div className="text-right">
                        <div className="text-xs opacity-70">Vence</div>
                        <div className="text-sm font-medium">
                            {String(method.expiryMonth).padStart(2, '0')}/{String(method.expiryYear).slice(-2)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function BillingPaymentMethods() {
    const { current, currentId, loading: tLoading } = useTenant()
    const [methods, setMethods] = useState<PaymentMethod[]>(MOCK_METHODS)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [newBrand, setNewBrand] = useState<'visa' | 'mastercard'>('visa')
    const [newLast4, setNewLast4] = useState('')
    const [newExpiry, setNewExpiry] = useState('')
    const [newHolder, setNewHolder] = useState('')

    useEffect(() => {
        if (!currentId) {
            setLoading(false)
            return
        }
        setLoading(true)
        tekoApi
            .usage(currentId)
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [currentId])

    function handleAdd() {
        if (!newLast4 || !newExpiry || !newHolder) return
        const parts = newExpiry.split('/')
        const month = parseInt(parts[0], 10)
        const year = parseInt(parts[1], 10)
        const last4Digits = newLast4.replace(/\s/g, '').slice(-4)

        const newMethod: PaymentMethod = {
            id: `pm_${Date.now()}`,
            last4: last4Digits || '0000',
            brand: newBrand,
            expiryMonth: isNaN(month) ? 12 : month,
            expiryYear: isNaN(year) ? 2027 : year + (year < 100 ? 2000 : 0),
            isDefault: methods.length === 0,
            holderName: newHolder,
            createdAt: new Date().toISOString().slice(0, 10),
        }

        setMethods((prev) => [...prev, newMethod])
        setDialogOpen(false)
        setNewLast4('')
        setNewExpiry('')
        setNewHolder('')
    }

    function handleDelete(id: string) {
        setDeletingId(id)
        setConfirmDeleteOpen(true)
    }

    function confirmDelete() {
        if (deletingId) {
            setMethods((prev) => prev.filter((m) => m.id !== deletingId))
            setConfirmDeleteOpen(false)
            setDeletingId(null)
        }
    }

    function handleSetDefault(id: string) {
        setMethods((prev) =>
            prev.map((m) => ({ ...m, isDefault: m.id === id })),
        )
    }

    const defaultMethod = methods.find((m) => m.isDefault)

    if (tLoading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Métodos de Pago</h3>
                <p className="text-gray-500">
                    {current
                        ? `Administra los métodos de pago de ${current.name}`
                        : 'Administra tus métodos de pago'}
                </p>
            </div>

            {error && (
                <Alert showIcon type="danger" className="mb-6">
                    {error}
                </Alert>
            )}

            {loading ? (
                <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        {[0, 1].map((i) => (
                            <Card key={i}>
                                <Skeleton className="h-44 w-full" />
                            </Card>
                        ))}
                    </div>
                </div>
            ) : (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                >
                    <div className="flex items-center justify-between mb-6">
                        <div className="text-sm text-gray-500">
                            {methods.length} método{methods.length !== 1 ? 's' : ''} guardado{methods.length !== 1 ? 's' : ''}
                        </div>
                        <Button variant="solid" onClick={() => setDialogOpen(true)}>
                            <PiPlus className="w-4 h-4" />
                            Agregar método
                        </Button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        {methods.length === 0 ? (
                            <Card className="col-span-2 py-12">
                                <div className="text-center">
                                    <PiCards className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                                    <div className="text-gray-500">
                                        No hay métodos de pago guardados.
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="mt-3"
                                        onClick={() => setDialogOpen(true)}
                                    >
                                        Agregar primer método
                                    </Button>
                                </div>
                            </Card>
                        ) : (
                            methods.map((method) => (
                                <motion.div
                                    key={method.id}
                                    layout
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                >
                                    <Card className="relative">
                                        <CardVisual method={method} />
                                        <div className="mt-4 flex items-center justify-between">
                                            <div className="text-sm text-gray-500">
                                                Terminada en ••{method.last4}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {!method.isDefault && (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleSetDefault(method.id)}
                                                    >
                                                        Establecer como default
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    color="red"
                                                    iconOnly
                                                    onClick={() => handleDelete(method.id)}
                                                    title="Eliminar"
                                                >
                                                    <PiTrash className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>
                                </motion.div>
                            ))
                        )}
                    </div>
                </motion.div>
            )}

            <Dialog
                open={dialogOpen}
                onClose={() => {
                    setDialogOpen(false)
                    setNewLast4('')
                    setNewExpiry('')
                    setNewHolder('')
                }}
                title="Agregar método de pago"
                description="Ingresa los datos de tu tarjeta para agregarla como método de pago."
                footer={
                    <div className="flex items-center justify-end gap-3">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setDialogOpen(false)
                                setNewLast4('')
                                setNewExpiry('')
                                setNewHolder('')
                            }}
                        >
                            Cancelar
                        </Button>
                        <Button variant="solid" onClick={handleAdd}>
                            Guardar
                        </Button>
                    </div>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Tipo de tarjeta
                        </label>
                        <Select
                            value={newBrand}
                            onChange={(v) => setNewBrand(v as 'visa' | 'mastercard')}
                            options={[
                                { label: 'Visa', value: 'visa' },
                                { label: 'Mastercard', value: 'mastercard' },
                            ]}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Número de tarjeta
                        </label>
                        <Input
                            placeholder="4242 4242 4242 4242"
                            value={newLast4}
                            onChange={(e) => setNewLast4(e.target.value)}
                            maxLength={19}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                Vencimiento (MM/AA)
                            </label>
                            <Input
                                placeholder="12/27"
                                value={newExpiry}
                                onChange={(e) => setNewExpiry(e.target.value)}
                                maxLength={5}
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                CVV
                            </label>
                            <Input
                                placeholder="123"
                                type="password"
                                maxLength={4}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                            Nombre del titular
                        </label>
                        <Input
                            placeholder="Juan Pérez"
                            value={newHolder}
                            onChange={(e) => setNewHolder(e.target.value)}
                        />
                    </div>
                </div>
            </Dialog>

            <ConfirmDialog
                open={confirmDeleteOpen}
                title="Eliminar método de pago"
                description="¿Estás seguro de que deseas eliminar este método de pago? Esta acción no se puede deshacer."
                confirmText="Eliminar"
                cancelText="Cancelar"
                variant="danger"
                onConfirm={confirmDelete}
                onCancel={() => {
                    setConfirmDeleteOpen(false)
                    setDeletingId(null)
                }}
            />
        </div>
    )
}

export default BillingPaymentMethods
