import { describe, it, expect } from '@jest/globals'
import type Anthropic from '@anthropic-ai/sdk'
import { compressToolResult, compressOldMessages } from './compression.js'

describe('compressToolResult', () => {
	it('compresses read_file with path and line count', () => {
		const result = compressToolResult('read_file', { filePath: 'src/index.ts' }, 'line1\nline2\nline3')
		expect(result).toBe('[Previously read src/index.ts (3 lines)]')
	})

	it('compresses grep_search with match count', () => {
		const result = compressToolResult('grep_search', { query: 'foo' }, 'src/a.ts:1: foo\nsrc/b.ts:2: foo')
		expect(result).toBe('[Searched "foo": 2 matches]')
	})

	it('compresses grep_search with no matches', () => {
		const result = compressToolResult('grep_search', { query: 'nonexistent' }, 'No matches found.')
		expect(result).toBe('[Searched "nonexistent": 0 matches]')
	})

	it('compresses grep_search with singular match', () => {
		const result = compressToolResult('grep_search', { query: 'unique' }, 'src/a.ts:1: unique')
		expect(result).toBe('[Searched "unique": 1 match]')
	})

	it('truncates long grep_search queries to 60 chars', () => {
		const longQuery = 'a'.repeat(100)
		const result = compressToolResult('grep_search', { query: longQuery }, 'src/a.ts:1: match')
		expect(result).toContain('a'.repeat(60))
		expect(result).not.toContain('a'.repeat(61))
	})

	it('compresses file_search with result count', () => {
		const result = compressToolResult('file_search', { query: '**/*.ts' }, 'src/a.ts\nsrc/b.ts')
		expect(result).toBe('[File search "**/*.ts": 2 results]')
	})

	it('compresses file_search with no matches', () => {
		const result = compressToolResult('file_search', { query: '**/*.xyz' }, 'No files matched.')
		expect(result).toBe('[File search "**/*.xyz": 0 result]')
	})

	it('compresses list_directory with entry count', () => {
		const result = compressToolResult('list_directory', { path: 'src' }, 'a.ts\nb.ts\nc.ts')
		expect(result).toBe('[Listed src: 3 entries]')
	})

	it('compresses list_directory with singular entry', () => {
		const result = compressToolResult('list_directory', { path: 'src' }, 'index.ts')
		expect(result).toBe('[Listed src: 1 entry]')
	})

	it('compresses git_diff', () => {
		const result = compressToolResult('git_diff', {}, 'diff --git a/file.ts\n+added\n-removed')
		expect(result).toBe('[Diff viewed: 3 lines]')
	})

	it('compresses codebase_context', () => {
		const result = compressToolResult('codebase_context', {}, 'full context...')
		expect(result).toBe('[Codebase context viewed]')
	})

	it('compresses codebase_diff', () => {
		const result = compressToolResult('codebase_diff', {}, 'diff output...')
		expect(result).toBe('[Codebase context viewed]')
	})

	it('passes through note_to_self unchanged', () => {
		const content = 'Note saved (abc123): my note'
		expect(compressToolResult('note_to_self', {}, content)).toBe(content)
	})

	it('passes through dismiss_note unchanged', () => {
		const content = 'Note dismissed: old goal'
		expect(compressToolResult('dismiss_note', {}, content)).toBe(content)
	})

	it('passes through recall_memory unchanged', () => {
		const content = 'Memory content here'
		expect(compressToolResult('recall_memory', {}, content)).toBe(content)
	})

	it('passes through unknown tool names unchanged', () => {
		const content = 'some result content'
		expect(compressToolResult('unknown_tool', {}, content)).toBe(content)
	})
})

describe('compressOldMessages', () => {
	it('does nothing with fewer than 3 messages', () => {
		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' },
		]
		const original = JSON.parse(JSON.stringify(messages))
		compressOldMessages(messages)
		expect(messages).toEqual(original)
	})

	it('does not compress the last user message', () => {
		const longResult = 'x'.repeat(200)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { filePath: 'a.ts' } }] },
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: longResult }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'done' }] },
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: longResult }] },
		]
		compressOldMessages(messages)
		const lastUser = messages[3]
		expect((lastUser.content as Anthropic.ContentBlockParam[])[0]).toHaveProperty('content', longResult)
	})

	it('compresses tool results in earlier user messages', () => {
		const longResult = 'line1\n' + 'x'.repeat(200)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { filePath: 'src/foo.ts' } }] },
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: longResult }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'thinking...' }] },
			{ role: 'user', content: 'continue' },
		]
		compressOldMessages(messages)
		const compressed = messages[1]
		const block = (compressed.content as Anthropic.ContentBlockParam[])[0]
		expect(block).toHaveProperty('content', '[Previously read src/foo.ts (2 lines)]')
	})

	it('does not compress short tool results (<=100 chars)', () => {
		const shortResult = 'short'
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { filePath: 'a.ts' } }] },
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: shortResult }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'go' },
		]
		compressOldMessages(messages)
		const block = (messages[1].content as Anthropic.ContentBlockParam[])[0]
		expect(block).toHaveProperty('content', shortResult)
	})

	it('falls back to truncation when tool id is not in tool name map', () => {
		const longResult = 'a'.repeat(200)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'unknown-id', content: longResult }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'next' },
		]
		compressOldMessages(messages)
		const block = (messages[0].content as Anthropic.ContentBlockParam[])[0]
		const content = (block as { content: string }).content
		expect(content).toContain('[...compressed]')
		expect(content.length).toBeLessThan(200)
	})

	it('skips user messages with string content', () => {
		const messages: Anthropic.MessageParam[] = [
			{ role: 'user', content: 'first message' },
			{ role: 'assistant', content: 'response' },
			{ role: 'user', content: 'second message' },
		]
		const original = JSON.parse(JSON.stringify(messages))
		compressOldMessages(messages)
		expect(messages).toEqual(original)
	})

	it('preserves non-tool-result blocks in user messages', () => {
		const longResult = 'z'.repeat(200)
		const messages: Anthropic.MessageParam[] = [
			{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'grep_search', input: { query: 'test' } }] },
			{ role: 'user', content: [
				{ type: 'text', text: 'some context' } as Anthropic.ContentBlockParam,
				{ type: 'tool_result', tool_use_id: 't1', content: longResult },
			] },
			{ role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
			{ role: 'user', content: 'last' },
		]
		compressOldMessages(messages)
		const content = messages[1].content as Anthropic.ContentBlockParam[]
		expect(content[0]).toHaveProperty('text', 'some context')
		expect((content[1] as { content: string }).content).toContain('[Searched "test"')
	})
})
