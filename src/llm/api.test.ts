import { jest, describe, it, expect, beforeEach } from '@jest/globals'

jest.unstable_mockModule('../config.js', () => ({
	config: {
		anthropicApiKey: 'test-key',
		phases: {
			reflect: { model: 'claude-haiku-4-5', maxTokens: 512 },
			memory: { model: 'claude-haiku-4-5', maxTokens: 64 },
			planner: { model: 'claude-sonnet-4-5', maxTokens: 4096 },
			builder: { model: 'claude-sonnet-4-5', maxTokens: 16384 },
			summarizer: { model: 'claude-haiku-4-5', maxTokens: 2048 },
		},
		api: { maxRetries: 2, initialRetryDelay: 10, maxRetryDelay: 50 },
		batch: { pollInterval: 10, maxPollInterval: 50, pollBackoff: 1.5 },
		workspacePath: './workspace',
	},
}))

jest.unstable_mockModule('../logger.js', () => {
	const noop = () => {}
	return { default: { debug: noop, info: noop, warn: noop, error: noop } }
})

jest.unstable_mockModule('../agents/compression.js', () => ({
	compressConversation: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}))

const mockComputeCost = jest.fn<(...args: unknown[]) => number>(() => 0.01)
const mockModelCreate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined as never)

jest.unstable_mockModule('../models/Generated.js', () => ({
	default: { create: mockModelCreate },
	computeCost: mockComputeCost,
}))

jest.unstable_mockModule('../tools/definitions.js', () => ({
	PLANNER_TOOLS: [],
	BUILDER_TOOLS: [],
}))

jest.unstable_mockModule('../tools/codebase.js', () => ({
	getCodebaseContext: jest.fn<() => Promise<string>>().mockResolvedValue('codebase context'),
	findUnusedFunctions: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
}))

