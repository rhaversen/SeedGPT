import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

jest.unstable_mockModule('../config.js', () => ({
	config: {
		planModel: 'claude-haiku-4-5',
		memoryTokenBudget: 10000,
	},
}))

const mockCallApi = jest.fn<() => Promise<{ content: Array<{ type: string, text: string }>; usage: { input_tokens: number; output_tokens: number } }>>()
	.mockResolvedValue({ content: [{ type: 'text', text: 'mock summary' }], usage: { input_tokens: 10, output_tokens: 5 } })

jest.unstable_mockModule('../llm/api.js', () => ({
	callApi: mockCallApi,
	callBatchApi: jest.fn(),
}))

const memory = await import('./memory.js')
const MemoryModel = (await import('../models/Memory.js')).default

let replSet: MongoMemoryReplSet

beforeAll(async () => {
	replSet = new MongoMemoryReplSet()
	await replSet.start()
	await replSet.waitUntilRunning()
	await mongoose.connect(replSet.getUri())
}, 30000)

afterAll(async () => {
	await mongoose.disconnect()
	await replSet.stop({ doCleanup: true, force: true })
})

beforeEach(async () => {
	await MemoryModel.deleteMany({})
	jest.clearAllMocks()
})

describe('memory', () => {
	describe('store', () => {
		it('creates an unpinned memory with a summary', async () => {
			await memory.storePastMemory('Built a new feature for HTTP requests')

			const memories = await MemoryModel.find({})
			expect(memories).toHaveLength(1)
			expect(memories[0].content).toBe('Built a new feature for HTTP requests')
			expect(memories[0].summary).toBe('mock summary')
			expect(memories[0].pinned).toBe(false)
		})
	})

	describe('pin', () => {
		it('creates a pinned memory and returns confirmation', async () => {
			const result = await memory.storePinnedMemory('Goal: add test coverage')

			expect(result).toContain('Note saved')
			expect(result).toContain('mock summary')

			const memories = await MemoryModel.find({ pinned: true })
			expect(memories).toHaveLength(1)
			expect(memories[0].content).toBe('Goal: add test coverage')
		})
	})

	describe('unpin', () => {
		it('unpins an existing pinned note', async () => {
			const result = await memory.storePinnedMemory('Some goal')
			const id = result.match(/\(([a-f0-9]+)\)/)?.[1]

			const unpinResult = await memory.unpinMemory(id!)
			expect(unpinResult).toContain('Note dismissed')

			const doc = await MemoryModel.findById(id)
			expect(doc!.pinned).toBe(false)
		})

		it('returns error for non-existent id', async () => {
			const fakeId = new mongoose.Types.ObjectId().toString()
			const result = await memory.unpinMemory(fakeId)
			expect(result).toContain('No note found')
		})

		it('returns error for unpinned memory', async () => {
			await memory.storePastMemory('not pinned')
			const doc = await MemoryModel.findOne({ pinned: false })

			const result = await memory.unpinMemory(doc!._id.toString())
			expect(result).toContain('not a note')
		})
	})

	describe('getContext', () => {
		it('returns first-run message when no memories exist', async () => {
			const context = await memory.getContext()
			expect(context).toBe('No memories yet. This is your first run.')
		})

		it('includes pinned notes in "Notes to self" section', async () => {
			await memory.storePinnedMemory('Goal: become self-aware')

			const context = await memory.getContext()
			expect(context).toContain('## Notes to self')
			expect(context).toContain('mock summary')
		})

		it('includes unpinned memories in "Past" section', async () => {
			await memory.storePastMemory('Merged PR #1')

			const context = await memory.getContext()
			expect(context).toContain('## Past')
			expect(context).toContain('mock summary')
		})

		it('shows both sections when both types exist', async () => {
			await memory.storePinnedMemory('Goal: add HTTP')
			await memory.storePastMemory('Merged PR #1')

			const context = await memory.getContext()
			expect(context).toContain('## Notes to self')
			expect(context).toContain('## Past')
		})

		it('respects token budget by limiting past memories', async () => {
			const { config } = await import('../config.js');
			(config as { memoryTokenBudget: number }).memoryTokenBudget = 100

			for (let i = 0; i < 50; i++) {
				await MemoryModel.create({
					content: `Memory ${i} with some longer content to take up tokens`,
					summary: `Summary of memory number ${i} that is reasonably long`,
					pinned: false,
				})
			}

			const context = await memory.getContext()
			const lines = context.split('\n').filter(l => l.startsWith('- ('))
			expect(lines.length).toBeLessThan(50);

			(config as { memoryTokenBudget: number }).memoryTokenBudget = 10000
		})
	})

	describe('recall', () => {
		it('finds memories by keyword using regex fallback', async () => {
			await MemoryModel.create({ content: 'Added HTTP client for web access', summary: 'HTTP client', pinned: false })
			await MemoryModel.create({ content: 'Fixed a bug in the loop', summary: 'Bug fix', pinned: false })

			const result = await memory.recall('HTTP')
			expect(result).toContain('HTTP client for web access')
			expect(result).not.toContain('bug in the loop')
		})

		it('returns message when no matches found', async () => {
			const result = await memory.recall('nonexistent-query-xyz')
			expect(result).toContain('No memories matching')
		})
	})

	describe('recallById', () => {
		it('retrieves a specific memory by id', async () => {
			const doc = await MemoryModel.create({
				content: 'Specific memory content',
				summary: 'specific',
				pinned: false,
			})

			const result = await memory.recallById(doc._id.toString())
			expect(result).toContain('Specific memory content')
		})

		it('returns error for invalid id', async () => {
			const fakeId = new mongoose.Types.ObjectId().toString()
			const result = await memory.recallById(fakeId)
			expect(result).toContain('No memory with id')
		})
	})
})
