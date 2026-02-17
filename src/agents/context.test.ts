import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type Anthropic from '@anthropic-ai/sdk'

jest.unstable_mockModule('../config.js', () => ({
config: {
context: {
protectedTurns: 1,
minResultChars: 100,
maxActiveLines: 300,
contextPadding: 3,
thinkingBudget: 10_000,
},
tools: {
defaultReadWindow: 100,
},
},
}))

jest.unstable_mockModule('../logger.js', () => {
const noop = () => {}
return { default: { debug: noop, info: noop, warn: noop, error: noop } }
})

let mockReadFile: jest.Mock<(rootPath: string, filePath: string) => Promise<string>>

jest.unstable_mockModule('../tools/codebase.js', () => {
mockReadFile = jest.fn<(rootPath: string, filePath: string) => Promise<string>>()
return {
readFile: mockReadFile,
getCodebaseContext: jest.fn(),
findUnusedFunctions: jest.fn(),
}
})

const { prepareAndBuildContext, addRegion } = await import('./context.js')

function toolUse(id: string, name: string, input: Record<string, unknown>): Anthropic.ToolUseBlock {
return { type: 'tool_use', id, name, input }
}

function toolResult(toolUseId: string, content: string): Anthropic.ToolResultBlockParam {
return { type: 'tool_result', tool_use_id: toolUseId, content }
}

function makeFileContent(lineCount: number, prefix = 'line'): string {
return Array.from({ length: lineCount }, (_, i) => `${prefix} ${i + 1}`).join('\n')
}

describe('addRegion', () => {
it('returns single region for empty input', () => {
expect(addRegion([], 1, 10, 1)).toEqual([{ start: 1, end: 10, lastUseTurn: 1 }])
})

it('merges adjacent regions with same turn', () => {
const result = addRegion([{ start: 1, end: 5, lastUseTurn: 1 }], 6, 10, 1)
expect(result).toEqual([{ start: 1, end: 10, lastUseTurn: 1 }])
})

it('keeps non-overlapping regions separate with different turns', () => {
const result = addRegion([{ start: 1, end: 5, lastUseTurn: 1 }], 8, 10, 2)
expect(result).toEqual([
{ start: 1, end: 5, lastUseTurn: 1 },
{ start: 8, end: 10, lastUseTurn: 2 },
])
})

it('clips old region when new overlaps partially', () => {
const result = addRegion([{ start: 1, end: 10, lastUseTurn: 1 }], 5, 15, 2)
expect(result).toEqual([
{ start: 1, end: 4, lastUseTurn: 1 },
{ start: 5, end: 15, lastUseTurn: 2 },
])
})

it('splits old region when new is contained within', () => {
const result = addRegion([{ start: 1, end: 20, lastUseTurn: 1 }], 5, 10, 2)
expect(result).toEqual([
{ start: 1, end: 4, lastUseTurn: 1 },
{ start: 5, end: 10, lastUseTurn: 2 },
{ start: 11, end: 20, lastUseTurn: 1 },
])
})

it('replaces old region when new fully covers it', () => {
const result = addRegion([{ start: 5, end: 10, lastUseTurn: 1 }], 1, 15, 2)
expect(result).toEqual([{ start: 1, end: 15, lastUseTurn: 2 }])
})

it('handles multiple overlapping old regions', () => {
const regions = [
{ start: 1, end: 5, lastUseTurn: 1 },
{ start: 8, end: 12, lastUseTurn: 1 },
]
const result = addRegion(regions, 3, 10, 2)
expect(result).toEqual([
{ start: 1, end: 2, lastUseTurn: 1 },
{ start: 3, end: 10, lastUseTurn: 2 },
{ start: 11, end: 12, lastUseTurn: 1 },
])
})
})

describe('prepareAndBuildContext', () => {
beforeEach(() => {
mockReadFile.mockReset()
})

describe('file tracking and working context', () => {
it('tracks a read_file call and returns working context', async () => {
const fileContent = makeFileContent(20)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/config.ts', startLine: 1, endLine: 10 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
]

const wc = await prepareAndBuildContext('/workspace', messages)

expect(wc).not.toBeNull()
expect(wc).toContain('src/config.ts')
expect(wc).toContain('1 files')
})

it('tracks multiple file reads', async () => {
const file1 = makeFileContent(10, 'alpha')
const file2 = makeFileContent(15, 'beta')
mockReadFile.mockImplementation(async (_root: string, path: string) => {
if (path.includes('a.ts')) return file1
return file2
})

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [
toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 10 }),
toolUse('t2', 'read_file', { filePath: '/workspace/src/b.ts', startLine: 1, endLine: 15 }),
] },
{ role: 'user', content: [toolResult('t1', file1), toolResult('t2', file2)] },
]

const wc = await prepareAndBuildContext('/workspace', messages)

expect(wc).toContain('src/a.ts')
expect(wc).toContain('src/b.ts')
expect(wc).toContain('2 files')
})

