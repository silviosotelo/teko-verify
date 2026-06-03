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
    // Las fechas date-only ("YYYY-MM-DD") NO deben pasar por `new Date(iso)`:
    // el constructor las interpreta como medianoche UTC y `toLocaleDateString`
    // las re-renderiza en hora local (UTC-3 en PY), restando un día. Parseamos
    // los componentes Y-M-D a mano y formateamos DD/MM/YYYY sin zona horaria.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
    if (dateOnly) {
        const [, , mm, dd] = dateOnly
        const yyyy = dateOnly[1]
        return `${dd}/${mm}/${yyyy}`
    }
    // Fallback para strings con hora (timestamp completo): usamos Date normal.
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
