import { Octokit } from '@octokit/rest'
import { config } from '../config.js'
import logger from '../logger.js'

const octokit = new Octokit({ auth: config.githubToken })
const owner = config.githubOwner
const repo = config.githubRepo

export interface CheckResult {
	passed: boolean
	error?: string
}

interface CoverageMetric {
	total: number
	covered: number
	skipped: number
	pct: number
}

interface FileCoverage {
	statements: CoverageMetric
	branches: CoverageMetric
	functions: CoverageMetric
	lines: CoverageMetric
}

interface CoverageSummaryJson {
	total: FileCoverage
	[filePath: string]: FileCoverage
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
	const POLL_INTERVAL = 30_000    // Balance between API rate limits and responsiveness
	const TIMEOUT = 20 * 60_000     // Generous timeout for CI with compilation + tests + deploy
	const NO_CHECKS_TIMEOUT = 2 * 60_000 // If no checks appear after 2 min, repo likely has no CI
	const start = Date.now()

	while (Date.now() - start < TIMEOUT) {
		const { data } = await octokit.checks.listForRef({ owner, repo, ref: sha })
		const runs = data.check_runs

		if (runs.length === 0) {
			if (Date.now() - start > NO_CHECKS_TIMEOUT) {
				logger.warn('No CI checks registered after 2 minutes — treating as passed')
				return { passed: true }
			}
			logger.info('No check runs found yet, waiting...')
			await sleep(POLL_INTERVAL)
			continue
		}

		const allComplete = runs.every(r => r.status === 'completed')
		if (!allComplete) {
			logger.info(`Checks still running (${runs.filter(r => r.status === 'completed').length}/${runs.length} complete)`)
			await sleep(POLL_INTERVAL)
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

function stripLogLine(line: string): string {
	return line
		.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '')
		.replace(/\x1b\[[0-9;]*m/g, '')
}

function isNoise(line: string): boolean {
	return /^\s*(console\.(log|warn|error))$/.test(line) ||
		/^\s+at\s+\S+\s+\(/.test(line) ||
		/^\s*\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+\[(INFO|DEBUG)]/.test(line) ||
		/^\s*● Console$/.test(line)
}

function prioritizeFailures(lines: string[]): string {
	const failBlocks: string[] = []
	const summaryLines: string[] = []
	let inFail = false
	let inPass = false

	for (const line of lines) {
		if (/^\s*FAIL\s/.test(line)) {
			inFail = true
			inPass = false
			failBlocks.push(line)
		} else if (/^\s*PASS\s/.test(line)) {
			inFail = false
			inPass = true
		} else if (/^(Test Suites:|Tests:|Snapshots:|Time:|Ran all)/.test(line) || /^ERROR:/.test(line)) {
			inFail = false
			inPass = false
			summaryLines.push(line)
		} else if (inFail) {
			failBlocks.push(line)
		}
	}

	if (failBlocks.length > 0) {
		return [...failBlocks, '', ...summaryLines].join('\n').slice(-8000)
	}

	const errorLines = lines.filter(l =>
		/error\s*TS\d+/i.test(l) ||
		/SyntaxError|TypeError|ReferenceError|RangeError/.test(l) ||
		/Cannot find module|Module not found/.test(l) ||
		/ENOENT|EACCES/.test(l) ||
		(/^ERROR:/i.test(l) && !/Process completed with exit code/.test(l)),
	)

	if (errorLines.length > 0 || summaryLines.length > 0) {
		return [...errorLines, '', ...summaryLines].join('\n').slice(-8000)
	}

	const cleaned = lines.filter(l => l.trim() !== '' && !isNoise(l) && !/^\s*PASS\s/.test(l))
	return cleaned.join('\n').slice(-8000)
}

export function extractFailedStepOutput(logText: string, failedStepNames: string[]): string {
	const raw = logText.split('\n')
	const lines = raw.map(stripLogLine)

	const stepSections: { name: string; start: number; end: number }[] = []
	let current: { name: string; start: number } | null = null

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^##\[group](.+)/)
		if (match) {
			if (current) stepSections.push({ ...current, end: i })
			current = { name: match[1], start: i }
		}
	}
	if (current) stepSections.push({ ...current, end: lines.length })

	const matchesStep = (sectionName: string, stepName: string): boolean => {
		const a = sectionName.toLowerCase()
		const b = stepName.toLowerCase()
		return a.includes(b) || a === `run ${b}`
	}

	const failedSections = failedStepNames.length > 0
		? stepSections.filter(s => failedStepNames.some(name => matchesStep(s.name, name)))
		: stepSections.filter(s => lines.slice(s.start, s.end).some(l => l.startsWith('##[error]')))

	if (failedSections.length > 0) {
		const output = failedSections.map(section => {
			const content = lines.slice(section.start, section.end)
				.filter(l => !l.startsWith('##[group]') && !l.startsWith('##[endgroup]') && l.trim() !== '')
				.map(l => l.replace(/^##\[error]/, 'ERROR: '))
			return `Step "${section.name}":\n${prioritizeFailures(content)}`
		}).join('\n\n')
		return output.slice(-8000)
	}

	const cleanedLines = lines
		.filter(l => !l.startsWith('##[group]') && !l.startsWith('##[endgroup]') && l.trim() !== '')
		.map(l => l.replace(/^##\[error]/, 'ERROR: '))

	return prioritizeFailures(cleanedLines)
}

async function collectErrors(
	sha: string,
	failedRuns: Array<{ id: number, name: string, conclusion: string | null, output: { title: string | null, summary: string | null, text: string | null } }>
): Promise<string> {
	const errors: string[] = []

	for (const run of failedRuns) {
		let detail = `Check "${run.name}" — ${run.conclusion}`
		if (run.output.summary) detail += `\n  ${run.output.summary}`
		if (run.output.text) detail += `\n  ${run.output.text.slice(0, 2000)}`

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

export function extractCoverageFromLogs(logText: string): string | null {
	const raw = logText.split('\n')
	const lines = raw.map(stripLogLine)

	const stepSections: { name: string; start: number; end: number }[] = []
	let current: { name: string; start: number } | null = null

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(/^##\[group](.+)/)
		if (match) {
			if (current) stepSections.push({ ...current, end: i })
			current = { name: match[1], start: i }
		}
	}
	if (current) stepSections.push({ ...current, end: lines.length })

	const coverageSection = stepSections.find(s =>
		s.name === 'Coverage' || s.name === 'Run Coverage' || s.name.includes('Coverage')
	)
	if (!coverageSection) return null

	const sectionLines = lines.slice(coverageSection.start, coverageSection.end)
		.filter(l => !l.startsWith('##[') && l.trim() !== '')

	const jsonLine = sectionLines.find(l => l.trim().startsWith('{') && l.includes('"total"'))
	if (!jsonLine) return null

	try {
		const data = JSON.parse(jsonLine.trim()) as CoverageSummaryJson
		return formatCoverageSummary(data)
	} catch {
		return null
	}
}

function formatCoverageSummary(data: CoverageSummaryJson): string {
	const t = data.total
	const parts: string[] = [
		`Coverage: ${t.statements.pct}% statements, ${t.branches.pct}% branches, ${t.functions.pct}% functions, ${t.lines.pct}% lines`,
	]

	const fileEntries = Object.entries(data)
		.filter(([key]) => key !== 'total')
		.map(([filePath, cov]) => ({ filePath, pct: cov.statements.pct }))
		.sort((a, b) => a.pct - b.pct)

	const lowCoverage = fileEntries.filter(f => f.pct < 50)
	if (lowCoverage.length > 0) {
		const listed = lowCoverage.slice(0, 10).map(f => `${f.filePath} (${f.pct}%)`).join(', ')
		parts.push(`Low coverage (<50%): ${listed}`)
	}

	const zeroCoverage = fileEntries.filter(f => f.pct === 0)
	if (zeroCoverage.length > 0) {
		parts.push(`Untested files: ${zeroCoverage.length}`)
	}

	return parts.join('\n')
}

export async function extractCoverage(sha: string): Promise<string | null> {
	try {
		const { data: runs } = await octokit.actions.listWorkflowRunsForRepo({
			owner, repo, head_sha: sha, status: 'completed',
		})

		for (const run of runs.workflow_runs.filter(r => r.conclusion === 'success')) {
			const { data: jobs } = await octokit.actions.listJobsForWorkflowRun({
				owner, repo, run_id: run.id,
			})

			for (const job of jobs.jobs) {
				try {
					const { data: logData } = await octokit.actions.downloadJobLogsForWorkflowRun({
						owner, repo, job_id: job.id,
					})
					const logText = typeof logData === 'string' ? logData : String(logData)
					const coverage = extractCoverageFromLogs(logText)
					if (coverage) {
						logger.info('Extracted coverage data from CI logs')
						return coverage
					}
				} catch { /* logs unavailable for this job */ }
			}
		}
	} catch {
		logger.warn('Failed to fetch coverage data from CI')
	}
	return null
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}