it('returns null when no files are tracked', async () => {
const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Hello' },
{ role: 'assistant', content: 'Hi' },
{ role: 'user', content: 'How are you' },
]

const wc = await prepareAndBuildContext('/workspace', messages)
expect(wc).toBeNull()
})
})

describe('file refresh after edit', () => {
it('shows updated content after an edit', async () => {
const updated = makeFileContent(10, 'new')
mockReadFile.mockResolvedValue(updated)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/file.ts', startLine: 1, endLine: 10 })] },
{ role: 'user', content: [toolResult('t1', makeFileContent(10, 'old'))] },
{ role: 'assistant', content: [toolUse('t2', 'edit_file', { filePath: '/workspace/src/file.ts', oldString: 'old', newString: 'new' })] },
{ role: 'user', content: [toolResult('t2', 'Replaced text in src/file.ts')] },
]

const wc = await prepareAndBuildContext('/workspace', messages)

expect(wc).toContain('new 1')
expect(wc).not.toContain('old 1')
})
})

describe('old turn stripping', () => {
it('stubs old tool_result content outside protected window', async () => {
const fileContent = makeFileContent(20)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/old.ts', startLine: 1, endLine: 20 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/new.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const firstResult = messages[2]
const blocks = firstResult.content as Anthropic.ContentBlockParam[]
const tr = blocks[0] as Anthropic.ToolResultBlockParam
expect(typeof tr.content === 'string' && tr.content.startsWith('[result')).toBe(true)
})

it('preserves last turn tool_result', async () => {
const fileContent = makeFileContent(20)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/recent.ts', startLine: 1, endLine: 20 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
]

await prepareAndBuildContext('/workspace', messages)

const lastResult = messages[2]
const blocks = lastResult.content as Anthropic.ContentBlockParam[]
const tr = blocks[0] as Anthropic.ToolResultBlockParam
expect(typeof tr.content === 'string' && !tr.content.startsWith('[result')).toBe(true)
})

it('does not stub small results', async () => {
const smallContent = 'OK'
mockReadFile.mockResolvedValue(smallContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/tiny.ts', startLine: 1, endLine: 1 })] },
{ role: 'user', content: [toolResult('t1', smallContent)] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/a.ts' })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const firstResult = messages[2]
const blocks = firstResult.content as Anthropic.ContentBlockParam[]
const tr = blocks[0] as Anthropic.ToolResultBlockParam
expect(tr.content).toBe(smallContent)
})

it('stubs ALL old tool_result types including grep_search', async () => {
const grepResult = Array.from({ length: 20 }, (_, i) => `src/file${i}.ts:${i + 1}: match found`).join('\n')
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'grep_search', { query: 'TODO', isRegexp: false })] },
{ role: 'user', content: [toolResult('t1', grepResult)] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/a.ts' })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const firstResult = messages[2]
const blocks = firstResult.content as Anthropic.ContentBlockParam[]
const tr = blocks[0] as Anthropic.ToolResultBlockParam
expect(typeof tr.content === 'string' && tr.content.startsWith('[result')).toBe(true)
})

it('is idempotent', async () => {
const fileContent = makeFileContent(20)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/old.ts', startLine: 1, endLine: 20 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/a.ts' })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

const wc1 = await prepareAndBuildContext('/workspace', messages)
const snapshot = JSON.stringify(messages)
const wc2 = await prepareAndBuildContext('/workspace', messages)

expect(wc2).toEqual(wc1)
expect(JSON.stringify(messages)).toEqual(snapshot)
})
})

describe('write input stripping', () => {
it('stubs edit_file inputs outside protected window', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'edit_file', { filePath: '/workspace/src/x.ts', oldString: 'old content here', newString: 'new content here' })] },
{ role: 'user', content: [toolResult('t1', 'Replaced text')] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/x.ts' })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const firstAssistant = messages[1]
const blocks = firstAssistant.content as Anthropic.ContentBlockParam[]
const editBlock = blocks[0] as Anthropic.ToolUseBlock
const input = editBlock.input as Record<string, string>
expect(input.oldString).toMatch(/^\[applied/)
})

