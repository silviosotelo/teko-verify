import { describe, it, expect } from 'vitest';
import { resolveCheckList } from './resolver';
import { workflowDefForLoA } from '../lib/workflow';
import type { WorkflowDefinition } from '../types';

describe('resolveCheckList', () => {
  describe('null/undefined def (no workflow)', () => {
    it('returns 8 entries', () => {
      expect(resolveCheckList(null).size).toBe(8);
    });

    it('quality is always enabled', () => {
      expect(resolveCheckList(null).get('quality')!.enabled).toBe(true);
    });

    it('document is always enabled', () => {
      expect(resolveCheckList(null).get('document')!.enabled).toBe(true);
    });

    it('match is disabled when no def (no required flag)', () => {
      expect(resolveCheckList(null).get('match')!.enabled).toBe(false);
    });

    it('liveness is disabled when no def', () => {
      expect(resolveCheckList(null).get('liveness')!.enabled).toBe(false);
    });

    it('aml is disabled when no def', () => {
      expect(resolveCheckList(null).get('aml')!.enabled).toBe(false);
    });
  });

  describe('L3 workflow (liveness + match + document required)', () => {
    const l3 = workflowDefForLoA('L3');

    it('liveness is enabled for L3', () => {
      expect(resolveCheckList(l3).get('liveness')!.enabled).toBe(true);
    });

    it('match is enabled for L3', () => {
      expect(resolveCheckList(l3).get('match')!.enabled).toBe(true);
    });

    it('quality is enabled for L3', () => {
      expect(resolveCheckList(l3).get('quality')!.enabled).toBe(true);
    });

    it('aml is disabled for default L3 (not required)', () => {
      expect(resolveCheckList(l3).get('aml')!.enabled).toBe(false);
    });
  });

  describe('pipeline.checks overrides', () => {
    const baseL3 = workflowDefForLoA('L3');

    it('disabling liveness via pipeline.checks overrides required:true', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: { checks: [{ key: 'liveness', enabled: false, order: 1 }] },
      };
      expect(resolveCheckList(def).get('liveness')!.enabled).toBe(false);
    });

    it('enabling aml via pipeline.checks + aml.required:true enables it', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        aml: { required: true, threshold: 0.8 },
        pipeline: { checks: [{ key: 'aml', enabled: true, order: 4 }] },
      };
      expect(resolveCheckList(def).get('aml')!.enabled).toBe(true);
    });

    it('pipeline.checks config is merged into ResolvedCheck.config', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: {
          checks: [{ key: 'match', enabled: true, order: 3, config: { threshold: 0.55 } }],
        },
      };
      expect(resolveCheckList(def).get('match')!.config).toEqual({ threshold: 0.55 });
    });

    it('checks not in pipeline.checks list keep registry defaults', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: { checks: [{ key: 'liveness', enabled: false, order: 1 }] },
      };
      // match is not in pipeline.checks but is required by L3
      expect(resolveCheckList(def).get('match')!.enabled).toBe(true);
    });

    it('order from pipeline.checks is reflected in resolved entry', () => {
      const def: WorkflowDefinition = {
        ...baseL3,
        pipeline: { checks: [{ key: 'quality', enabled: true, order: 99 }] },
      };
      expect(resolveCheckList(def).get('quality')!.order).toBe(99);
    });
  });

  describe('non-regression: behavior identical to today with no pipeline field', () => {
    it('L1 without pipeline: only quality + document enabled', () => {
      const def = workflowDefForLoA('L1');
      const resolved = resolveCheckList(def);
      expect(resolved.get('quality')!.enabled).toBe(true);
      expect(resolved.get('document')!.enabled).toBe(true);
      expect(resolved.get('liveness')!.enabled).toBe(false);
      expect(resolved.get('match')!.enabled).toBe(false);
      expect(resolved.get('aml')!.enabled).toBe(false);
      expect(resolved.get('face_search')!.enabled).toBe(false);
      expect(resolved.get('proof_of_address')!.enabled).toBe(false);
      expect(resolved.get('age_estimation')!.enabled).toBe(false);
    });

    it('L2 without pipeline: quality + document + match enabled', () => {
      const def = workflowDefForLoA('L2');
      const resolved = resolveCheckList(def);
      expect(resolved.get('match')!.enabled).toBe(true);
      expect(resolved.get('liveness')!.enabled).toBe(false);
    });

    it('L3 without pipeline: quality + document + liveness + match enabled', () => {
      const def = workflowDefForLoA('L3');
      const resolved = resolveCheckList(def);
      expect(resolved.get('liveness')!.enabled).toBe(true);
      expect(resolved.get('match')!.enabled).toBe(true);
    });
  });
});
