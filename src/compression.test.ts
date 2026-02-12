import { describe, it, expect } from '@jest/globals'
import type Anthropic from '@anthropic-ai/sdk'
import { redactToolResult, summarizeToolResult, compressOldMessages } from './compression.js'

describe('summarizeToolResult', () => {
	it('summarizes read_file with path and line count', () => {
		expect(summarizeToolResult('read_file', { filePath: 'src/index.ts' }, 'line1\nline2\nline3'))
			.toBe('[Read src/index.ts (3 lines)]')
	})

	it('summarizes grep_search with match count', () => {
		expect(summarizeToolResult('grep_search', { query: 'foo' }, 'src/a.ts:1: foo\nsrc/b.ts:2: foo'))
			.toBe('[Searched "foo": 2 matches]')
	})

	it('summarizes grep_search with no matches', () => {
		expect(summarizeToolResult('grep_search', { query: 'x' }, 'No matches found.'))
			.toBe('[Searched "x": 0 matches]')
	})

	it('summarizes list_directory', () => {
		expect(summarizeToolResult('list_directory', { path: 'src' }, 'a.ts\nb.ts'))
			.toBe('[Listed src: 2 entries]')
	})

	it('summarizes git_diff', () => {
		expect(summarizeToolResult('git_diff', {}, '+a\n-b\n c'))
			.toBe('[Diff viewed: 3 lines]')
	})

	it('truncates unknown tools to 200 chars', () => {
		const long = 'x'.repeat(300)
		expect(summarizeToolResult('unknown', {}, long)).toBe('x'.repeat(200))
	})
})

describe('redactToolResult', () => {
	it('redacts read_file with path', () => {
		const result = redactToolResult('read_file', { filePath: 'src/index.ts' }, 'line1\nline2\nline3')
		expect(result).toBe('[Content of src/index.ts was removed from context — you do NOT know what this file contains. Re-read it if needed.]')
	})

	it('redacts grep_search with query', () => {
		const result = redactToolResult('grep_search', { query: 'foo' }, 'src/a.ts:1: foo\nsrc/b.ts:2: foo')
		expect(result).toBe('[Search results for "foo" were removed from context — search again if needed.]')
	})

	it('redacts grep_search with no matches', () => {
		const result = redactToolResult('grep_search', { query: 'nonexistent' }, 'No matches found.')
		expect(result).toBe('[Search results for "nonexistent" were removed from context — search again if needed.]')
	})

	it('truncates long grep_search queries to 60 chars', () => {
		const longQuery = 'a'.repeat(100)
		const result = redactToolResult('grep_search', { query: longQuery }, 'src/a.ts:1: match')
		expect(result).toContain('a'.repeat(60))
		expect(result).not.toContain('a'.repeat(61))
	})

	it('redacts file_search', () => {
		const result = redactToolResult('file_search', { query: '**/*.ts' }, 'src/a.ts\nsrc/b.ts')
		expect(result).toBe('[File search results were removed from context — search again if needed.]')
	})

	it('redacts file_search with no matches', () => {
		const result = redactToolResult('file_search', { query: '**/*.xyz' }, 'No files matched.')
		expect(result).toBe('[File search results were removed from context — search again if needed.]')
	})

	it('redacts list_directory with path', () => {
		const result = redactToolResult('list_directory', { path: 'src' }, 'a.ts\nb.ts\nc.ts')
		expect(result).toBe('[Directory listing for src was removed from context — list again if needed.]')
	})

	it('redacts list_directory singular entry', () => {
		const result = redactToolResult('list_directory', { path: 'src' }, 'index.ts')
		expect(result).toBe('[Directory listing for src was removed from context — list again if needed.]')
	})

	it('redacts git_diff', () => {
		const result = redactToolResult('git_diff', {}, 'diff --git a/file.ts\n+added\n-removed')
		expect(result).toBe('[Diff was removed from context — run git_diff again if needed.]')
	})

	it('redacts codebase_context', () => {
		const result = redactToolResult('codebase_context', {}, 'full context...')
		expect(result).toBe('[Codebase context was removed — call again if needed.]')
	})

	it('redacts codebase_diff', () => {
		const result = redactToolResult('codebase_diff', {}, 'diff output...')
		expect(result).toBe('[Codebase context was removed — call again if needed.]')
	})

	it('passes through note_to_self unchanged', () => {
		const content = 'Note saved (abc123): my note'
		expect(redactToolResult('note_to_self', {}, content)).toBe(content)
	})

	it('passes through dismiss_note unchanged', () => {
		const content = 'Note dismissed: old goal'
		expect(redactToolResult('dismiss_note', {}, content)).toBe(content)
	})

	it('passes through recall_memory unchanged', () => {
		const content = 'Memory content here'
		expect(redactToolResult('recall_memory', {}, content)).toBe(content)
	})

	it('passes through unknown tool names unchanged', () => {
		const content = 'some result content'
		expect(redactToolResult('unknown_tool', {}, content)).toBe(content)
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
		expect(block).toHaveProperty('content', '[Content of src/foo.ts was removed from context — you do NOT know what this file contains. Re-read it if needed.]')
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
		expect((content[1] as { content: string }).content).toContain('[Search results for "test" were removed')
	})
})
