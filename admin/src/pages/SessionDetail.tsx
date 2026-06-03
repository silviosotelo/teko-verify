import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { CheckType, ExtractedDocument, SessionDetail } from '../api/types'
import { useTenant } from '../context/TenantContext'
import {
  Card,
  ErrorBox,
  Loading,
  LoaBadge,
  PageHeader,
  PassPill,
  StateBadge,
} from '../components/ui'
import { EvidenceImage } from '../components/EvidenceImage'
import { fmtDate, fmtDateOnly, fmtScore } from '../lib/format'

const MODULE_META: Record<CheckType, { label: string; desc: string }> = {
  quality: { label: 'Calidad', desc: 'Rostro, brillo, nitidez, anteojos' },
  liveness: { label: 'Liveness', desc: 'Persona viva (PAD anti-spoof)' },
  document: { label: 'Documento', desc: 'MRZ, OCR, autenticidad' },
  match: { label: 'Match 1:1', desc: 'Selfie ↔ foto del documento' },
}

const MODULE_ORDER: CheckType[] = ['quality', 'liveness', 'document', 'match']

function field(label: string, value?: string | number | boolean | null) {
  let v: string
  if (value == null || value === '') v = '—'
  else if (typeof value === 'boolean') v = value ? 'Sí' : 'No'
  else v = String(value)
  return (
    <div key={label}>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-gray-800">{v}</dd>
    </div>
  )
}

export default function SessionDetailPage() {
  const { sessionId } = useParams()
  const { currentId } = useTenant()
  const [data, setData] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentId || !sessionId) return
    setLoading(true)
    setError(null)
    api
      .getSession(currentId, sessionId)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [currentId, sessionId])

  if (loading) return <Loading />
  if (error) return <ErrorBox message={error} />
  if (!data) return <ErrorBox message="Sesión no encontrada." />

  const checkByType = (t: CheckType) => data.checks.find((c) => c.type === t)
  // Identidad rica: vive en checks[document].detail.extracted, NO en result.extracted.
  const docCheck = checkByType('document')
  const extracted: ExtractedDocument | undefined = docCheck?.detail?.extracted
  const titular = extracted?.titular
  const documento = extracted?.documento
  const fisico = extracted?.documentoFisico

  const reasons = data.result?.reasons ?? []

  return (
    <div>
      <PageHeader
        title="Detalle de sesión"
        subtitle={data.sessionId}
        actions={
          <Link to="/sessions" className="btn-secondary text-xs">
            ← Volver
          </Link>
        }
      />

      {/* Resumen */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Estado
            </div>
            <div className="mt-1">
              <StateBadge state={data.state} />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              LoA
            </div>
            <div className="mt-1">
              <LoaBadge loa={data.result?.loa ?? data.assuranceRequired} />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Ref. externa
            </div>
            <div className="mt-1 text-sm font-medium text-gray-800">
              {data.externalRef || '—'}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Creada
            </div>
            <div className="mt-1 text-sm font-medium text-gray-800">
              {fmtDate(data.createdAt)}
            </div>
          </div>
        </div>
        {reasons.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
              Motivos
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {reasons.map((r) => (
                <span
                  key={r}
                  className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Módulos del pipeline */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Módulos del pipeline
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {MODULE_ORDER.map((t) => {
              const c = checkByType(t)
              const meta = MODULE_META[t]
              return (
                <div
                  key={t}
                  className={`card p-4 ${c ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        {meta.label}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-400">{meta.desc}</div>
                    </div>
                    {c ? (
                      <PassPill passed={c.passed} />
                    ) : (
                      <span className="text-xs text-gray-400">No corrió</span>
                    )}
                  </div>
                  {c && (
                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                      <span className="text-xs text-gray-400">Score</span>
                      <span className="font-mono text-sm font-semibold text-gray-700">
                        {fmtScore(c.score)}
                      </span>
                    </div>
                  )}
                  {c?.detail?.reasons && Array.isArray(c.detail.reasons) && c.detail.reasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(c.detail.reasons as string[]).map((r) => (
                        <span
                          key={r}
                          className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                  {c?.detail?.attackType && c.detail.attackType !== 'none' && (
                    <div className="mt-2 text-[11px] font-medium text-red-600">
                      Ataque: {c.detail.attackType}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Identidad extraída */}
          <h2 className="mb-3 mt-6 text-sm font-semibold text-gray-900">
            Identidad extraída
          </h2>
          <Card>
            {!extracted ? (
              <p className="text-sm text-gray-400">
                Sin datos de documento extraídos en esta sesión.
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                {field('Apellidos', titular?.apellidos)}
                {field('Nombres', titular?.nombres)}
                {field('Cédula (CI)', documento?.numeroCedula)}
                {field('Fecha nac.', fmtDateOnly(titular?.fechaNacimiento))}
                {field('Sexo', titular?.sexo)}
                {field('Nacionalidad', titular?.nacionalidad)}
                {field(
                  'Lugar nac.',
                  [titular?.lugarNacimiento?.ciudad, titular?.lugarNacimiento?.departamento]
                    .filter(Boolean)
                    .join(', ')
                )}
                {field('Estado civil', titular?.estadoCivil)}
                {field('Donante', titular?.donante)}
                {field('Tipo doc.', documento?.tipo)}
                {field('País', documento?.pais)}
                {field('Specimen', documento?.specimen)}
                {field('F. emisión', fmtDateOnly(fisico?.fechaEmision))}
                {field('F. vencimiento', fmtDateOnly(fisico?.fechaVencimiento))}
                {field('Chip', fisico?.chip)}
              </dl>
            )}
          </Card>

          {/* Autenticidad documental */}
          {docCheck?.detail?.authenticity?.checks && Array.isArray(docCheck.detail.authenticity.checks) && (
            <>
              <h2 className="mb-3 mt-6 text-sm font-semibold text-gray-900">
                Autenticidad documental
              </h2>
              <Card>
                <ul className="divide-y divide-gray-100">
                  {(docCheck.detail.authenticity.checks as Array<{
                    name: string
                    passed: boolean
                    detail?: string
                  }>).map((a) => (
                    <li key={a.name} className="flex items-center justify-between py-2">
                      <div>
                        <span className="text-sm font-medium text-gray-700">{a.name}</span>
                        {a.detail && (
                          <span className="ml-2 text-xs text-gray-400">{a.detail}</span>
                        )}
                      </div>
                      <PassPill passed={a.passed} />
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}
        </div>

        {/* Evidencia + consentimiento */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Evidencia</h2>
          <div className="space-y-4">
            {data.evidence.length === 0 ? (
              <Card>
                <p className="text-sm text-gray-400">Sin evidencia almacenada.</p>
              </Card>
            ) : (
              data.evidence
                .filter((e) => e.type !== 'frames')
                .map((e) => (
                  <EvidenceImage
                    key={e.type}
                    tenantId={data.tenantId}
                    sessionId={data.sessionId}
                    type={e.type}
                  />
                ))
            )}
          </div>

          {data.consents.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 text-sm font-semibold text-gray-900">
                Consentimiento
              </h2>
              <Card>
                {data.consents.map((c, i) => (
                  <div key={i} className="text-sm">
                    <div className="font-medium text-gray-700">v{c.version}</div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      {fmtDate(c.acceptedAt)} · IP {c.ip ?? '—'}
                    </div>
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
