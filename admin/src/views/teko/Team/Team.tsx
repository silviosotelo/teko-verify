import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import Spinner from '@/components/ui/Spinner'
import Alert from '@/components/ui/Alert'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import Table from '@/components/ui/Table'
import { tekoApi } from '@/teko/client'
import { fmtDate } from '@/teko/format'
import type { AdminRole, OperatorRow } from '@/teko/types'

const { THead, TBody, Tr, Th, Td } = Table

// Vista Team (RBAC): operadores del panel + su rol. manage_members (owner). El
// backend hace el enforcement; aquí gateamos la UI con /me para no mostrar acciones
// que devolverían 403. Anti-lockout (último owner) lo valida el backend.
const ROLE_DESC: Record<string, string> = {
    owner: 'Todos los permisos (incl. orgs y miembros)',
    admin: 'Gestiona apps/workflows/webhooks/branding/keys + revisa',
    reviewer: 'Revisa sesiones + lectura',
    viewer: 'Solo lectura',
}

const TeamView = () => {
    const [operators, setOperators] = useState<OperatorRow[]>([])
    const [assignable, setAssignable] = useState<AdminRole[]>([])
    const [canManage, setCanManage] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState<AdminRole>('viewer')
    const [busy, setBusy] = useState(false)

    async function load() {
        setLoading(true)
        setError(null)
        try {
            const me = await tekoApi.me()
            const manage = me.permissions.includes('manage_members')
            setCanManage(manage)
            setAssignable(me.assignableRoles)
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

    if (loading) {
        return (
            <div className="flex h-40 items-center justify-center">
                <Spinner size={40} />
            </div>
        )
    }

    return (
        <div>
            <div className="mb-6">
                <h3 className="mb-1">Team</h3>
                <p className="text-gray-500">
                    Operadores del panel y su rol (RBAC).
                </p>
            </div>

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
                <>
                    <Card className="mb-6">
                        <form
                            onSubmit={createOp}
                            className="flex flex-wrap items-end gap-3"
                        >
                            <div className="min-w-[180px] flex-1">
                                <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                    Email / usuario
                                </label>
                                <Input
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="operador@org"
                                />
                            </div>
                            <div className="min-w-[160px] flex-1">
                                <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                    Contraseña (≥10)
                                </label>
                                <Input
                                    type="password"
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                />
                            </div>
                            <div className="min-w-[140px]">
                                <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
                                    Rol
                                </label>
                                <select
                                    className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700"
                                    value={role}
                                    onChange={(e) =>
                                        setRole(e.target.value as AdminRole)
                                    }
                                >
                                    {assignable.map((r) => (
                                        <option key={r} value={r}>
                                            {r}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <Button
                                type="submit"
                                variant="solid"
                                loading={busy}
                                disabled={!email.trim() || !password}
                            >
                                Crear operador
                            </Button>
                        </form>
                        <p className="mt-2 text-xs text-gray-400">
                            {ROLE_DESC[role]}
                        </p>
                    </Card>

                    <Card bodyClass="px-0 py-0">
                        <Table>
                            <THead>
                                <Tr>
                                    <Th>Operador</Th>
                                    <Th>Rol</Th>
                                    <Th>Creado</Th>
                                </Tr>
                            </THead>
                            <TBody>
                                {operators.map((o) => (
                                    <Tr key={o.id}>
                                        <Td className="font-medium heading-text">
                                            {o.email}
                                        </Td>
                                        <Td>
                                            <select
                                                className="h-9 rounded-lg border border-gray-300 bg-white px-2 text-sm dark:border-gray-600 dark:bg-gray-700"
                                                value={
                                                    assignable.includes(o.role)
                                                        ? o.role
                                                        : o.role
                                                }
                                                onChange={(e) =>
                                                    changeRole(
                                                        o.id,
                                                        e.target
                                                            .value as AdminRole,
                                                    )
                                                }
                                            >
                                                {/* incluye el rol actual aunque sea legacy (operator) */}
                                                {!assignable.includes(
                                                    o.role,
                                                ) && (
                                                    <option value={o.role}>
                                                        {o.role} (legacy)
                                                    </option>
                                                )}
                                                {assignable.map((r) => (
                                                    <option key={r} value={r}>
                                                        {r}
                                                    </option>
                                                ))}
                                            </select>
                                        </Td>
                                        <Td className="text-gray-500">
                                            {fmtDate(o.createdAt)}
                                        </Td>
                                    </Tr>
                                ))}
                            </TBody>
                        </Table>
                    </Card>
                </>
            )}
        </div>
    )
}

export default TeamView
