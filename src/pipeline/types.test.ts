import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition, PipelineCheckEntry } from '../types';

describe('PipelineCheckEntry type round-trip', () => {
  it('WorkflowDefinition accepts pipeline.checks', () => {
    const entry: PipelineCheckEntry = {
      key: 'liveness',
      enabled: false,
      order: 1,
      config: { threshold: 0.7 },
    };
    const def: WorkflowDefinition = {
      document: { required: true },
      liveness: { required: true, mode: 'passive' },
      pipeline: { checks: [entry] },
    };
    expect(def.pipeline?.checks[0].key).toBe('liveness');
    expect(def.pipeline?.checks[0].enabled).toBe(false);
  });

  it('WorkflowDefinition without pipeline is valid (backward compat)', () => {
    const def: WorkflowDefinition = {
      document: { required: true },
      liveness: { required: true, mode: 'passive' },
    };
    expect(def.pipeline).toBeUndefined();
  });

  it('PipelineCheckEntry config is optional', () => {
    const entry: PipelineCheckEntry = { key: 'aml', enabled: true, order: 4 };
    expect(entry.config).toBeUndefined();
  });
});
