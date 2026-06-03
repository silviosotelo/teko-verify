import ApiService from './ApiService'
import endpointConfig from '@/configs/endpoint.config'
import type {
    SignInCredential,
    SignUpCredential,
    ForgotPassword,
    ResetPassword,
    SignInResponse,
    SignUpResponse,
} from '@/@types/auth'

/** Respuesta cruda del backend Teko: POST /admin/login. */
type TekoLoginResponse = {
    token: string
    operator: { id: string; email: string; role: string }
    expiresAt: string
}

/**
 * Login Teko Verify. El backend devuelve { token, operator, expiresAt }; lo
 * adaptamos al contrato de ecme { token, user }. El rol del operador se mapea a
 * `authority` para que el AuthorityGuard de ecme lo reconozca.
 */
export async function apiSignIn(data: SignInCredential) {
    const resp = await ApiService.fetchDataWithAxios<TekoLoginResponse>({
        url: endpointConfig.signIn,
        method: 'post',
        data,
    })

    const operator = resp?.operator
    const signInResponse: SignInResponse = {
        token: resp.token,
        user: {
            userId: operator?.id ?? '',
            userName: operator?.email ?? '',
            email: operator?.email ?? '',
            avatar: '',
            // 'admin' abre las rutas con authority [ADMIN]; el rol Teko se conserva además.
            authority: ['admin', operator?.role].filter(Boolean) as string[],
        },
    }
    return signInResponse
}

export async function apiSignUp(data: SignUpCredential) {
    return ApiService.fetchDataWithAxios<SignUpResponse>({
        url: endpointConfig.signUp,
        method: 'post',
        data,
    })
}

export async function apiSignOut() {
    return ApiService.fetchDataWithAxios({
        url: endpointConfig.signOut,
        method: 'post',
    })
}

export async function apiForgotPassword<T>(data: ForgotPassword) {
    return ApiService.fetchDataWithAxios<T>({
        url: endpointConfig.forgotPassword,
        method: 'post',
        data,
    })
}

export async function apiResetPassword<T>(data: ResetPassword) {
    return ApiService.fetchDataWithAxios<T>({
        url: endpointConfig.resetPassword,
        method: 'post',
        data,
    })
}
