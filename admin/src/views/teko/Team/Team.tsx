import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import { Form } from '@/components/ui/Form'
import FormItem from '@/components/ui/Form/FormItem'
import Dialog from '@/components/ui/Dialog'
import Table from '@/components/ui/Table'
import Chart from '@/components/shared/Chart'
import IconText from '@/components/shared/IconText'
import UsersAvatarGroup from '@/components/shared/UsersAvatarGroup'
import { tekoApi } from '@/teko/client'
import { fmtDate } from '@/teko/format'
import type { AdminRole, OperatorRow } from '@/teko/types'
import { motion } from 'framer-motion'
import {
    PiUsers,
    PiShieldCheck,
    PiEye,
    PiGear,
    PiUserPlus,
    PiEnvelope,
    PiKey,
    PiLock,
    PiCheckCircle,
    PiClockClockwise,
} from 'react-icons/pi'

const { THead, TBody, Tr, Th, Td } = Table

const ROLE_DESC: Record<string, string> = {
    owner: 'Todos los permisos (incl. orgs y miembros)',
    admin: 'Gestiona apps/workflows/webhooks/branding/keys + revisa',
    reviewer: 'Revisa sesiones + lectura',
    viewer: 'Solo lectura',
    operator: 'Admin (legacy)',
}

const ROLE_COLORS: Record<string, string> = {
    owner: 'danger',
    admin: 'primary',
    reviewer: 'warning',
    viewer: 'gray',
    operator: 'primary',
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
    owner: <PiLock />,
    admin: <PiGear />,
    reviewer: <PiEye />,
    viewer: <PiEye />,
    operator: <PiKey />,
}

