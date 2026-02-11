import * as git from './tools/git.js'
import * as github from './tools/github.js'
import logger from './logger.js'

export async function awaitChecks(): Promise<github.CheckResult> {
	const sha = await git.getHeadSha()
	return github.awaitPRChecks(sha)
}

export async function getCoverage(): Promise<string | null> {
	const sha = await git.getHeadSha()
	return github.extractCoverage(sha)
}

export async function cleanupStalePRs(): Promise<void> {
	const prs = await github.findOpenAgentPRs()
	for (const pr of prs) {
		logger.warn(`Closing stale agent PR #${pr.number} (${pr.head.ref})`)
		await github.closePR(pr.number)
		await github.deleteRemoteBranch(pr.head.ref).catch(() => {})
	}
}
