import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Tenant, TenantStatus } from '../api/types'
import { useTenant } from '../context/TenantContext'
import { Badge, EmptyState, ErrorBox, Loading, PageHeader } from '../components/ui'
import { fmtDate } from '../lib/format'

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function statusTone(s: TenantStatus): 'green' | 'amber' | 'red' {
  return s === 'active' ? 'green' : s === 'suspended' ? 'amber' : 'red'
}

export default function TenantsPage() {
  const { tenants, reload, loading } = useTenant()
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Tenant | null>(null)

  // create form
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [assurance, setAssurance] = useState('L2')
  const [retention, setRetention] = useState('90')
  const [busy, setBusy] = useState(false)

  function resetCreate() {
    setName('')
    setSlug('')
    setAssurance('L2')
    setRetention('90')
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.createTenant({
        name,
        slug,
        policies: {
          assuranceRequired: assurance as any,
          retentionDays: parseInt(retention, 10) || 90,
        },
      })
      setCreating(false)
      resetCreate()
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // edit form
  const [eName, setEName] = useState('')
  const [eStatus, setEStatus] = useState<TenantStatus>('active')
  const [eAssurance, setEAssurance] = useState('L2')
  const [eRetention, setERetention] = useState('90')

  useEffect(() => {
    if (editing) {
      setEName(editing.name)
      setEStatus(editing.status)
      setEAssurance(editing.policies?.assuranceRequired ?? 'L2')
      setERetention(String(editing.policies?.retentionDays ?? 90))
    }
  }, [editing])

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      await api.updateTenant(editing.id, {
        name: eName,
        status: eStatus,
        policies: {
          assuranceRequired: eAssurance as any,
          retentionDays: parseInt(eRetention, 10) || 90,
        },
      })
      setEditing(null)
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle="Organizaciones consumidoras de Teko Verify"
        actions={
          <button onClick={() => setCreating(true)} className="btn-primary text-sm">
            + Nuevo tenant
          </button>
        }
      />
      {error && <ErrorBox message={error} />}
      <div className="card overflow-hidden">
        {loading ? (
          <Loading />
        ) : tenants.length === 0 ? (
          <EmptyState message="No hay tenants." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Nombre</th>
                  <th className="px-5 py-3 font-semibold">Slug</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 font-semibold">LoA req.</th>
                  <th className="px-5 py-3 font-semibold">Retención</th>
                  <th className="px-5 py-3 font-semibold">Creado</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{t.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">{t.slug}</td>
                    <td className="px-5 py-3">
                      <Badge tone={statusTone(t.status)}>{t.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {t.policies?.assuranceRequired ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {t.policies?.retentionDays ?? '—'} días
                    </td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(t.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setEditing(t)}
                        className="text-xs font-semibold text-primary hover:text-primary-deep"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <Modal title="Nuevo tenant" onClose={() => setCreating(false)}>
          <form onSubmit={submitCreate} className="space-y-4">
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Slug</label>
              <input
                className="input"
                value={slug}
                onChange={(e) =>
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                }
                placeholder="mi-empresa"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">LoA requerido</label>
                <select
                  className="input"
                  value={assurance}
                  onChange={(e) => setAssurance(e.target.value)}
                >
                  {['L1', 'L2', 'L3'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Retención (días)</label>
                <input
                  type="number"
                  className="input"
                  value={retention}
                  onChange={(e) => setRetention(e.target.value)}
                  min={0}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="btn-secondary text-sm"
              >
                Cancelar
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-sm">
                {busy ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editing && (
        <Modal title={`Editar ${editing.name}`} onClose={() => setEditing(null)}>
          <form onSubmit={submitEdit} className="space-y-4">
            <div>
              <label className="label">Nombre</label>
              <input
                className="input"
                value={eName}
                onChange={(e) => setEName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Estado</label>
                <select
                  className="input"
                  value={eStatus}
                  onChange={(e) => setEStatus(e.target.value as TenantStatus)}
                >
                  {['active', 'suspended', 'disabled'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">LoA requerido</label>
                <select
                  className="input"
                  value={eAssurance}
                  onChange={(e) => setEAssurance(e.target.value)}
                >
                  {['L1', 'L2', 'L3'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Retención (días)</label>
              <input
                type="number"
                className="input"
                value={eRetention}
                onChange={(e) => setERetention(e.target.value)}
                min={0}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="btn-secondary text-sm"
              >
                Cancelar
              </button>
              <button type="submit" disabled={busy} className="btn-primary text-sm">
                {busy ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
