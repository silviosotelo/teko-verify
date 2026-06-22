import { describe, it, expect } from 'vitest';
import { getRegistry, DEFAULT_CHECK_ORDER } from './registry';

describe('checks registry', () => {
  it('contains exactly 8 entries', () => {
    expect(getRegistry().size).toBe(8);
  });

  it('contains all expected check keys', () => {
    const keys = [...getRegistry().keys()];
    expect(keys).toContain('quality');
    expect(keys).toContain('liveness');
    expect(keys).toContain('document');
    expect(keys).toContain('match');
    expect(keys).toContain('aml');
    expect(keys).toContain('face_search');
    expect(keys).toContain('proof_of_address');
    expect(keys).toContain('age_estimation');
  });

  it('DEFAULT_CHECK_ORDER has 8 entries matching registry keys', () => {
    const registry = getRegistry();
    expect(DEFAULT_CHECK_ORDER).toHaveLength(8);
    for (const key of DEFAULT_CHECK_ORDER) {
      expect(registry.has(key)).toBe(true);
    }
  });

  it('defaultOrder values are unique and 0-based sequential', () => {
    const orders = [...getRegistry().values()].map(m => m.defaultOrder).sort((a, b) => a - b);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('dependsOn only references keys that exist in the registry', () => {
    const registry = getRegistry();
    for (const meta of registry.values()) {
      for (const dep of meta.dependsOn) {
        expect(registry.has(dep)).toBe(true);
      }
    }
  });

  it('quality has no dependsOn (always runs first)', () => {
    expect(getRegistry().get('quality')!.dependsOn).toEqual([]);
  });

  it('aml and proofOfAddress depend on document', () => {
    expect(getRegistry().get('aml')!.dependsOn).toContain('document');
    expect(getRegistry().get('proof_of_address')!.dependsOn).toContain('document');
  });

  it('faceSearch depends on match (embedding reuse)', () => {
    expect(getRegistry().get('face_search')!.dependsOn).toContain('match');
  });

  it('getRegistry returns the same Map instance (singleton)', () => {
    expect(getRegistry()).toBe(getRegistry());
  });
});
