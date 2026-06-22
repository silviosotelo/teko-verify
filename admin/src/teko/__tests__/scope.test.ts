import { describe, it, expect } from 'vitest'
import { buildScopeLabel } from '../ScopeHeader'

describe('buildScopeLabel', () => {
    it('returns null when no tenant', () => {
        expect(buildScopeLabel(null, null)).toBeNull()
    })
    it('shows Global when no app selected', () => {
        expect(buildScopeLabel('Acme Corp', null)).toBe('Acme Corp / Global')
    })
    it('shows tenant + app name when both selected', () => {
        expect(buildScopeLabel('Acme Corp', 'Mobile App')).toBe('Acme Corp / Mobile App')
    })
})