jest.unstable_mockModule('./prompts.js', () => ({
	SYSTEM_PLAN: 'plan prompt',
	SYSTEM_BUILD: 'build prompt',
	SYSTEM_REFLECT: 'reflect prompt',
	SYSTEM_MEMORY: 'memory prompt',
	SYSTEM_SUMMARIZE: 'summarize prompt',
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreate: jest.Mock<(...args: any[]) => any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockBatchCreate: jest.Mock<(...args: any[]) => any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockBatchRetrieve: jest.Mock<(...args: any[]) => any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockBatchResults: jest.Mock<(...args: any[]) => any>

jest.unstable_mockModule('@anthropic-ai/sdk', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockCreate = jest.fn<(...args: any[]) => any>()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockBatchCreate = jest.fn<(...args: any[]) => any>()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockBatchRetrieve = jest.fn<(...args: any[]) => any>()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockBatchResults = jest.fn<(...args: any[]) => any>()
	return {
		default: class {
			messages = {
				create: mockCreate,
				batches: {
					create: mockBatchCreate,
					retrieve: mockBatchRetrieve,
					results: mockBatchResults,
				},
			}
		},
	}
})

const { callApi, callBatchApi } = await import('./api.js')

const fakeUsage = { input_tokens: 100, output_tokens: 50 }

const fakeMessage = {
	id: 'msg_1',
	type: 'message' as const,
	role: 'assistant' as const,
	model: 'claude-haiku-4-5',
	content: [{ type: 'text' as const, text: 'hello' }],
	stop_reason: 'end_turn' as const,
	stop_sequence: null,
	usage: fakeUsage,
}

beforeEach(() => {
	mockCreate.mockReset()
	mockBatchCreate.mockReset()
	mockBatchRetrieve.mockReset()
	mockBatchResults.mockReset()
	mockComputeCost.mockReset().mockReturnValue(0.01)
	mockModelCreate.mockReset().mockResolvedValue(undefined as never)
})

function* yieldSucceeded(ids: string[], messages: typeof fakeMessage[]) {
	for (let i = 0; i < ids.length; i++) {
		yield { custom_id: ids[i], result: { type: 'succeeded', message: messages[i] } }
	}
}

describe('callApi', () => {
	it('builds params and calls the SDK', async () => {
		mockCreate.mockResolvedValue(fakeMessage)

		const result = await callApi('reflect', [{ role: 'user', content: 'test' }])

		expect(result).toBe(fakeMessage)
		expect(mockCreate).toHaveBeenCalledTimes(1)
		const params = mockCreate.mock.calls[0][0] as { model: string }
		expect(params.model).toBe('claude-haiku-4-5')
	})

	it('records to Generated after a successful call', async () => {
		mockCreate.mockResolvedValue(fakeMessage)

		await callApi('builder', [{ role: 'user', content: 'test' }])

		expect(mockComputeCost).toHaveBeenCalledWith('claude-sonnet-4-5', fakeUsage, { batch: false })
		expect(mockModelCreate).toHaveBeenCalledTimes(1)
		expect((mockModelCreate.mock.calls[0] as unknown[])[0]).toMatchObject({
			phase: 'builder',
			modelId: 'claude-sonnet-4-5',
			batch: false,
		})
	})

	it('retries on 429 status', async () => {
		const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 })
		mockCreate.mockRejectedValueOnce(rateLimitErr)
		mockCreate.mockResolvedValueOnce(fakeMessage)

		const result = await callApi('reflect', [{ role: 'user', content: 'test' }])

		expect(result).toBe(fakeMessage)
		expect(mockCreate).toHaveBeenCalledTimes(2)
	})

	it('throws non-429 errors immediately', async () => {
		const serverErr = Object.assign(new Error('server error'), { status: 500 })
		mockCreate.mockRejectedValue(serverErr)

		await expect(callApi('reflect', [{ role: 'user', content: 'test' }])).rejects.toThrow('server error')
		expect(mockCreate).toHaveBeenCalledTimes(1)
	})

	it('throws after exhausting retries', async () => {
		const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 })
		mockCreate.mockRejectedValue(rateLimitErr)

		await expect(callApi('reflect', [{ role: 'user', content: 'test' }])).rejects.toThrow('rate limited')
		expect(mockCreate).toHaveBeenCalledTimes(3)
	})

	it('passes extra tools when provided', async () => {
		mockCreate.mockResolvedValue(fakeMessage)
		const extraTool = { name: 'test_tool', description: 'test', input_schema: { type: 'object' as const, properties: {} } }

		await callApi('reflect', [{ role: 'user', content: 'test' }], [extraTool])

		const params = mockCreate.mock.calls[0][0] as { tools?: unknown[] }
		expect(params.tools).toEqual([extraTool])
	})
})

