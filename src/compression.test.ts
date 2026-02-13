import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type Anthropic from '@anthropic-ai/sdk'

jest.unstable_mockModule('./config.js', () => ({
	config: {
		anthropicApiKey: 'test-key',
		summarization: {
			charThreshold: 500,
			minResultChars: 100,
			protectedTurns: 2,
		},
	},
}))

jest.unstable_mockModule('./logger.js', () => {
	const noop = () => {}
	return { default: { debug: noop, info: noop, warn: noop, error: noop } }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCallBatchApi: jest.Mock<(...args: any[]) => any>

jest.unstable_mockModule('./api.js', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockCallBatchApi = jest.fn<(...args: any[]) => any>()
	return { callBatchApi: mockCallBatchApi }
})

const { compressConversation } = await import('./compression.js')

function toolUse(id: string, name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock {
	return { type: 'tool_use', id, name, input }
}

function toolResult(toolUseId: string, content: string): Anthropic.ToolResultBlockParam {
	return { type: 'tool_result', tool_use_id: toolUseId, content }
}

describe('compressConversation', () => {
	beforeEach(() => {
		mockCallBatchApi.mockReset()
	})

	it('does nothing with fewer than 3 messages', async () => {
		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
		]
		const original = JSON.parse(JSON.stringify(messages))
		await compressConversation(messages)
		expect(messages).toEqual(original)
	})

	it('does nothing when total chars are below threshold', async () => {
		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: 'hi' },
			{ role: 'assistant', content: 'hello' },
			{ role: 'user', content: 'go' },
		]
		const original = JSON.parse(JSON.stringify(messages))
		await compressConversation(messages)
		expect(messages).toEqual(original)
	})

	it('calls LLM with batched candidates and applies summaries', async () => {
		mockCallBatchApi.mockResolvedValue([{
			content: [{ type: 'tool_use', id: 'call1', name: 'summarize', input: { tool_use_id: 't1', summary: 'File contents of a.ts' } }],
		}])

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(result.content).toBe('File contents of a.ts')
		expect(mockCallBatchApi).toHaveBeenCalledTimes(1)
		expect(mockCallBatchApi.mock.calls[0][0]).toHaveLength(1)
		expect(mockCallBatchApi.mock.calls[0][0][0].phase).toBe('summarizer')
	})

	it('keeps results when LLM returns keep tool', async () => {
		mockCallBatchApi.mockResolvedValue([{
			content: [{ type: 'tool_use', id: 'call1', name: 'keep', input: { tool_use_id: 't1' } }],
		}])

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(result.content).toBe(longContent)
	})

	it('redacts on LLM failure', async () => {
		mockCallBatchApi.mockRejectedValue(new Error('Batch error'))

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(result.content).toContain('[Redacted:')
	})

	it('batches multiple candidates into one batch call', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize', input: { tool_use_id: 't1', summary: 'compressed a' } }] },
			{ content: [{ type: 'tool_use', id: 'call2', name: 'summarize', input: { tool_use_id: 't2', summary: 'compressed b' } }] },
		])

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [toolUse('t2', 'grep_search', { query: 'foo' })] },
			{ role: 'user', content: [toolResult('t2', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		expect(mockCallBatchApi).toHaveBeenCalledTimes(1)
		expect(mockCallBatchApi.mock.calls[0][0]).toHaveLength(2)
		const r1 = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		const r2 = (messages[3].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(r1.content).toBe('compressed a')
		expect(r2.content).toBe('compressed b')
	})

	it('keeps candidates when LLM returns no tool call', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize', input: { tool_use_id: 't1', summary: 'compressed' } }] },
			{ content: [{ type: 'text', text: 'This result should be kept.' }] },
		])

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [toolUse('t2', 'grep_search', { query: 'foo' })] },
			{ role: 'user', content: [toolResult('t2', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const r1 = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		const r2 = (messages[3].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(r1.content).toBe('compressed')
		expect(r2.content).toBe(longContent)
	})

	it('adds cache breakpoints to conversation messages', async () => {
		mockCallBatchApi.mockResolvedValue([{
			content: [{ type: 'tool_use', id: 'call1', name: 'keep', input: { tool_use_id: 't1' } }],
		}])

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const requests = mockCallBatchApi.mock.calls[0][0] as Array<{ messages: Anthropic.MessageParam[] }>
		const batchMessages = requests[0].messages
		// cachedMessages end at length - 3 (assistant shim + user instruction follow)
		const lastConvoMsg = batchMessages[batchMessages.length - 3]
		const lastContent = Array.isArray(lastConvoMsg.content) ? lastConvoMsg.content : [lastConvoMsg.content]
		const lastBlock = lastContent[lastContent.length - 1] as { cache_control?: unknown }
		expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' })
	})

	it('protects the most recent user messages', async () => {
		mockCallBatchApi.mockResolvedValue([{
			content: [{ type: 'tool_use', id: 'call1', name: 'summarize', input: { summary: 'compressed' } }],
		}])

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: 'b.ts' })] },
			{ role: 'user', content: [toolResult('t2', longContent)] },
		]
		await compressConversation(messages)

		expect(mockCallBatchApi).not.toHaveBeenCalled()
	})

	it('never selects note_to_self results', async () => {
		mockCallBatchApi.mockResolvedValue([{
			content: [{ type: 'tool_use', id: 'call1', name: 'summarize', input: { summary: 'compressed' } }],
		}])

		const longContent = 'x'.repeat(600)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'note_to_self', { content: 'remember this' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		expect(mockCallBatchApi).not.toHaveBeenCalled()
	})

	it('strips edit_file inputs outside protected turns', async () => {
		mockCallBatchApi.mockResolvedValue([])

		const longOld = 'old\n'.repeat(50)
		const longNew = 'new\n'.repeat(50)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'edit_file', { filePath: 'a.ts', oldString: longOld, newString: longNew })] },
			{ role: 'user', content: [toolResult('t1', 'Replaced text in a.ts')] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a'.repeat(600) },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const block = (messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolUseBlock
		const input = block.input as { filePath: string; oldString: string; newString: string }
		expect(input.filePath).toBe('a.ts')
		expect(input.oldString).toMatch(/^\[applied/)
		expect(input.newString).toMatch(/^\[applied/)
	})

	it('strips create_file inputs outside protected turns', async () => {
		mockCallBatchApi.mockResolvedValue([])

		const longContent = 'line\n'.repeat(100)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'create_file', { filePath: 'b.ts', content: longContent })] },
			{ role: 'user', content: [toolResult('t1', 'Created b.ts')] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a'.repeat(600) },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const block = (messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolUseBlock
		const input = block.input as { filePath: string; content: string }
		expect(input.filePath).toBe('b.ts')
		expect(input.content).toMatch(/^\[applied/)
	})

	it('preserves write inputs within protected turns', async () => {
		const longOld = 'old\n'.repeat(50)
		const longNew = 'new\n'.repeat(50)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'edit_file', { filePath: 'a.ts', oldString: longOld, newString: longNew })] },
			{ role: 'user', content: [toolResult('t1', 'Replaced text in a.ts')] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a'.repeat(600) },
		]
		await compressConversation(messages)

		const block = (messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolUseBlock
		const input = block.input as { oldString: string; newString: string }
		expect(input.oldString).toBe(longOld)
		expect(input.newString).toBe(longNew)
	})

	it('does not re-strip already stripped inputs', async () => {
		mockCallBatchApi.mockResolvedValue([])

		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'edit_file', { filePath: 'a.ts', oldString: '[applied — 50 lines]', newString: '[applied — 50 lines]' })] },
			{ role: 'user', content: [toolResult('t1', 'Replaced text in a.ts')] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a'.repeat(600) },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
		]
		await compressConversation(messages)

		const block = (messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolUseBlock
		const input = block.input as { oldString: string; newString: string }
		expect(input.oldString).toBe('[applied — 50 lines]')
		expect(input.newString).toBe('[applied — 50 lines]')
	})
})
