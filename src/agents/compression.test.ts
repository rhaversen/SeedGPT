import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type Anthropic from '@anthropic-ai/sdk'

jest.unstable_mockModule('../config.js', () => ({
	config: {
		anthropicApiKey: 'test-key',
		summarization: {
			charThreshold: 500,
			minResultChars: 100,
			protectedTurns: 2,
			gapMarker: '[Lines omitted from context. Re-read file if required context is missing.]',
		},
	},
}))

jest.unstable_mockModule('../logger.js', () => {
	const noop = () => {}
	return { default: { debug: noop, info: noop, warn: noop, error: noop } }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCallBatchApi: jest.Mock<(...args: any[]) => any>

jest.unstable_mockModule('../llm/api.js', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockCallBatchApi = jest.fn<(...args: any[]) => any>()
	return { callBatchApi: mockCallBatchApi }
})

const { compressConversation } = await import('./compression.js')
const { config } = await import('../config.js')

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

	const GAP = config.summarization.gapMarker

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
			content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }],
		}])

		const longContent = `first\n${'x'.repeat(600)}`
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
		expect(result.content).toBe(`first\n${GAP}`)
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

	it('keeps content unchanged on LLM failure', async () => {
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
		expect(result.content).toBe(longContent)
	})

	it('batches multiple candidates into one batch call', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }] },
			{ content: [{ type: 'tool_use', id: 'call2', name: 'summarize_lines', input: { tool_use_id: 't2', keep_lines: '1' } }] },
		])

		const longContent = `first\n${'x'.repeat(600)}`
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
		expect(r1.content).toBe(`first\n${GAP}`)
		expect(r2.content).toBe(`first\n${GAP}`)
	})

	it('keeps candidates when LLM returns no tool call', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }] },
			{ content: [{ type: 'text', text: 'This result should be kept.' }] },
		])

		const longContent = `first\n${'x'.repeat(600)}`
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
		expect(r1.content).toBe(`first\n${GAP}`)
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
			content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }],
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
			content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }],
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

	it('applies partial responses and keeps remaining candidates unchanged', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }] },
			{ content: [{ type: 'tool_use', id: 'call2', name: 'keep', input: { tool_use_id: 't2' } }] },
		])

		const longContent = `first\n${'x'.repeat(600)}`
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [toolUse('t2', 'grep_search', { query: 'foo' })] },
			{ role: 'user', content: [toolResult('t2', longContent)] },
			{ role: 'assistant', content: [toolUse('t3', 'list_directory', { path: 'src' })] },
			{ role: 'user', content: [toolResult('t3', longContent)] },
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
		const r3 = (messages[5].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(r1.content).toBe(`first\n${GAP}`)
		expect(r2.content).toBe(longContent)
		expect(r3.content).toBe(longContent)
	})

	it('handles responses with missing content field', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }] },
			{} as Anthropic.Message, // Missing content field
		])

		const longContent = `first\n${'x'.repeat(600)}`
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
		expect(r1.content).toBe(`first\n${GAP}`)
		expect(r2.content).toBe(longContent)
	})

	it('handles empty responses array gracefully', async () => {
		// Batch API returns empty array instead of throwing
		mockCallBatchApi.mockResolvedValue([])

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
		expect(r1.content).toBe(longContent) // Both kept unchanged
		expect(r2.content).toBe(longContent)
	})

	it('discards responses with mismatched tool_use_ids', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 'wrong_id', keep_lines: '1' } }] },
			{ content: [{ type: 'tool_use', id: 'call2', name: 'summarize_lines', input: { tool_use_id: 't2', keep_lines: '1' } }] },
		])

		const longContent = `first\n${'x'.repeat(600)}`
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
		expect(r1.content).toBe(longContent)
		expect(r2.content).toBe(`first\n${GAP}`)
	})

	it('handles mixed successful and failing individual responses', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }] },
			{ content: [{ type: 'text', text: 'No tool call' }] },
			{ content: [{ type: 'tool_use', id: 'call3', name: 'keep', input: { tool_use_id: 't3' } }] },
		])

		const longContent = `first\n${'x'.repeat(600)}`
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [toolUse('t2', 'grep_search', { query: 'foo' })] },
			{ role: 'user', content: [toolResult('t2', longContent)] },
			{ role: 'assistant', content: [toolUse('t3', 'file_search', { query: 'bar' })] },
			{ role: 'user', content: [toolResult('t3', longContent)] },
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
		const r3 = (messages[5].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(r1.content).toBe(`first\n${GAP}`)
		expect(r2.content).toBe(longContent)
		expect(r3.content).toBe(longContent)
	})

	it('handles undefined and null responses in array', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }] },
			undefined as unknown as Anthropic.Message,
			null as unknown as Anthropic.Message,
		])

		const longContent = `first\n${'x'.repeat(600)}`
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [toolUse('t2', 'grep_search', { query: 'foo' })] },
			{ role: 'user', content: [toolResult('t2', longContent)] },
			{ role: 'assistant', content: [toolUse('t3', 'file_search', { query: 'bar' })] },
			{ role: 'user', content: [toolResult('t3', longContent)] },
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
		const r3 = (messages[5].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(r1.content).toBe(`first\n${GAP}`)
		expect(r2.content).toBe(longContent)
		expect(r3.content).toBe(longContent)
	})

	it('handles out-of-order responses correctly by matching tool_use_id', async () => {
		mockCallBatchApi.mockResolvedValue([
			{ content: [{ type: 'tool_use', id: 'call3', name: 'keep', input: { tool_use_id: 't3' } }] },
			{ content: [{ type: 'tool_use', id: 'call2', name: 'summarize_lines', input: { tool_use_id: 't2', keep_lines: '1' } }] },
			{ content: [{ type: 'tool_use', id: 'call1', name: 'summarize_lines', input: { tool_use_id: 't1', keep_lines: '1' } }] },
		])

		const longContent = `first\n${'x'.repeat(600)}`
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [toolUse('t2', 'grep_search', { query: 'foo' })] },
			{ role: 'user', content: [toolResult('t2', longContent)] },
			{ role: 'assistant', content: [toolUse('t3', 'file_search', { query: 'bar' })] },
			{ role: 'user', content: [toolResult('t3', longContent)] },
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
		const r3 = (messages[5].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
		expect(r1.content).toBe(`first\n${GAP}`)
		expect(r2.content).toBe(`first\n${GAP}`)
		expect(r3.content).toBe(longContent)
	})

	describe('line-based compression', () => {
		const makeLine = (num: number) => `line ${num} ${'x'.repeat(80)}`
		
		// Helper to make test messages with enough protected turns
		const makeMessages = (longContent: string): Anthropic.MessageParam[] => [
			{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: 'a.ts' })] },
			{ role: 'user', content: [toolResult('t1', longContent)] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'a' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'b' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'c' },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'd' },
		]

		it('compresses using line ranges and adds gap markers', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '1-3,5' } 
				}],
			}])

			const longContent = [1,2,3,4,5,6].map(makeLine).join('\n')
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
			expect(result.content).toBe(`${makeLine(1)}\n${makeLine(2)}\n${makeLine(3)}\n${GAP}\n${makeLine(5)}\n${GAP}`)
		})

		it('adds gap marker at start when not starting at line 1', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '4-6' } 
				}],
			}])

			const longContent = [1,2,3,4,5,6].map(makeLine).join('\n')
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
			expect(result.content).toBe(`${GAP}\n${makeLine(4)}\n${makeLine(5)}\n${makeLine(6)}`)
		})

		it('adds gap marker at end when not ending at last line', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '1-3' } 
				}],
			}])

			const longContent = [1,2,3,4,5,6].map(makeLine).join('\n')
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
			expect(result.content).toBe(`${makeLine(1)}\n${makeLine(2)}\n${makeLine(3)}\n${GAP}`)
		})

		it('adds gap markers at both start and end', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '4-6' } 
				}],
			}])

			const longContent = [1,2,3,4,5,6,7,8,9,10].map(makeLine).join('\n')
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
			expect(result.content).toBe(`${GAP}\n${makeLine(4)}\n${makeLine(5)}\n${makeLine(6)}\n${GAP}`)
		})

		it('no gap markers when keeping all lines', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '1-3' } 
				}],
			}])

			const longContent = [1,2,3].map(makeLine).join('\n')
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
			expect(result.content).toBe(`${makeLine(1)}\n${makeLine(2)}\n${makeLine(3)}`)
		})

		it('handles multiple gaps between ranges', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '1,4,7,10' } 
				}],
			}])

			const longContent = [1,2,3,4,5,6,7,8,9,10].map(makeLine).join('\n')
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
			expect(result.content).toBe(`${makeLine(1)}\n${GAP}\n${makeLine(4)}\n${GAP}\n${makeLine(7)}\n${GAP}\n${makeLine(10)}`)
		})

		it('handles gap markers in already-compressed content', async () => {
			// First compression
			mockCallBatchApi.mockResolvedValueOnce([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '1-3,5' } 
				}],
			}])

			const longContent = [1,2,3,4,5,6].map(makeLine).join('\n')
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
			
			// First compression
			await compressConversation(messages)
			let result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
			expect(result.content).toBe(`${makeLine(1)}\n${makeLine(2)}\n${makeLine(3)}\n${GAP}\n${makeLine(5)}\n${GAP}`)
			
			// Second compression - content now has gap markers at lines 4 and 6
			// Keep lines 1,5 (which is "line 1" and "line 5" from original)
			mockCallBatchApi.mockResolvedValueOnce([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '1,5' } 
				}],
			}])
			
			await compressConversation(messages)
			result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
			expect(result.content).toBe(`${makeLine(1)}\n${GAP}\n${makeLine(5)}\n${GAP}`)
		})

		it('handles invalid line ranges by keeping content unchanged', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '' } 
				}],
			}])

			const longContent = [1,2,3].map(makeLine).join('\n')
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
			expect(result.content).toBe(longContent) // Unchanged
		})

		it('sorts out-of-order ranges', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{ 
					type: 'tool_use', 
					id: 'call1', 
					name: 'summarize_lines', 
					input: { tool_use_id: 't1', keep_lines: '4-6,1-2' } 
				}],
			}])

			const longContent = [1,2,3,4,5,6].map(makeLine).join('\n')
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
			expect(result.content).toBe(`${makeLine(1)}\n${makeLine(2)}\n${GAP}\n${makeLine(4)}\n${makeLine(5)}\n${makeLine(6)}`)
		})

		it('merges overlapping ranges without duplicating lines', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{
					type: 'tool_use',
					id: 'call1',
					name: 'summarize_lines',
					input: { tool_use_id: 't1', keep_lines: '1-5,3-8' }
				}],
			}])

			const longContent = [1,2,3,4,5,6,7,8,9,10].map(makeLine).join('\n')
			const messages = makeMessages(longContent)
			await compressConversation(messages)

			const result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
			const expected = [1,2,3,4,5,6,7,8].map(makeLine).join('\n') + `\n${GAP}`
			expect(result.content).toBe(expected)
		})

		it('deduplicates repeated single-line ranges', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{
					type: 'tool_use',
					id: 'call1',
					name: 'summarize_lines',
					input: { tool_use_id: 't1', keep_lines: '3,3,3' }
				}],
			}])

			const longContent = [1,2,3,4,5,6].map(makeLine).join('\n')
			const messages = makeMessages(longContent)
			await compressConversation(messages)

			const result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
			expect(result.content).toBe(`${GAP}\n${makeLine(3)}\n${GAP}`)
		})

		it('merges contained range without duplication', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{
					type: 'tool_use',
					id: 'call1',
					name: 'summarize_lines',
					input: { tool_use_id: 't1', keep_lines: '1-10,5-6' }
				}],
			}])

			const longContent = [1,2,3,4,5,6,7,8,9,10].map(makeLine).join('\n')
			const messages = makeMessages(longContent)
			await compressConversation(messages)

			const result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
			const expected = [1,2,3,4,5,6,7,8,9,10].map(makeLine).join('\n')
			expect(result.content).toBe(expected)
		})

		it('merges adjacent ranges into continuous block', async () => {
			mockCallBatchApi.mockResolvedValue([{
				content: [{
					type: 'tool_use',
					id: 'call1',
					name: 'summarize_lines',
					input: { tool_use_id: 't1', keep_lines: '1-3,3-6' }
				}],
			}])

			const longContent = [1,2,3,4,5,6,7,8].map(makeLine).join('\n')
			const messages = makeMessages(longContent)
			await compressConversation(messages)

			const result = (messages[1].content as Anthropic.ContentBlockParam[])[0] as Anthropic.ToolResultBlockParam
			const expected = [1,2,3,4,5,6].map(makeLine).join('\n') + `\n${GAP}`
			expect(result.content).toBe(expected)
		})
	})
})
