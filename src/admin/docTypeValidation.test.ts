import { describe, it, expect } from 'vitest'
import { isValidDocTypePost, isValidDocTypePatch } from './docTypeValidation'

describe('isValidDocTypePost', () => {
  it('acepta body válido mínimo', () => {
    expect(isValidDocTypePost({ key: 'ci_py', label: 'Cédula PY' })).toBe(true)
  })
  it('rechaza key con espacios/mayúsculas', () => {
    expect(isValidDocTypePost({ key: 'CI PY', label: 'x' })).toBe(false)
  })
  it('rechaza label vacío', () => {
    expect(isValidDocTypePost({ key: 'ci_py', label: '' })).toBe(false)
  })
  it('rechaza mrzFormat inválido', () => {
    expect(isValidDocTypePost({ key: 'x', label: 'X', mrzFormat: 'td99' })).toBe(false)
  })
  it('acepta mrzFormat null', () => {
    expect(isValidDocTypePost({ key: 'x', label: 'X', mrzFormat: null })).toBe(true)
  })
  it('rechaza scopeType no admitido (app/workflow)', () => {
    expect(isValidDocTypePost({ key: 'x', label: 'X', scopeType: 'app' })).toBe(false)
  })
})

describe('isValidDocTypePatch', () => {
  it('acepta label sola', () => {
    expect(isValidDocTypePatch({ label: 'nuevo' })).toBe(true)
  })
  it('acepta objeto vacío (patch sin cambios)', () => {
    expect(isValidDocTypePatch({})).toBe(true)
  })
  it('rechaza label vacío en patch', () => {
    expect(isValidDocTypePatch({ label: '' })).toBe(false)
  })
  it('rechaza enabled no-boolean', () => {
    expect(isValidDocTypePatch({ enabled: 'yes' as unknown as boolean })).toBe(false)
  })
})
