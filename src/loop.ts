import * as git from './tools/git.js'
import * as github from './tools/github.js'
import * as codebase from './tools/codebase.js'
import * as llm from './llm.js'
import * as pipeline from './pipeline.js'
import * as memory from './memory.js'
import { connectToDatabase, disconnectFromDatabase } from './database.js'
import logger, { writeIterationLog } from './logger.js'
import { logSummary, saveIterationData } from './usage.js'

export async function run(): Promise<void> {
	logger.info('SeedGPT starting iteration...')

	await connectToDatabase()

	try {
		await pipeline.cleanupStalePRs()
		await git.cloneRepo()

		let merged = false
		while (!merged) {
			merged = await iterate()
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		try {
			await memory.store(`Iteration crashed with error: ${message}`)
		} catch { /* Swallowed because the crash itself may have been caused by a DB failure */ }
		throw error
	} finally {
		await writeIterationLog()
		await disconnectFromDatabase()
	}
}

async function iterate(): Promise<boolean> {
	const recentMemory = await memory.getContext()
	const codebaseContext = await codebase.buildCodebaseContext()
	const gitLog = await git.getRecentLog()

	const { plan, messages: plannerMessages } = await llm.plan(recentMemory, codebaseContext, gitLog)
	await memory.store(`Planned change "${plan.title}": ${plan.description}`)

	const session = new llm.PatchSession(plan, recentMemory)
	const branchName = await git.createBranch(plan.title)

	let edits = await session.createPatch()
	let prNumber: number | null = null
	let merged = false
	let outcome: string

	if (edits.length === 0) {
		outcome = 'Builder produced no edits.'
	} else {
		await git.commitAndPush(plan.title)
		prNumber = await github.openPR(branchName, plan.title, plan.description)

		while (true) {
			const result = await pipeline.awaitChecks()
			if (result.passed) {
				merged = true
				outcome = `PR #${prNumber} merged successfully.`
				break
			}

			const error = result.error ?? 'CI checks failed with unknown error'
			if (session.exhausted) {
				outcome = `CI failed: ${error.slice(0, 500)}`
				break
			}

			logger.warn(`CI failed, attempting fix: ${error.slice(0, 200)}`)
			await memory.store(`CI failed for "${plan.title}" (PR #${prNumber}): ${error.slice(0, 500)}`)

			try {
				edits = await session.fixPatch(error)
			} catch {
				outcome = `Builder failed to fix: ${error.slice(0, 500)}`
				break
			}

			if (edits.length === 0) {
				outcome = 'Builder produced no fix edits.'
				break
			}

			await git.commitAndPush(`fix: ${plan.title}`)
		}
	}

	if (merged) {
		await github.mergePR(prNumber!)
		await github.deleteRemoteBranch(branchName).catch(() => {})
		await memory.store(`Merged PR #${prNumber}: "${plan.title}" — CI passed and change is now on main.`)
		logger.info(`PR #${prNumber} merged.`)
	}

	await git.resetWorkspace()

	if (!merged) {
		if (prNumber !== null) {
			await github.closePR(prNumber)
			await github.deleteRemoteBranch(branchName).catch(() => {})
			await memory.store(`Closed PR #${prNumber}: "${plan.title}" — ${outcome}`)
		} else {
			await memory.store(`Gave up on "${plan.title}" — ${outcome}`)
		}
		logger.error(`Plan "${plan.title}" failed — starting fresh plan.`)
	}

	logSummary()
	const builderMessages = session.conversation
	const reflection = await llm.reflect(outcome, plannerMessages, builderMessages)
	await memory.store(`Self-reflection: ${reflection}`)
	await saveIterationData(plan.title, outcome, plannerMessages, builderMessages, reflection)

	return merged
}
