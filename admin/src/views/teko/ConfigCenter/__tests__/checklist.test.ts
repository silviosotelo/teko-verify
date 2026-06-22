import { describe, it, expect } from 'vitest'
import {
    ONBOARDING_STEPS,
    countCompleted,
    type ConfigCheckState,
} from '../checklist'

const empty: ConfigCheckState = {
    workflowCount: 0,
    hasBranding: false,
    apiKeyCount: 0,
    webhookCount: 0,
}

const full: ConfigCheckState = {
    workflowCount: 2,
    hasBranding: true,
    apiKeyCount: 3,
    webhookCount: 1,
}

describe('ONBOARDING_STEPS predicates', () => {
    it('all steps incomplete when state is empty', () => {
        expect(ONBOARDING_STEPS.every((s) => !s.isComplete(empty))).toBe(true)
    })

    it('all steps complete when state is full', () => {
        expect(ONBOARDING_STEPS.every((s) => s.isComplete(full))).toBe(true)
    })

    it('workflow step: complete only when workflowCount > 0', () => {
        const step = ONBOARDING_STEPS.find((s) => s.id === 'workflow')!
        expect(step.isComplete({ ...empty, workflowCount: 1 })).toBe(true)
        expect(step.isComplete({ ...empty, workflowCount: 0 })).toBe(false)
    })

    it('countCompleted returns 0 for empty, 4 for full', () => {
        expect(countCompleted(empty)).toBe(0)
        expect(countCompleted(full)).toBe(4)
    })

    it('countCompleted partial: 2 of 4', () => {
        const partial: ConfigCheckState = {
            ...empty,
            workflowCount: 1,
            apiKeyCount: 2,
        }
        expect(countCompleted(partial)).toBe(2)
    })
})
