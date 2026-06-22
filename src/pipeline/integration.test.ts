import { describe, it, expect } from 'vitest';
import { resolveCheckList } from './resolver';
import { assuranceFromDefinition } from '../lib/workflow';
import type { WorkflowDefinition } from '../types';

describe('Fase 3 integration: pipeline.checks round-trip', () => {
  it('round-trip: save definition → resolve → disable liveness → LoA=L2', () => {
    const saved: WorkflowDefinition = {
      document: { required: true },
      match: { required: true },
      liveness: { required: true, mode: 'passive' },
      pipeline: {
        checks: [
          { key: 'liveness', enabled: false, order: 1 },
          { key: 'match',    enabled: true,  order: 3, config: { threshold: 0.55 } },
        ],
      },
    };
    const resolved = resolveCheckList(saved);
    const loa = assuranceFromDefinition(saved);

    expect(resolved.get('liveness')!.enabled).toBe(false);
    expect(resolved.get('match')!.enabled).toBe(true);
    expect(resolved.get('match')!.config).toEqual({ threshold: 0.55 });
    expect(resolved.get('quality')!.enabled).toBe(true);
    expect(loa).toBe('L2');
  });

  it('round-trip: no pipeline.checks → defaults identical to L3 required fields', () => {
    const saved: WorkflowDefinition = {
      document: { required: true },
      match: { required: true },
      liveness: { required: true, mode: 'passive' },
    };
    const resolved = resolveCheckList(saved);
    expect(resolved.get('liveness')!.enabled).toBe(true);
    expect(resolved.get('match')!.enabled).toBe(true);
    expect(resolved.get('aml')!.enabled).toBe(false);
    expect(assuranceFromDefinition(saved)).toBe('L3');
  });
});
