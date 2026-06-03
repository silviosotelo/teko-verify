import Alert from '@/components/ui/Alert'
import SignInForm from './components/SignInForm'
import useTimeOutMessage from '@/utils/hooks/useTimeOutMessage'

type SignInProps = {
    disableSubmit?: boolean
}

export const SignInBase = ({ disableSubmit }: SignInProps) => {
    const [message, setMessage] = useTimeOutMessage()

    return (
        <>
            <div className="mb-8">
                <div className="flex items-center gap-2">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white">
                        T
                    </span>
                    <span className="text-2xl font-bold tracking-tight heading-text">
                        TEKO
                    </span>
                </div>
            </div>
            <div className="mb-10">
                <h2 className="mb-2">Panel de administración</h2>
                <p className="font-semibold heading-text">
                    Ingresá tus credenciales de operador para continuar.
                </p>
            </div>
            {message && (
                <Alert showIcon className="mb-4" type="danger">
                    <span className="break-all">{message}</span>
                </Alert>
            )}
            <SignInForm disableSubmit={disableSubmit} setMessage={setMessage} />
            <p className="mt-8 text-center text-xs text-gray-400">
                Acceso restringido a operadores autorizados · Teko Verify
            </p>
        </>
    )
}

const SignIn = () => {
    return <SignInBase />
}

export default SignIn