describe('callBatchApi', () => {
	it('submits batch, polls until ended, and returns ordered results', async () => {
		mockBatchCreate.mockImplementation(async ({ requests }: { requests: Array<{ custom_id: string }> }) => {
			return { id: 'batch_1', processing_status: 'in_progress', _requestIds: requests.map(r => r.custom_id) }
		})
		mockBatchRetrieve.mockResolvedValue({ id: 'batch_1', processing_status: 'ended' })
		mockBatchResults.mockImplementation(async () => {
			const ids = mockBatchCreate.mock.calls[0][0].requests.map((r: { custom_id: string }) => r.custom_id)
			return (async function*() { yield* yieldSucceeded(ids, [fakeMessage]) })()
		})

		const results = await callBatchApi([{ phase: 'reflect', messages: [{ role: 'user', content: 'test' }] }])

		expect(results).toHaveLength(1)
		expect(results[0]).toBe(fakeMessage)
		expect(mockBatchCreate).toHaveBeenCalledTimes(1)
	})

	it('polls multiple times until ended', async () => {
		mockBatchCreate.mockImplementation(async ({ requests }: { requests: Array<{ custom_id: string }> }) => {
			return { id: 'batch_1', processing_status: 'in_progress', _requestIds: requests.map(r => r.custom_id) }
		})
		mockBatchRetrieve
			.mockResolvedValueOnce({ id: 'batch_1', processing_status: 'in_progress' })
			.mockResolvedValueOnce({ id: 'batch_1', processing_status: 'ended' })
		mockBatchResults.mockImplementation(async () => {
			const ids = mockBatchCreate.mock.calls[0][0].requests.map((r: { custom_id: string }) => r.custom_id)
			return (async function*() { yield* yieldSucceeded(ids, [fakeMessage]) })()
		})

		const results = await callBatchApi([{ phase: 'reflect', messages: [{ role: 'user', content: 'test' }] }])

		expect(results).toHaveLength(1)
		expect(mockBatchRetrieve).toHaveBeenCalledTimes(2)
	})

	it('skips polling when batch is already ended', async () => {
		mockBatchCreate.mockImplementation(async ({ requests }: { requests: Array<{ custom_id: string }> }) => {
			return { id: 'batch_1', processing_status: 'ended', _requestIds: requests.map(r => r.custom_id) }
		})
		mockBatchResults.mockImplementation(async () => {
			const ids = mockBatchCreate.mock.calls[0][0].requests.map((r: { custom_id: string }) => r.custom_id)
			return (async function*() { yield* yieldSucceeded(ids, [fakeMessage]) })()
		})

		await callBatchApi([{ phase: 'reflect', messages: [{ role: 'user', content: 'test' }] }])

		expect(mockBatchRetrieve).not.toHaveBeenCalled()
	})

	it('throws on errored batch result', async () => {
		mockBatchCreate.mockResolvedValue({ id: 'batch_1', processing_status: 'ended' })
		mockBatchResults.mockImplementation(async () => {
			return (async function*() {
				yield { custom_id: 'req-0', result: { type: 'errored', error: { type: 'server_error', message: 'fail' } } }
			})()
		})

		await expect(
			callBatchApi([{ phase: 'reflect', messages: [{ role: 'user', content: 'test' }] }])
		).rejects.toThrow('failed')
	})

	it('returns multiple results in input order and records each', async () => {
		const fakeMessage2 = { ...fakeMessage, id: 'msg_2' }
		mockBatchCreate.mockImplementation(async ({ requests }: { requests: Array<{ custom_id: string }> }) => {
			return { id: 'batch_1', processing_status: 'ended', _requestIds: requests.map(r => r.custom_id) }
		})
		mockBatchResults.mockImplementation(async () => {
			const ids = mockBatchCreate.mock.calls[0][0].requests.map((r: { custom_id: string }) => r.custom_id)
			return (async function*() { yield* yieldSucceeded(ids, [fakeMessage, fakeMessage2]) })()
		})

		const results = await callBatchApi([
			{ phase: 'reflect', messages: [{ role: 'user', content: 'a' }] },
			{ phase: 'memory', messages: [{ role: 'user', content: 'b' }] },
		])

		expect(results).toHaveLength(2)
		expect(results[0]).toBe(fakeMessage)
		expect(results[1]).toBe(fakeMessage2)
		expect(mockModelCreate).toHaveBeenCalledTimes(2)
		expect(mockComputeCost).toHaveBeenCalledWith('claude-haiku-4-5', fakeUsage, { batch: true })
	})

	it('throws when results are missing', async () => {
		mockBatchCreate.mockResolvedValue({ id: 'batch_1', processing_status: 'ended' })
		mockBatchResults.mockImplementation(async () => {
			return (async function*() {})()
		})

		await expect(
			callBatchApi([{ phase: 'reflect', messages: [{ role: 'user', content: 'test' }] }])
		).rejects.toThrow('missing results')
	})

	it('returns empty array for empty input', async () => {
		const results = await callBatchApi([])
		expect(results).toEqual([])
		expect(mockBatchCreate).not.toHaveBeenCalled()
	})
})
