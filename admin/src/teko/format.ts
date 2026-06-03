// Formateadores compartidos del dashboard Teko.

export function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('es-PY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export function fmtDateOnly(iso: string | null | undefined): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString('es-PY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}

export function fmtPct(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '—'
    return `${(n * 100).toFixed(1)}%`
}

export function fmtScore(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return '—'
    return n.toFixed(3)
}
