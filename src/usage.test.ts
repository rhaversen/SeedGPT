import { jest, describe, it, expect, beforeEach } from '@jest/globals'

jest.unstable_mockModule('./logger.js', () => {
	const log = (_level: string, message: string, context?: Record<string, unknown>) => {
		if (context) console.log(message, JSON.stringify(context))
		else console.log(message)
	}
	return {
		default: {
			debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
			info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
			warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
			error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
		},
	}
})

jest.unstable_mockModule('./models/Usage.js', () => {
	return {
		default: {
			create: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as never),
		},
	}
})

const { computeCost, trackUsage, logSummary, saveUsageData, resetUsage } = await import('./usage.js')
const UsageModel = (await import('./models/Usage.js')).default

beforeEach(() => {
	resetUsage()
	jest.clearAllMocks()
})

describe('computeCost', () => {
	it('computes cost for claude-sonnet-4-5', () => {
		const cost = computeCost('claude-sonnet-4-5', 1_000_000, 1_000_000)
		expect(cost).toBe(3 + 15)
	})

	it('computes cost for claude-haiku-4-5', () => {
		const cost = computeCost('claude-haiku-4-5', 1_000_000, 1_000_000)
		expect(cost).toBe(1 + 5)
	})

	it('computes cost for claude-opus-4-6', () => {
		const cost = computeCost('claude-opus-4-6', 1_000_000, 1_000_000)
		expect(cost).toBe(5 + 25)
	})

	it('uses default pricing for unknown models', () => {
		const cost = computeCost('unknown-model', 1_000_000, 1_000_000)
		expect(cost).toBe(5 + 25)
	})

	it('computes fractional costs correctly', () => {
		const cost = computeCost('claude-haiku-4-5', 500, 200)
		expect(cost).toBeCloseTo(500 * 1 / 1_000_000 + 200 * 5 / 1_000_000)
	})

	it('returns 0 for zero tokens', () => {
		expect(computeCost('claude-sonnet-4-5', 0, 0)).toBe(0)
	})
})

describe('trackUsage', () => {
	it('records usage entries that logSummary reports', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 })
		logSummary()
		expect(consoleSpy).toHaveBeenCalled()
		const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
		expect(output).toContain('1 API calls')
		expect(output).toContain('planner')
		consoleSpy.mockRestore()
	})
})

describe('logSummary', () => {
	it('reports no API calls when empty', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		logSummary()
		const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
		expect(output).toContain('No API calls recorded')
		consoleSpy.mockRestore()
	})

	it('aggregates by model and caller', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 })
		trackUsage('builder', 'claude-sonnet-4-5', { input_tokens: 200, output_tokens: 100 })
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 50, output_tokens: 25 })
		logSummary()
		const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
		expect(output).toContain('3 API calls')
		expect(output).toContain('planner')
		expect(output).toContain('builder')
		expect(output).toContain('claude-haiku-4-5')
		expect(output).toContain('claude-sonnet-4-5')
		consoleSpy.mockRestore()
	})
})

describe('resetUsage', () => {
	it('clears all tracked entries', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 })
		resetUsage()
		logSummary()
		const output = consoleSpy.mock.calls.map(c => c[0]).join('\n')
		expect(output).toContain('No API calls recorded')
		consoleSpy.mockRestore()
	})
})

describe('saveUsageData', () => {
	it('saves usage data to the database', async () => {
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 })
		trackUsage('builder', 'claude-sonnet-4-5', { input_tokens: 200, output_tokens: 100 })

		await saveUsageData('test-plan')

		expect(UsageModel.create).toHaveBeenCalledTimes(1)
		const call = (UsageModel.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>
		expect(call.planTitle).toBe('test-plan')
		expect(call.totalCalls).toBe(2)
		expect(call.totalInputTokens).toBe(300)
		expect(call.totalOutputTokens).toBe(150)
		expect(call.totalCost).toBeGreaterThan(0)
		expect((call.breakdown as unknown[]).length).toBe(2)
	})

	it('aggregates entries with the same caller:model key', async () => {
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 })
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 })

		await saveUsageData('test-plan')

		const call = (UsageModel.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>
		const breakdown = call.breakdown as Array<{ calls: number; inputTokens: number }>
		expect(breakdown.length).toBe(1)
		expect(breakdown[0].calls).toBe(2)
		expect(breakdown[0].inputTokens).toBe(200)
	})

	it('handles database errors gracefully', async () => {
		(UsageModel.create as jest.MockedFunction<typeof UsageModel.create>).mockRejectedValueOnce(new Error('db error') as never)
		trackUsage('planner', 'claude-haiku-4-5', { input_tokens: 100, output_tokens: 50 })

		await expect(saveUsageData('test-plan')).resolves.toBeUndefined()
	})
})