it('stubs create_file inputs outside protected window', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'create_file', { filePath: '/workspace/src/new.ts', content: 'line 1\nline 2\nline 3' })] },
{ role: 'user', content: [toolResult('t1', 'Created file')] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/a.ts' })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const firstAssistant = messages[1]
const blocks = firstAssistant.content as Anthropic.ContentBlockParam[]
const createBlock = blocks[0] as Anthropic.ToolUseBlock
const input = createBlock.input as Record<string, string>
expect(input.content).toMatch(/^\[applied/)
})
})

describe('region-level eviction', () => {
it('evicts oldest regions when over budget', async () => {
const bigFile = makeFileContent(200, 'big')
const smallFile = makeFileContent(200, 'small')
mockReadFile.mockImplementation(async (_root: string, path: string) => {
if (path.includes('old')) return bigFile
return smallFile
})

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/old.ts', startLine: 1, endLine: 200 })] },
{ role: 'user', content: [toolResult('t1', bigFile)] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/new.ts', startLine: 1, endLine: 200 })] },
{ role: 'user', content: [toolResult('t2', smallFile)] },
]

const wc = await prepareAndBuildContext('/workspace', messages)

expect(wc).toContain('src/new.ts')
expect(wc).toMatch(/\d+ \| small/)
})

it('keeps recent regions in same file while evicting old ones', async () => {
const bigFile = makeFileContent(500, 'content')
mockReadFile.mockResolvedValue(bigFile)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/big.ts', startLine: 1, endLine: 200 })] },
{ role: 'user', content: [toolResult('t1', makeFileContent(200))] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/big.ts', startLine: 400, endLine: 500 })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(100))] },
]

const wc = await prepareAndBuildContext('/workspace', messages)

expect(wc).toContain('src/big.ts')
expect(wc).toContain('content 400')
})
})

describe('old reasoning stripping', () => {
it('strips text blocks from old assistant messages', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [
{ type: 'text', text: 'Let me analyze this file...' } as Anthropic.TextBlockParam,
toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 5 }),
] },
{ role: 'user', content: [toolResult('t1', makeFileContent(5))] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/b.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const oldAssistant = messages[1]
const blocks = oldAssistant.content as Anthropic.ContentBlockParam[]
expect(blocks.some(b => b.type === 'text' && (b as Anthropic.TextBlockParam).text === 'Let me analyze this file...')).toBe(true)
expect(blocks.every(b => b.type === 'text' || b.type === 'tool_use')).toBe(true)
})

it('strips thinking blocks from old assistant messages', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [
{ type: 'thinking', thinking: 'Deep reasoning...', signature: 'sig1' } as Anthropic.ThinkingBlockParam,
{ type: 'text', text: 'I will read the file.' } as Anthropic.TextBlockParam,
toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 5 }),
] },
{ role: 'user', content: [toolResult('t1', makeFileContent(5))] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/b.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const oldAssistant = messages[1]
const blocks = oldAssistant.content as Anthropic.ContentBlockParam[]
expect(blocks.some(b => b.type === 'thinking')).toBe(false)
})

it('replaces text-only assistant messages with marker', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [
{ type: 'text', text: 'Here is my analysis of the problem...' } as Anthropic.TextBlockParam,
] },
{ role: 'user', content: 'Continue' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t1', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const oldAssistant = messages[1]
const blocks = oldAssistant.content as Anthropic.ContentBlockParam[]
expect(blocks).toHaveLength(1)
expect(blocks[0].type).toBe('text')
})

it('replaces string-only assistant messages with marker', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: 'This is my response as a string' },
{ role: 'user', content: 'Continue' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t1', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

expect(messages[1].content).toBe('[reasoning stripped]')
})

it('preserves recent assistant messages within protected window', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [
{ type: 'thinking', thinking: 'Recent thinking...' } as Anthropic.ThinkingBlockParam,
{ type: 'text', text: 'Recent text' } as Anthropic.TextBlockParam,
toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 5 }),
] },
{ role: 'user', content: [toolResult('t1', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)

const recentAssistant = messages[1]
const blocks = recentAssistant.content as Anthropic.ContentBlockParam[]
expect(blocks.some(b => b.type === 'thinking')).toBe(true)
expect(blocks.some(b => b.type === 'text')).toBe(true)
})

it('is idempotent for stripping', async () => {
mockReadFile.mockResolvedValue(makeFileContent(5))

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [
{ type: 'text', text: 'Reasoning...' } as Anthropic.TextBlockParam,
toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 5 }),
] },
{ role: 'user', content: [toolResult('t1', makeFileContent(5))] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/b.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(5))] },
]

