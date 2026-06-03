// Carga una imagen de evidencia con Authorization: Bearer vía fetch → Blob URL.
// Un <img src="/admin/..."> NO mandaría el header y daría 401.
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { Spinner } from './ui'

const LABEL: Record<string, string> = {
  selfie: 'Selfie',
  doc_front: 'Documento (frente)',
  doc_back: 'Documento (dorso)',
  frames: 'Frames',
}

export function EvidenceImage({
  tenantId,
  sessionId,
  type,
}: {
  tenantId: string
  sessionId: string
  type: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let revoked: string | null = null
    let alive = true
    setLoading(true)
    setError(false)
    api
      .evidenceBlob(tenantId, sessionId, type)
      .then((blob) => {
        if (!alive) return
        const u = URL.createObjectURL(blob)
        revoked = u
        setUrl(u)
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [tenantId, sessionId, type])

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <div className="flex h-44 items-center justify-center bg-gray-100">
        {loading ? (
          <Spinner />
        ) : error || !url ? (
          <span className="text-xs text-gray-400">No disponible</span>
        ) : (
          <img src={url} alt={LABEL[type] ?? type} className="h-full w-full object-contain" />
        )}
      </div>
      <div className="border-t border-gray-100 px-3 py-2 text-xs font-medium text-gray-600">
        {LABEL[type] ?? type}
      </div>
    </div>
  )
}
