/**
 * Tests del loader cacheado de fieldDefs (src/lib/fieldDefsCache.ts).
 *
 * El loader acepta un parámetro `loader` inyectable → no necesita vi.mock de repos
 * ni importar pipelineDeps.ts (que arrastra engine con side-effects ONNX).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadFieldDefsForDocType,
  _resetFieldDefsCache,
  FIELD_DEFS_TTL_MS,
} from './lib/fieldDefsCache'
import type { FieldDefinition } from './db/repos/extractionFields'

const STUB_DEF: FieldDefinition = {
  id: '1',
  docTypeKey: 'ci_py',
  key: 'apellidos',
  label: 'Apellidos',
  type: 'string',
  path: 'titular.apellidos',
  validation: { required: true },
  displayOrder: 10,
  createdAt: '',
}

describe('fieldDefsCache — loadFieldDefsForDocType', () => {
  beforeEach(() => {
    _resetFieldDefsCache()
  })

  it('caché: 2 llamadas con el mismo docTypeKey dentro del TTL → repo invocado UNA sola vez', async () => {
    const loader = vi.fn().mockResolvedValue([STUB_DEF])

    const r1 = await loadFieldDefsForDocType('ci_py', loader)
    const r2 = await loadFieldDefsForDocType('ci_py', loader)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(r1).toEqual([STUB_DEF])
    expect(r2).toEqual([STUB_DEF])
  })

  it('caché: docTypeKeys distintos → repo invocado UNA vez por key', async () => {
    const loader = vi.fn().mockResolvedValue([STUB_DEF])

    await loadFieldDefsForDocType('ci_py', loader)
    await loadFieldDefsForDocType('passport', loader)
    await loadFieldDefsForDocType('ci_py', loader)   // debería ir al caché

    expect(loader).toHaveBeenCalledTimes(2)
    expect(loader).toHaveBeenCalledWith('ci_py')
    expect(loader).toHaveBeenCalledWith('passport')
  })

  it('fail-open: si el loader lanza → devuelve [] y NO propaga la excepción', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('DB caída'))

    const result = await loadFieldDefsForDocType('ci_py', loader)

    expect(result).toEqual([])
  })

  it('fail-open: tras un fallo el caché NO guarda la entrada → siguiente llamada reintenta', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('DB caída'))
      .mockResolvedValue([STUB_DEF])

    const r1 = await loadFieldDefsForDocType('ci_py', loader)
    const r2 = await loadFieldDefsForDocType('ci_py', loader)

    expect(r1).toEqual([])        // fallo → fail-open → []
    expect(r2).toEqual([STUB_DEF]) // reintento exitoso
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('TTL: tras expirar el caché, el loader se vuelve a invocar', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn().mockResolvedValue([STUB_DEF])

      await loadFieldDefsForDocType('ci_py', loader)
      expect(loader).toHaveBeenCalledTimes(1)

      // Avanzar más del TTL
      vi.advanceTimersByTime(FIELD_DEFS_TTL_MS + 1)

      await loadFieldDefsForDocType('ci_py', loader)
      expect(loader).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
