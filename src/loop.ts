import { randomUUID } from 'node:crypto'
import { cloneRepo, commitAndPush, createBranch, getRecentLog, resetWorkspace } from './tools/git.js'
import { closePR, deleteRemoteBranch, mergePR, openPR } from './tools/github.js'
import { awaitChecks, cleanupStalePRs, getCoverage } from './pipeline.js'
import { getContext, storePastMemory } from './agents/memory.js'
import { connectToDatabase, disconnectFromDatabase } from './database.js'
import logger, { writeIterationLog } from './logger.js'
import { plan } from './agents/plan.js'
import { PatchSession } from './agents/build.js'
import { reflect } from './agents/reflect.js'
import { setIterationId } from './llm/api.js'

export async function run(): Promise<void> {
	logger.info('SeedGPT starting iteration...')

	await connectToDatabase()

	try {
		await cleanupStalePRs()
		await cloneRepo()

		let merged = false
		while (!merged) {
			merged = await iterate()
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		try {
			await storePastMemory(`Iteration crashed with error: ${message}`)
		} catch { /* Swallowed because the crash itself may have been caused by a DB failure */ }
		throw error
	} finally {
		await disconnectFromDatabase()
	}
}

async function iterate(): Promise<boolean> {
	setIterationId(randomUUID())
	const recentMemory = await getContext()
	const gitLog = await getRecentLog()

	const { plan: iterationPlan, messages: plannerMessages } = await plan(recentMemory, gitLog)
	await storePastMemory(`Planned change "${iterationPlan.title}": ${iterationPlan.description}`)

	const session = new PatchSession(iterationPlan, recentMemory)
	const branchName = await createBranch(iterationPlan.title)

	let edits = await session.createPatch()
	let prNumber: number | null = null
	let merged = false
	let outcome: string

	if (edits.length === 0) {
		outcome = 'Builder produced no edits.'
	} else {
		await commitAndPush(iterationPlan.title)
		prNumber = await openPR(branchName, iterationPlan.title, iterationPlan.description)

		while (true) {
			const result = await awaitChecks()
			if (result.passed) {
				merged = true
				outcome = `PR #${prNumber} merged successfully.`
				break
			}

			const error = result.error ?? 'CI checks failed with unknown error'
			if (session.exhausted) {
				outcome = `CI failed: ${error.slice(0, 10000)}`
				break
			}

			logger.warn(`CI failed, attempting fix: ${error.slice(0, 200)}`)
			await storePastMemory(`CI failed for "${iterationPlan.title}" (PR #${prNumber}): ${error.slice(0, 10000)}`)

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

			await commitAndPush(`fix: ${iterationPlan.title}`)
		}
	}

	if (merged) {
		await mergePR(prNumber!)
		await deleteRemoteBranch(branchName).catch(() => {})
		await storePastMemory(`Merged PR #${prNumber}: "${iterationPlan.title}" — CI passed and change is now on main.`)
		logger.info(`PR #${prNumber} merged.`)

		const coverage = await getCoverage()
		if (coverage) {
			await storePastMemory(`Post-merge coverage report:\n${coverage}`)
			logger.info('Stored coverage report in memory')
		}
	}

	await resetWorkspace()

	if (!merged) {
		if (prNumber !== null) {
			await closePR(prNumber)
			await deleteRemoteBranch(branchName).catch(() => {})
			await storePastMemory(`Closed PR #${prNumber}: "${iterationPlan.title}" — ${outcome}`)
		} else {
			await storePastMemory(`Gave up on "${iterationPlan.title}" — ${outcome}`)
		}
		logger.error(`Plan "${iterationPlan.title}" failed — starting fresh plan.`)
	}

	const allMessages = [...plannerMessages, ...session.conversation]
	const reflection = await reflect(outcome, allMessages)
	await storePastMemory(`Self-reflection: ${reflection}`)
	await writeIterationLog()

	return merged
}
