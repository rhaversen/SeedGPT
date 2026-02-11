import { jest, describe, it, expect, beforeEach } from '@jest/globals'

jest.unstable_mockModule('./logger.js', () => {
	const noop = () => {}
	return {
		default: { debug: noop, info: noop, warn: noop, error: noop },
	}
})

const mockGetHeadSha = jest.fn<((...args: unknown[]) => Promise<string>)>().mockResolvedValue('abc123')
jest.unstable_mockModule('./tools/git.js', () => ({
	getHeadSha: mockGetHeadSha,
}))

const mockAwaitPRChecks = jest.fn<((...args: unknown[]) => Promise<{ passed: boolean; error?: string }>)>()
	.mockResolvedValue({ passed: true })
const mockFindOpenAgentPRs = jest.fn<((...args: unknown[]) => Promise<Array<{ number: number; head: { ref: string } }>>)>()
	.mockResolvedValue([])
const mockClosePR = jest.fn<((...args: unknown[]) => Promise<void>)>().mockResolvedValue(undefined)
const mockDeleteRemoteBranch = jest.fn<((...args: unknown[]) => Promise<void>)>().mockResolvedValue(undefined)
const mockExtractCoverage = jest.fn<((...args: unknown[]) => Promise<string | null>)>().mockResolvedValue(null)

jest.unstable_mockModule('./tools/github.js', () => ({
	awaitPRChecks: mockAwaitPRChecks,
	findOpenAgentPRs: mockFindOpenAgentPRs,
	closePR: mockClosePR,
	deleteRemoteBranch: mockDeleteRemoteBranch,
	extractCoverage: mockExtractCoverage,
}))

const { awaitChecks, getCoverage, cleanupStalePRs } = await import('./pipeline.js')

beforeEach(() => {
	jest.clearAllMocks()
})

describe('awaitChecks', () => {
	it('gets head SHA and checks PR status', async () => {
		const result = await awaitChecks()
		expect(mockGetHeadSha).toHaveBeenCalledTimes(1)
		expect(mockAwaitPRChecks).toHaveBeenCalledWith('abc123')
		expect(result).toEqual({ passed: true })
	})

	it('returns failure result from PR checks', async () => {
		mockAwaitPRChecks.mockResolvedValueOnce({ passed: false, error: 'test failed' })
		const result = await awaitChecks()
		expect(result).toEqual({ passed: false, error: 'test failed' })
	})
})

describe('cleanupStalePRs', () => {
	it('does nothing when no stale PRs exist', async () => {
		mockFindOpenAgentPRs.mockResolvedValueOnce([])
		await cleanupStalePRs()
		expect(mockClosePR).not.toHaveBeenCalled()
		expect(mockDeleteRemoteBranch).not.toHaveBeenCalled()
	})

	it('closes and deletes branches for stale PRs', async () => {
		mockFindOpenAgentPRs.mockResolvedValueOnce([
			{ number: 10, head: { ref: 'seedgpt/old-change' } },
			{ number: 11, head: { ref: 'seedgpt/another-change' } },
		])

		await cleanupStalePRs()

		expect(mockClosePR).toHaveBeenCalledTimes(2)
		expect(mockClosePR).toHaveBeenCalledWith(10)
		expect(mockClosePR).toHaveBeenCalledWith(11)
		expect(mockDeleteRemoteBranch).toHaveBeenCalledTimes(2)
		expect(mockDeleteRemoteBranch).toHaveBeenCalledWith('seedgpt/old-change')
		expect(mockDeleteRemoteBranch).toHaveBeenCalledWith('seedgpt/another-change')
	})

	it('ignores branch deletion errors', async () => {
		mockFindOpenAgentPRs.mockResolvedValueOnce([
			{ number: 5, head: { ref: 'seedgpt/broken' } },
		])
		mockDeleteRemoteBranch.mockRejectedValueOnce(new Error('already deleted'))

		await cleanupStalePRs()

		expect(mockClosePR).toHaveBeenCalledWith(5)
	})
})

describe('getCoverage', () => {
	it('gets head SHA and extracts coverage', async () => {
		mockExtractCoverage.mockResolvedValueOnce('Coverage: 80% statements')
		const result = await getCoverage()
		expect(mockGetHeadSha).toHaveBeenCalledTimes(1)
		expect(mockExtractCoverage).toHaveBeenCalledWith('abc123')
		expect(result).toBe('Coverage: 80% statements')
	})

	it('returns null when no coverage found', async () => {
		mockExtractCoverage.mockResolvedValueOnce(null)
		const result = await getCoverage()
		expect(result).toBeNull()
	})
})