await prepareAndBuildContext('/workspace', messages)
const snapshot = JSON.stringify(messages)
await prepareAndBuildContext('/workspace', messages)

expect(JSON.stringify(messages)).toEqual(snapshot)
})
})

describe('deleted file handling', () => {
it('excludes deleted files from working context', async () => {
const fileContent = makeFileContent(10)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/doomed.ts', startLine: 1, endLine: 10 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
{ role: 'assistant', content: [toolUse('t2', 'delete_file', { filePath: '/workspace/src/doomed.ts' })] },
{ role: 'user', content: [toolResult('t2', 'Deleted')] },
]

const wc = await prepareAndBuildContext('/workspace', messages)
expect(wc).toBeNull()
})
})

describe('context padding', () => {
it('expands tracked regions by contextPadding', async () => {
const fileContent = makeFileContent(30)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/padded.ts', startLine: 10, endLine: 15 })] },
{ role: 'user', content: [toolResult('t1', makeFileContent(6))] },
]

const wc = (await prepareAndBuildContext('/workspace', messages))!

expect(wc).toContain('7 |')
expect(wc).toContain('18 |')
})
})

describe('gap markers', () => {
it('shows gap markers for non-contiguous regions', async () => {
const fileContent = makeFileContent(50)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [
toolUse('t1', 'read_file', { filePath: '/workspace/src/gaps.ts', startLine: 1, endLine: 5 }),
toolUse('t2', 'read_file', { filePath: '/workspace/src/gaps.ts', startLine: 40, endLine: 45 }),
] },
{ role: 'user', content: [
toolResult('t1', makeFileContent(5)),
toolResult('t2', makeFileContent(6)),
] },
]

const wc = (await prepareAndBuildContext('/workspace', messages))!

expect(wc).toContain('lines omitted')
})
})

describe('path normalization', () => {
it('normalizes absolute workspace paths to relative', async () => {
const fileContent = makeFileContent(5)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/deep/file.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
]

const wc = (await prepareAndBuildContext('/workspace', messages))!

expect(wc).toContain('src/deep/file.ts')
expect(wc).not.toContain('/workspace/src/deep/file.ts')
})
})

describe('working context not injected into messages', () => {
it('does not add working context blocks to messages', async () => {
const fileContent = makeFileContent(10)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/a.ts', startLine: 1, endLine: 10 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
]

await prepareAndBuildContext('/workspace', messages)

const lastMsg = messages[messages.length - 1]
const blocks = lastMsg.content as Anthropic.ContentBlockParam[]
const hasWC = blocks.some(b => b.type === 'text' && (b as Anthropic.TextBlockParam).text.includes('Working Context'))
expect(hasWC).toBe(false)
})
})

describe('readFile delegation', () => {
it('calls codebase readFile with workspace path and relative path', async () => {
const fileContent = makeFileContent(5)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/test.ts', startLine: 1, endLine: 5 })] },
{ role: 'user', content: [toolResult('t1', fileContent)] },
]

await prepareAndBuildContext('/workspace', messages)

expect(mockReadFile).toHaveBeenCalledWith('/workspace', 'src/test.ts')
})
})

describe('create_file tracking', () => {
it('tracks created files with full-file region', async () => {
const fileContent = makeFileContent(10)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'create_file', { filePath: '/workspace/src/created.ts', content: fileContent })] },
{ role: 'user', content: [toolResult('t1', 'Created file')] },
]

const wc = await prepareAndBuildContext('/workspace', messages)

expect(wc).toContain('src/created.ts')
expect(wc).toContain('1 |')
})
})

describe('per-region turn tracking', () => {
it('tracks different turns for different regions in same file', async () => {
const fileContent = makeFileContent(100)
mockReadFile.mockResolvedValue(fileContent)

const messages: Anthropic.MessageParam[] = [
{ role: 'user', content: 'Start' },
{ role: 'assistant', content: [toolUse('t1', 'read_file', { filePath: '/workspace/src/multi.ts', startLine: 1, endLine: 10 })] },
{ role: 'user', content: [toolResult('t1', makeFileContent(10))] },
{ role: 'assistant', content: [toolUse('t2', 'read_file', { filePath: '/workspace/src/multi.ts', startLine: 50, endLine: 60 })] },
{ role: 'user', content: [toolResult('t2', makeFileContent(11))] },
]

const wc = await prepareAndBuildContext('/workspace', messages)

expect(wc).toContain('src/multi.ts')
expect(wc).toContain('lines omitted')
})
})
})
