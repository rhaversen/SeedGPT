import { describe, it, expect } from '@jest/globals'

const { extractCoverageFromLogs, extractFailedStepOutput } = await import('./log-parsing.js')

const COVERAGE_TABLE = [
	'------------------|---------|----------|---------|---------|-------------------',
	'File              | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
	'------------------|---------|----------|---------|---------|-------------------',
	'All files         |   69.91 |    86.91 |   64.89 |   69.91 |',
	' src              |   56.78 |    85.93 |   76.92 |   56.78 |',
	'  config.ts       |       0 |        0 |       0 |       0 | 1-84',
	'  database.ts     |       0 |        0 |       0 |       0 | 1-46',
	'  logger.ts       |     100 |    92.68 |     100 |     100 | 64,68-69',
	'  loop.ts         |   94.85 |       85 |     100 |   94.85 | 82-84,88-91',
	' src/agents       |   72.96 |    83.95 |      92 |   72.96 |',
	'  build.ts        |       0 |        0 |       0 |       0 | 1-122',
	'  memory.ts       |     100 |     93.1 |     100 |     100 | 8,23',
	'  plan.ts         |       0 |        0 |       0 |       0 | 1-80',
	' src/tools        |   60.07 |    91.48 |      44 |   60.07 |',
	'  codebase.ts     |   71.61 |    90.38 |   73.68 |   71.61 | 283-289,292-298',
	'  definitions.ts  |   62.64 |      100 |       0 |   62.64 | 269-415,418-431',
	'------------------|---------|----------|---------|---------|-------------------',
].join('\n')

function buildLog(stepName: string, content: string): string {
	return [
		'2026-01-01T00:00:00.0000000Z ##[group]Checkout repository',
		'2026-01-01T00:00:01.0000000Z Fetching...',
		'2026-01-01T00:00:02.0000000Z ##[endgroup]',
		`2026-01-01T00:00:03.0000000Z ##[group]${stepName}`,
		content,
		'2026-01-01T00:00:04.0000000Z ##[endgroup]',
	].join('\n')
}

describe('extractCoverageFromLogs', () => {
	it('extracts the full coverage table from a "Coverage" step', () => {
		const log = buildLog('Coverage', COVERAGE_TABLE)
		const result = extractCoverageFromLogs(log)

		expect(result).toBe(COVERAGE_TABLE)
	})

	it('matches "Run Coverage" step variant', () => {
		const log = buildLog('Run Coverage', COVERAGE_TABLE)
		const result = extractCoverageFromLogs(log)

		expect(result).toBe(COVERAGE_TABLE)
	})

	it('preserves uncovered line numbers in the table', () => {
		const log = buildLog('Coverage', COVERAGE_TABLE)
		const result = extractCoverageFromLogs(log)!

		expect(result).toContain('1-84')
		expect(result).toContain('82-84,88-91')
		expect(result).toContain('269-415,418-431')
	})

	it('returns null when no coverage step exists', () => {
		const log = [
			'##[group]Build',
			'Building...',
			'##[endgroup]',
			'##[group]Test',
			'Tests passed',
			'##[endgroup]',
		].join('\n')

		expect(extractCoverageFromLogs(log)).toBeNull()
	})

	it('returns null when coverage step has no table', () => {
		const log = buildLog('Coverage', 'Running coverage...\nAll tests passed!')
		expect(extractCoverageFromLogs(log)).toBeNull()
	})

	it('ignores non-table content surrounding the table', () => {
		const content = [
			'PASS dist/loop.test.js',
			'Test Suites: 5 passed, 5 total',
			'',
			COVERAGE_TABLE,
			'',
			'Done in 12.34s.',
		].join('\n')
		const log = buildLog('Coverage', content)
		const result = extractCoverageFromLogs(log)

		expect(result).toBe(COVERAGE_TABLE)
	})
})

