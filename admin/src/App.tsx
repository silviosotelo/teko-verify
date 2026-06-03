import { BrowserRouter } from 'react-router'
import Theme from '@/components/template/Theme'
import Layout from '@/components/layouts'
import { AuthProvider } from '@/auth'
import { TenantProvider } from '@/teko/TenantContext'
import Views from '@/views'
import appConfig from './configs/app.config'
import './locales'

if (appConfig.enableMock) {
    import('./mock')
}

function App() {
    return (
        <Theme>
            <BrowserRouter basename="/admin-ui">
                <AuthProvider>
                    <TenantProvider>
                        <Layout>
                            <Views />
                        </Layout>
                    </TenantProvider>
                </AuthProvider>
            </BrowserRouter>
        </Theme>
    )
}

export default App
