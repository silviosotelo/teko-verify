// Selector de App para el header. "Global" = null (sin filtro por app).
import Select from '@/components/ui/Select'
import { useApp } from './AppContext'

type Opt = { value: string; label: string }

const ALL_APPS_OPT: Opt = { value: '', label: 'Global (todas las apps)' }

const AppSelector = () => {
    const { apps, currentAppId, setCurrentAppId, loading } = useApp()

    if (loading) return null

    const options: Opt[] = [
        ALL_APPS_OPT,
        ...apps.map((a) => ({ value: a.id, label: a.name })),
    ]
    const value =
        options.find((o) => o.value === (currentAppId ?? '')) ?? ALL_APPS_OPT

    return (
        <div className="hidden w-48 sm:block">
            <Select<Opt>
                size="sm"
                isSearchable={false}
                options={options}
                value={value}
                onChange={(opt) =>
                    setCurrentAppId(opt?.value || null)
                }
            />
        </div>
    )
}

export default AppSelector
