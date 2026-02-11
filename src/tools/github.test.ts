import { jest, describe, it, expect } from '@jest/globals'

jest.unstable_mockModule('../config.js', () => ({
	config: {
		githubToken: 'test-token',
		githubOwner: 'test-owner',
		githubRepo: 'test-repo',
	},
}))

jest.unstable_mockModule('../logger.js', () => {
	const noop = () => {}
	return {
		default: { debug: noop, info: noop, warn: noop, error: noop },
	}
})

const { extractCoverageFromLogs, extractFailedStepOutput } = await import('./github.js')

const COVERAGE_JSON = JSON.stringify({
	total: {
		lines: { total: 200, covered: 150, skipped: 0, pct: 75 },
		statements: { total: 250, covered: 180, skipped: 0, pct: 72 },
		functions: { total: 40, covered: 30, skipped: 0, pct: 75 },
		branches: { total: 60, covered: 42, skipped: 0, pct: 70 },
	},
	'dist/api.js': {
		lines: { total: 50, covered: 0, skipped: 0, pct: 0 },
		statements: { total: 60, covered: 0, skipped: 0, pct: 0 },
		functions: { total: 10, covered: 0, skipped: 0, pct: 0 },
		branches: { total: 15, covered: 0, skipped: 0, pct: 0 },
	},
	'dist/logger.js': {
		lines: { total: 30, covered: 28, skipped: 0, pct: 93.33 },
		statements: { total: 35, covered: 33, skipped: 0, pct: 94.29 },
		functions: { total: 8, covered: 8, skipped: 0, pct: 100 },
		branches: { total: 10, covered: 9, skipped: 0, pct: 90 },
	},
	'dist/memory.js': {
		lines: { total: 40, covered: 15, skipped: 0, pct: 37.5 },
		statements: { total: 45, covered: 18, skipped: 0, pct: 40 },
		functions: { total: 6, covered: 3, skipped: 0, pct: 50 },
		branches: { total: 8, covered: 3, skipped: 0, pct: 37.5 },
	},
})

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
	it('extracts coverage from a "Coverage" step', () => {
		const log = buildLog('Coverage', `2026-01-01T00:00:03.5000000Z ${COVERAGE_JSON}`)
		const result = extractCoverageFromLogs(log)

		expect(result).not.toBeNull()
		expect(result).toContain('72% statements')
		expect(result).toContain('70% branches')
		expect(result).toContain('75% functions')
		expect(result).toContain('75% lines')
	})

	it('identifies low-coverage files', () => {
		const log = buildLog('Coverage', `2026-01-01T00:00:03.5000000Z ${COVERAGE_JSON}`)
		const result = extractCoverageFromLogs(log)!

		expect(result).toContain('Low coverage (<50%)')
		expect(result).toContain('dist/api.js (0%)')
		expect(result).toContain('dist/memory.js (40%)')
		expect(result).not.toContain('dist/logger.js')
	})

	it('reports untested file count', () => {
		const log = buildLog('Coverage', `2026-01-01T00:00:03.5000000Z ${COVERAGE_JSON}`)
		const result = extractCoverageFromLogs(log)!

		expect(result).toContain('Untested files: 1')
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

	it('returns null when coverage step has no JSON', () => {
		const log = buildLog('Coverage', 'Running coverage...\nAll tests passed!')
		expect(extractCoverageFromLogs(log)).toBeNull()
	})

	it('returns null for malformed JSON', () => {
		const log = buildLog('Coverage', '2026-01-01T00:00:03.5000000Z {"total": invalid}')
		expect(extractCoverageFromLogs(log)).toBeNull()
	})

	it('matches "Run Coverage" step variant', () => {
		const log = buildLog('Run Coverage', `2026-01-01T00:00:03.5000000Z ${COVERAGE_JSON}`)
		const result = extractCoverageFromLogs(log)
		expect(result).not.toBeNull()
		expect(result).toContain('72% statements')
	})

	it('handles 100% coverage with no low-coverage section', () => {
		const perfectJson = JSON.stringify({
			total: {
				lines: { total: 100, covered: 100, skipped: 0, pct: 100 },
				statements: { total: 100, covered: 100, skipped: 0, pct: 100 },
				functions: { total: 20, covered: 20, skipped: 0, pct: 100 },
				branches: { total: 30, covered: 30, skipped: 0, pct: 100 },
			},
			'dist/perfect.js': {
				lines: { total: 100, covered: 100, skipped: 0, pct: 100 },
				statements: { total: 100, covered: 100, skipped: 0, pct: 100 },
				functions: { total: 20, covered: 20, skipped: 0, pct: 100 },
				branches: { total: 30, covered: 30, skipped: 0, pct: 100 },
			},
		})
		const log = buildLog('Coverage', `2026-01-01T00:00:03.5000000Z ${perfectJson}`)
		const result = extractCoverageFromLogs(log)!

		expect(result).toContain('100% statements')
		expect(result).not.toContain('Low coverage')
		expect(result).not.toContain('Untested')
	})

	it('sorts low coverage files by percentage ascending', () => {
		const log = buildLog('Coverage', `2026-01-01T00:00:03.5000000Z ${COVERAGE_JSON}`)
		const result = extractCoverageFromLogs(log)!
		const lowCoverageIdx = result.indexOf('dist/api.js')
		const memoryIdx = result.indexOf('dist/memory.js')
		expect(lowCoverageIdx).toBeLessThan(memoryIdx)
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
})
