import { describe, it, expect } from '@jest/globals'

const { config } = await import('./config.js')

describe('config', () => {
	it('exports a config object with all required sections', () => {
		expect(config.phases).toBeDefined()
		expect(config.turns).toBeDefined()
		expect(config.api).toBeDefined()
		expect(config.batch).toBeDefined()
		expect(config.ci).toBeDefined()
		expect(config.git).toBeDefined()
		expect(config.errors).toBeDefined()
		expect(config.memory).toBeDefined()
		expect(config.summarization).toBeDefined()
		expect(config.db).toBeDefined()
	})

	it('has models and maxTokens for all phases', () => {
		for (const phase of ['planner', 'builder', 'fixer', 'reflect', 'memory', 'summarizer'] as const) {
			expect(typeof config.phases[phase].model).toBe('string')
			expect(config.phases[phase].maxTokens).toBeGreaterThan(0)
		}
	})

	it('has positive turn limits', () => {
		expect(config.turns.maxPlanner).toBeGreaterThan(0)
		expect(config.turns.maxBuilder).toBeGreaterThan(0)
		expect(config.turns.maxFixer).toBeGreaterThan(0)
	})

	it('has valid API retry settings', () => {
		expect(config.api.maxRetries).toBeGreaterThan(0)
		expect(config.api.initialRetryDelay).toBeGreaterThan(0)
		expect(config.api.maxRetryDelay).toBeGreaterThan(config.api.initialRetryDelay)
	})

	it('has valid batch polling settings', () => {
		expect(config.batch.pollInterval).toBeGreaterThan(0)
		expect(config.batch.pollBackoff).toBeGreaterThan(1)
	})

	it('has valid summarization settings', () => {
		expect(config.summarization.charThreshold).toBeGreaterThan(0)
		expect(config.summarization.protectedTurns).toBeGreaterThanOrEqual(1)
		expect(typeof config.summarization.gapMarker).toBe('string')
	})

	it('uses a chars-per-token ratio between 1 and 10', () => {
		expect(config.memory.estimationRatio).toBeGreaterThanOrEqual(1)
		expect(config.memory.estimationRatio).toBeLessThanOrEqual(10)
	})
})