describe('extractFailedStepOutput', () => {
	it('prioritizes FAIL blocks over PASS output', () => {
		const log = [
			'2026-01-01T00:00:00Z ##[group]Run npm test',
			'2026-01-01T00:00:01Z  FAIL  dist/loop.test.js',
			'2026-01-01T00:00:01Z   ● Test suite failed to run',
			'2026-01-01T00:00:01Z     SyntaxError: Missing export storePastMemory',
			'2026-01-01T00:00:01Z       at Runtime (node_modules/jest-runtime/build/index.js:684:5)',
			'2026-01-01T00:00:02Z  PASS  dist/logger.test.js',
			...Array(100).fill('2026-01-01T00:00:02Z     console.log output from passing test'),
			'2026-01-01T00:00:03Z  PASS  dist/memory.test.js',
			...Array(100).fill('2026-01-01T00:00:03Z     more console output from another passing test'),
			'2026-01-01T00:00:04Z Test Suites: 1 failed, 2 passed, 3 total',
			'2026-01-01T00:00:04Z Tests:       10 passed, 10 total',
			'2026-01-01T00:00:04Z ##[error]Process completed with exit code 1.',
			'2026-01-01T00:00:05Z ##[endgroup]',
		].join('\n')

		const result = extractFailedStepOutput(log, ['npm test'])

		expect(result).toContain('FAIL')
		expect(result).toContain('SyntaxError: Missing export storePastMemory')
		expect(result).toContain('Test Suites: 1 failed')
		expect(result).not.toContain('console.log output from passing test')
	})

	it('falls back to tail when no FAIL blocks exist', () => {
		const log = [
			'2026-01-01T00:00:00Z ##[group]Run npm run build',
			'2026-01-01T00:00:01Z src/index.ts(5,1): error TS2304: Cannot find name "foo".',
			'2026-01-01T00:00:01Z ##[error]Process completed with exit code 2.',
			'2026-01-01T00:00:02Z ##[endgroup]',
		].join('\n')

		const result = extractFailedStepOutput(log, ['npm run build'])

		expect(result).toContain('error TS2304')
		expect(result).toContain('Cannot find name "foo"')
	})

	it('includes error lines in summary', () => {
		const log = [
			'2026-01-01T00:00:00Z ##[group]Run npm test',
			'2026-01-01T00:00:01Z  FAIL  dist/api.test.js',
			'2026-01-01T00:00:01Z   ● API > should call endpoint',
			'2026-01-01T00:00:01Z     Expected: 200, Received: 500',
			'2026-01-01T00:00:02Z  PASS  dist/util.test.js',
			'2026-01-01T00:00:03Z Test Suites: 1 failed, 1 passed, 2 total',
			'2026-01-01T00:00:03Z ERROR: Process completed with exit code 1.',
			'2026-01-01T00:00:04Z ##[endgroup]',
		].join('\n')

		const result = extractFailedStepOutput(log, ['npm test'])

		expect(result).toContain('Expected: 200, Received: 500')
		expect(result).toContain('ERROR: Process completed with exit code 1.')
	})

	it('extracts by error markers when no step name matches', () => {
		const log = [
			'2026-01-01T00:00:00Z ##[group]Some Step',
			'2026-01-01T00:00:01Z Build successful',
			'2026-01-01T00:00:02Z ##[endgroup]',
			'2026-01-01T00:00:03Z ##[group]Another Step',
			'2026-01-01T00:00:04Z Something went wrong',
			'2026-01-01T00:00:04Z ##[error]Fatal error occurred',
			'2026-01-01T00:00:05Z ##[endgroup]',
		].join('\n')

		const result = extractFailedStepOutput(log, ['nonexistent-step'])

		expect(result).toContain('Fatal error occurred')
	})

	it('filters PASS noise from fallback when step matching fails', () => {
		const log = [
			'2026-01-01T00:00:00Z ##[group]Run tests',
			'2026-01-01T00:00:01Z  FAIL  dist/api.test.js',
			'2026-01-01T00:00:01Z   ● API > should respond',
			'2026-01-01T00:00:01Z     TypeError: Cannot read property of undefined',
			'2026-01-01T00:00:02Z  PASS  dist/logger.test.js',
			'2026-01-01T00:00:02Z   ● Console',
			'2026-01-01T00:00:02Z     console.log',
			'2026-01-01T00:00:02Z       at log (src/logger.ts:28:11)',
			'2026-01-01T00:00:02Z       2026-02-11T22:59:03.582Z [INFO] Applied 1 edit(s) successfully',
			'2026-01-01T00:00:03Z  PASS  dist/usage.test.js',
			'2026-01-01T00:00:03Z   ● Console',
			'2026-01-01T00:00:03Z     console.log',
			'2026-01-01T00:00:03Z       Saved usage',
			'2026-01-01T00:00:04Z Test Suites: 1 failed, 2 passed, 3 total',
			'2026-01-01T00:00:04Z ##[error]Process completed with exit code 1.',
			'2026-01-01T00:00:05Z ##[endgroup]',
		].join('\n')

		const result = extractFailedStepOutput(log, ['nonexistent-step'])

		expect(result).toContain('FAIL')
		expect(result).toContain('TypeError: Cannot read property of undefined')
		expect(result).toContain('Test Suites: 1 failed')
		expect(result).not.toContain('console.log')
		expect(result).not.toContain('Applied 1 edit(s)')
		expect(result).not.toContain('Saved usage')
	})
})
