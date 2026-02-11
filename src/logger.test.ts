import { jest, describe, it, expect, beforeEach } from '@jest/globals'

jest.unstable_mockModule('./models/IterationLog.js', () => ({
	default: {
		create: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as never),
	},
}))

const loggerModule = await import('./logger.js')
const logger = loggerModule.default
const { getLogBuffer, writeIterationLog, toolLogSuffix } = loggerModule
const IterationLogModel = (await import('./models/IterationLog.js')).default

beforeEach(() => {
	;(getLogBuffer() as unknown as { length: number }).length = 0
	jest.clearAllMocks()
})

describe('logger', () => {
	it('logs info messages to the buffer', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		logger.info('test message')
		const buffer = getLogBuffer()
		expect(buffer.length).toBe(1)
		expect(buffer[0].level).toBe('info')
		expect(buffer[0].message).toBe('test message')
		expect(buffer[0].timestamp).toBeDefined()
		consoleSpy.mockRestore()
	})

	it('logs messages with context', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		logger.warn('warning', { detail: 'something' })
		const buffer = getLogBuffer()
		expect(buffer[0].context).toEqual({ detail: 'something' })
		consoleSpy.mockRestore()
	})

	it('logs at warn and error levels', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		logger.warn('w')
		logger.error('e')
		const buffer = getLogBuffer()
		expect(buffer.map(e => e.level)).toEqual(['warn', 'error'])
		consoleSpy.mockRestore()
	})

	it('outputs to console.log', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		logger.info('hello world')
		expect(consoleSpy).toHaveBeenCalled()
		const output = consoleSpy.mock.calls[0][0] as string
		expect(output).toContain('[INFO]')
		expect(output).toContain('hello world')
		consoleSpy.mockRestore()
	})
})

describe('getLogBuffer', () => {
	it('returns accumulated log entries', () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		logger.info('a')
		logger.warn('b')
		expect(getLogBuffer().length).toBe(2)
		consoleSpy.mockRestore()
	})
})

describe('writeIterationLog', () => {
	it('saves log buffer to database and clears it', async () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
		logger.info('entry 1')
		logger.warn('entry 2')

		await writeIterationLog()

		expect(IterationLogModel.create).toHaveBeenCalledTimes(1)
		const call = (IterationLogModel.create as jest.Mock).mock.calls[0][0] as { entries: unknown[] }
		expect(call.entries.length).toBe(2)
		expect(getLogBuffer().length).toBe(0)
		consoleSpy.mockRestore()
	})

	it('handles database errors gracefully', async () => {
		const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		(IterationLogModel.create as jest.MockedFunction<typeof IterationLogModel.create>).mockRejectedValueOnce(new Error('db error') as never)
		logger.info('entry')

		await expect(writeIterationLog()).resolves.toBeUndefined()
		expect(getLogBuffer().length).toBe(0)
		consoleSpy.mockRestore()
	})
})

describe('toolLogSuffix', () => {
	it('formats read_file with path and line range', () => {
		expect(toolLogSuffix({ name: 'read_file', input: { filePath: 'src/a.ts', startLine: 1, endLine: 10 } }))
			.toBe(': src/a.ts L1-10')
	})

	it('formats read_file with start line only', () => {
		expect(toolLogSuffix({ name: 'read_file', input: { filePath: 'src/a.ts', startLine: 5 } }))
			.toBe(': src/a.ts L5+')
	})

	it('formats read_file with path only', () => {
		expect(toolLogSuffix({ name: 'read_file', input: { filePath: 'src/a.ts' } }))
			.toBe(': src/a.ts')
	})

	it('formats edit_file with line count', () => {
		expect(toolLogSuffix({ name: 'edit_file', input: { filePath: 'src/a.ts', oldString: 'a\nb\nc' } }))
			.toBe(': src/a.ts (replacing 3 lines)')
	})

	it('formats edit_file with singular line', () => {
		expect(toolLogSuffix({ name: 'edit_file', input: { filePath: 'src/a.ts', oldString: 'single' } }))
			.toBe(': src/a.ts (replacing 1 line)')
	})

	it('formats create_file with line count', () => {
		expect(toolLogSuffix({ name: 'create_file', input: { filePath: 'src/new.ts', content: 'a\nb' } }))
			.toBe(': src/new.ts (2 lines)')
	})

	it('formats delete_file with path', () => {
		expect(toolLogSuffix({ name: 'delete_file', input: { filePath: 'src/old.ts' } }))
			.toBe(': src/old.ts')
	})

	it('formats grep_search with query', () => {
		expect(toolLogSuffix({ name: 'grep_search', input: { query: 'findme' } }))
			.toBe(': "findme"')
	})

	it('formats grep_search with includePattern', () => {
		expect(toolLogSuffix({ name: 'grep_search', input: { query: 'test', includePattern: 'src/**' } }))
			.toBe(': "test" in src/**')
	})

	it('formats file_search', () => {
		expect(toolLogSuffix({ name: 'file_search', input: { query: '**/*.ts' } }))
			.toBe(': "**/*.ts"')
	})

	it('formats list_directory', () => {
		expect(toolLogSuffix({ name: 'list_directory', input: { path: 'src/tools' } }))
			.toBe(': src/tools')
	})

	it('formats done with truncated summary', () => {
		expect(toolLogSuffix({ name: 'done', input: { summary: 'All changes applied successfully' } }))
			.toBe(': All changes applied successfully')
	})

	it('returns empty for unknown tool', () => {
		expect(toolLogSuffix({ name: 'unknown', input: {} })).toBe('')
	})
})