const TeamView = () => {
    const [operators, setOperators] = useState<OperatorRow[]>([])
    const [assignable, setAssignable] = useState<AdminRole[]>([])
    const [canManage, setCanManage] = useState(false)
    const [meEmail, setMeEmail] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<AdminRole>('viewer')
    const [busy, setBusy] = useState(false)
    const [inviteDialog, setInviteDialog] = useState(false)

    async function load() {
        setLoading(true)
        setError(null)
        try {
            const me = await tekoApi.me()
            const manage = me.permissions.includes('manage_members')
            setCanManage(manage)
            setAssignable(me.assignableRoles)
            setMeEmail(me.operator?.email || '')
            if (manage) {
                const { operators } = await tekoApi.listOperators()
                setOperators(operators)
            }
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    async function createOp(e: React.FormEvent) {
        e.preventDefault()
        if (!email.trim() || !password) return
        setBusy(true)
        setError(null)
        try {
            await tekoApi.createOperator({ email: email.trim(), password, role })
            setEmail('')
            setPassword('')
            setRole('viewer')
            setInviteDialog(false)
            await load()
        } catch (e) {
            setError((e as Error).message)
        } finally {
            setBusy(false)
        }
    }

    async function changeRole(id: string, nextRole: AdminRole) {
        setError(null)
        try {
            await tekoApi.updateOperatorRole(id, nextRole)
            await load()
        } catch (e) {
            setError((e as Error).message)
        }
    }

    const roleDistribution = assignable.map((r) => ({
        name: r,
        count: operators.filter((o) => o.role === r).length,
    }))

    const roleSelectOptions = assignable.map((r) => ({
        value: r,
        label: `${r} — ${ROLE_DESC[r]}`,
    }))

    if (loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h3 className="mb-1">Equipo</h3>
                    <p className="text-gray-500">
                        Operadores del panel y su rol (RBAC).
                    </p>
                </div>
                {canManage && (
                    <Button variant="solid" onClick={() => setInviteDialog(true)} className="gap-1">
                        <PiUserPlus />
                        Invitar operador
                    </Button>
                )}
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                    <Card>
                        <IconText icon={<PiUsers />} text="Total Operadores" iconClassName="text-primary" />
                        <div className="mt-2 text-3xl font-bold heading-text">{operators.length}</div>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                    <Card>
                        <IconText icon={<PiShieldCheck />} text="Owners" iconClassName="text-danger" />
                        <div className="mt-2 text-3xl font-bold text-danger">
                            {operators.filter((o) => o.role === 'owner').length}
                        </div>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                    <Card>
                        <IconText icon={<PiGear />} text="Admins" iconClassName="text-primary" />
                        <div className="mt-2 text-3xl font-bold text-primary">
                            {operators.filter((o) => o.role === 'admin').length}
                        </div>
                    </Card>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                    <Card>
                        <IconText icon={<PiEye />} text="Reviewers" iconClassName="text-warning" />
                        <div className="mt-2 text-3xl font-bold text-warning">
                            {operators.filter((o) => o.role === 'reviewer').length}
                        </div>
                    </Card>
                </motion.div>
            </div>

            {/* Role Distribution Chart */}
            {roleDistribution.length > 0 && (
                <Card className="mb-6">
                    <h5 className="font-semibold mb-4">Distribución de Roles</h5>
                    <Chart
                        type="pie"
                        height={250}
                        series={roleDistribution.filter((r) => r.count > 0).map((r) => r.count)}
                        customOptions={{
                            labels: roleDistribution.map((r) => r.name),
                            colors: roleDistribution.map((r) => {
                                if (r.name === 'owner') return '#ef4444'
                                if (r.name === 'admin') return '#3b82f6'
                                if (r.name === 'reviewer') return '#f59e0b'
                                if (r.name === 'viewer') return '#9ca3af'
                                return '#3b82f6'
                            }),
                            legend: { position: 'bottom' },
                            plotOptions: {
                                pie: {
                                    donut: {
                                        size: '60%',
                                        labels: {
                                            show: true,
                                            total: {
                                                show: true,
                                                label: 'Total',
                                                formatter: () => operators.length,
                                            },
                                        },
                                    },
                                },
                            },
                        }}
                    />
                </Card>
            )}

            {error && (
                <Alert showIcon className="mb-4" type="danger">
                    {error}
                </Alert>
            )}

            {!canManage ? (
                <Alert showIcon type="info">
                    Tu rol no tiene el permiso <b>manage_members</b>. Solo un
                    owner puede gestionar el equipo.
                </Alert>
            ) : (
                <Card bodyClass="px-0 py-0">
                    <Table>
                        <THead>
                            <Tr>
                                <Th>Operador</Th>
                                <Th>Rol</Th>
                                <Th>Permisos</Th>
                                <Th>Último acceso</Th>
                                <Th>Creado</Th>
                                <Th>Acciones</Th>
                            </Tr>
                        </THead>
                        <TBody>
                            {operators.map((o) => {
                                const perms = ROLE_DESC[o.role] || o.role
                                const roleOptions = [
                                    ...(!assignable.includes(o.role)
                                        ? [{ value: o.role, label: `${o.role} (legacy)` }]
                                        : []),
                                    ...assignable.map((r) => ({ value: r, label: r })),
                                ]
                                return (
                                    <Tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                        <Td>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
                                                    o.role === 'owner' ? 'bg-danger' :
                                                    o.role === 'admin' ? 'bg-primary' :
                                                    o.role === 'reviewer' ? 'bg-warning' :
                                                    'bg-gray-400'
                                                }`}>
                                                    {o.email.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="font-medium heading-text">{o.email}</div>
                                                    <div className="text-xs text-gray-400">ID: {o.id.slice(0, 8)}</div>
                                                </div>
                                            </div>
                                        </Td>
                                        <Td>
                                            <Badge
                                                variant="solid"
                                                color={ROLE_COLORS[o.role] || 'gray'}
                                                className="flex items-center gap-1"
                                            >
                                                {ROLE_ICONS[o.role]}
                                                {o.role}
                                            </Badge>
                                        </Td>
                                        <Td className="max-w-xs">
                                            <span className="text-sm text-gray-500">{perms}</span>
                                        </Td>
                                        <Td>
                                            <div className="flex items-center gap-1 text-gray-500 text-sm">
                                                <PiClockClockwise />
                                                —
                                            </div>
                                        </Td>
                                        <Td className="text-gray-500 whitespace-nowrap">
                                            {fmtDate(o.createdAt)}
                                        </Td>
                                        <Td>
                                            <Select
                                                size="sm"
                                                className="min-w-[140px]"
                                                options={roleOptions}
                                                value={roleOptions.find((opt) => opt.value === o.role)}
                                                onChange={(opt) => opt && changeRole(o.id, opt.value as AdminRole)}
                                            />
                                        </Td>
                                    </Tr>
                                )
                            })}
                        </TBody>
                    </Table>
                </Card>
            )}

            {/* Invite Dialog */}
            <Dialog
                isOpen={inviteDialog}
                onClose={() => setInviteDialog(false)}
                onRequestClose={() => setInviteDialog(false)}
                title="Invitar operador"
            >
                <Form onSubmit={createOp} className="space-y-4">
                    <FormItem label="Email">
                        <Input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="operador@empresa.com"
                            prefix={<PiEnvelope />}
                            required
                        />
                    </FormItem>
                    <FormItem label="Contraseña">
                        <Input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mínimo 10 caracteres"
                            prefix={<PiLock />}
                            required
                        />
                    </FormItem>
                    <FormItem label="Rol">
                        <Select
                            options={roleSelectOptions}
                            value={roleSelectOptions.find((opt) => opt.value === role)}
                            onChange={(opt) => setRole((opt?.value as AdminRole) ?? 'viewer')}
                        />
                    </FormItem>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => setInviteDialog(false)}
                        >
                            Cancelar
                        </Button>
                        <Button type="submit" variant="solid" loading={busy}>
                            Invitar
                        </Button>
                    </div>
                </Form>
            </Dialog>
        </div>
    )
}

export default TeamView
