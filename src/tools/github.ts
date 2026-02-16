import { Octokit } from '@octokit/rest'
import { config } from '../config.js'
import { env } from '../env.js'
import logger from '../logger.js'
import { getHeadSha } from './git.js'
import { extractFailedStepOutput, extractCoverageFromLogs } from './log-parsing.js'

const octokit = new Octokit({ auth: env.githubToken })
const owner = env.githubOwner
const repo = env.githubRepo

export interface CheckResult {
	passed: boolean
	error?: string
}

export async function openPR(branch: string, title: string, body: string): Promise<number> {
	logger.info(`Opening PR: "${title}"`)
	const { data } = await octokit.pulls.create({
		owner, repo,
		title,
		body,
		head: branch,
		base: 'main',
	})
	logger.info(`PR #${data.number} opened`)
	return data.number
}

export async function awaitPRChecks(sha: string): Promise<CheckResult> {
	const start = Date.now()
	const { pollInterval, timeout, noChecksTimeout } = config.ci

	while (Date.now() - start < timeout) {
		const { data } = await octokit.checks.listForRef({ owner, repo, ref: sha })
		const runs = data.check_runs

		if (runs.length === 0) {
			if (Date.now() - start > noChecksTimeout) {
				logger.warn('No CI checks registered after 2 minutes — treating as passed')
				return { passed: true }
			}
			logger.info('No check runs found yet, waiting...')
			await sleep(pollInterval)
			continue
		}

		const allComplete = runs.every(r => r.status === 'completed')
		if (!allComplete) {
			logger.info(`Checks still running (${runs.filter(r => r.status === 'completed').length}/${runs.length} complete)`)
			await sleep(pollInterval)
			continue
		}

		const failed = runs.filter(r => r.conclusion !== 'success')
		if (failed.length === 0) {
			logger.info('All checks passed')
			return { passed: true }
		}

		const error = await collectErrors(sha, failed)
		return { passed: false, error }
	}

	return { passed: false, error: 'Timed out waiting for CI checks (20 min)' }
}

async function collectErrors(
	sha: string,
	failedRuns: Array<{ id: number, name: string, conclusion: string | null, output: { title: string | null, summary: string | null, text: string | null } }>
): Promise<string> {
	const errors: string[] = []

	for (const run of failedRuns) {
		let detail = `Check "${run.name}" — ${run.conclusion}`
		if (run.output.summary) detail += `\n  ${run.output.summary}`
		if (run.output.text) detail += `\n  ${run.output.text.slice(0, config.errors.maxCheckOutputChars)}`

		try {
			const { data: annotations } = await octokit.checks.listAnnotations({
				owner, repo, check_run_id: run.id,
			})
			for (const ann of annotations) {
				if (/Process completed with exit code/.test(ann.message ?? '')) continue
				detail += `\n  ${ann.path}:${ann.start_line} [${ann.annotation_level}] ${ann.message}`
			}
		} catch { /* annotations unavailable */ }

		errors.push(detail)
	}

	try {
		const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({
			owner, repo, head_sha: sha, status: 'completed',
		})
		for (const run of runs.workflow_runs.filter(r => r.conclusion === 'failure')) {
			const { data: jobs } = await octokit.actions.listJobsForWorkflowRun({
				owner, repo, run_id: run.id,
			})
			for (const job of jobs.jobs.filter(j => j.conclusion === 'failure')) {
				const failedStepNames = job.steps?.filter(s => s.conclusion === 'failure').map(s => s.name) ?? []

				try {
					const { data: logData } = await octokit.actions.downloadJobLogsForWorkflowRun({
						owner, repo, job_id: job.id,
					})
					const logText = typeof logData === 'string' ? logData : String(logData)
					const extracted = extractFailedStepOutput(logText, failedStepNames)
					errors.push(`Workflow job "${job.name}":\n${extracted}`)
				} catch {
					errors.push(`Workflow job "${job.name}" failed at steps: ${failedStepNames.join(', ')}`)
				}
			}
		}
	} catch { /* workflow logs unavailable */ }

	return errors.join('\n\n')
}

export async function mergePR(prNumber: number): Promise<void> {
	logger.info(`Merging PR #${prNumber}`)
	await octokit.pulls.merge({
		owner, repo,
		pull_number: prNumber,
		merge_method: 'squash', // Squash keeps main history clean — each iteration = one commit
	})
	logger.info(`PR #${prNumber} merged`)
}

export async function closePR(prNumber: number): Promise<void> {
	await octokit.pulls.update({
		owner, repo,
		pull_number: prNumber,
		state: 'closed',
	})
	logger.info(`PR #${prNumber} closed`)
}

export async function deleteRemoteBranch(branch: string): Promise<void> {
	await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` })
	logger.info(`Deleted remote branch: ${branch}`)
}

// Only finds PRs created by this agent (prefixed with seedgpt/) to avoid
// accidentally closing human-created PRs during stale cleanup.
export async function findOpenAgentPRs(): Promise<Array<{ number: number, head: { ref: string, sha: string } }>> {
	const { data } = await octokit.pulls.list({
		owner, repo,
		state: 'open',
		base: 'main',
	})
	return data
		.filter(pr => pr.head.ref.startsWith('seedgpt/'))
		.map(pr => ({ number: pr.number, head: { ref: pr.head.ref, sha: pr.head.sha } }))
}

export async function awaitChecks(): Promise<CheckResult> {
	const sha = await getHeadSha()
	return awaitPRChecks(sha)
}

export async function cleanupStalePRs(): Promise<void> {
	const prs = await findOpenAgentPRs()
	for (const pr of prs) {
		logger.warn(`Closing stale agent PR #${pr.number} (${pr.head.ref})`)
		await closePR(pr.number)
		await deleteRemoteBranch(pr.head.ref).catch(() => {})
	}
}

// This function can be used to fetch the latest main branch coverage. It does not run a new CI workflow, but looks for the most recent successful workflow run on main and extracts coverage from its logs.
export async function getLatestMainCoverage(): Promise<string | null> {
	try {
		const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({
			owner, repo, branch: 'main', status: 'completed', per_page: 1,
		})

		const latestSuccess = runs.workflow_runs.find(r => r.conclusion === 'success')
		if (!latestSuccess) return null

		const { data: jobs } = await octokit.actions.listJobsForWorkflowRun({
			owner, repo, run_id: latestSuccess.id,
		})

		for (const job of jobs.jobs) {
			try {
				const { data: logData } = await octokit.actions.downloadJobLogsForWorkflowRun({
					owner, repo, job_id: job.id,
				})
				const logText = typeof logData === 'string' ? logData : String(logData)
				const coverage = extractCoverageFromLogs(logText)
				if (coverage) return coverage
			} catch { /* logs unavailable for this job */ }
		}
	} catch {
		logger.warn('Failed to fetch latest main branch coverage')
	}
	return null
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
