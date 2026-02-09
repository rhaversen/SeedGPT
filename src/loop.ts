import * as git from './tools/git.js'
import * as github from './tools/github.js'
import * as codebase from './tools/codebase.js'
import * as llm from './llm.js'
import * as pipeline from './pipeline.js'
import * as memory from './memory.js'
import { connectToDatabase, disconnectFromDatabase } from './database.js'
import { config } from './config.js'
import logger from './logger.js'

export async function run(): Promise<void> {
	logger.info('SeedGPT starting iteration...')

	await connectToDatabase()

	try {
		await pipeline.cleanupStalePRs()

		const gitClient = await git.cloneRepo()

		let merged = false

		while (!merged) {
			const recentMemory = await memory.getContext()
			const codebaseContext = await codebase.getCodebaseContext(config.workspacePath)
			const gitLog = await git.getRecentLog(gitClient)

			const { plan, messages: plannerMessages } = await llm.plan(recentMemory, codebaseContext, gitLog)
			await memory.store(`Planned change "${plan.title}": ${plan.description}`)

			const fileContents = await codebase.readFiles(config.workspacePath, plan.filesToRead)
			const session = new llm.PatchSession(plan, fileContents, recentMemory)
			let edits = await session.createPatch()

			const branchName = await git.createBranch(gitClient, plan.title)
			let prNumber: number | null = null
			let lastError: string | null = null

			for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
				if (attempt > 0) {
					logger.warn(`Attempt ${attempt + 1}/${config.maxRetries + 1}: ${lastError?.slice(0, 200)}`)
					await memory.store(`Attempt ${attempt} failed for "${plan.title}"${prNumber ? ` (PR #${prNumber})` : ''}: ${lastError?.slice(0, 500)}`)

					const touchedFiles = edits
						.filter(e => e.type !== 'delete')
						.map(e => e.filePath)
					const allFiles = [...new Set([...plan.filesToRead, ...touchedFiles])]
					const currentFiles = await codebase.readFiles(config.workspacePath, allFiles)
					edits = await session.fixPatch(lastError!, currentFiles)
				}

				if (edits.length === 0) {
					lastError = 'No edit operations were returned. The patch must contain at least one change.'
					continue
				}

				if (prNumber === null) {
					await git.commitAndPush(gitClient, plan.title)
					prNumber = await github.openPR(branchName, plan.title, plan.description)
				} else {
					await git.commitAndPush(gitClient, `fix: ${plan.title} (attempt ${attempt + 1})`)
				}

				const result = await pipeline.awaitChecks(gitClient)
				if (result.passed) {
					await github.mergePR(prNumber)
					await github.deleteRemoteBranch(branchName).catch(() => {})
					await memory.store(`Merged PR #${prNumber}: "${plan.title}" — CI passed and change is now on main.`)
					logger.info(`PR #${prNumber} merged.`)

					const reflection = await llm.reflect(
						`PR #${prNumber} merged successfully after ${attempt + 1} attempt(s).`,
						plannerMessages,
						session.conversation,
					)
					await memory.store(`Self-reflection: ${reflection}`)
					merged = true
					break
				}

				lastError = result.error ?? 'CI checks failed with unknown error'
			}

			await gitClient.checkout(['.'])
			await gitClient.clean('f', ['-d'])
			await gitClient.checkout('main')
			await gitClient.pull()

			if (prNumber !== null) {
				await github.closePR(prNumber)
				await github.deleteRemoteBranch(branchName).catch(() => {})
				await memory.store(`Closed PR #${prNumber}: "${plan.title}" — failed after ${config.maxRetries + 1} attempts. Last error: ${lastError?.slice(0, 500)}`)
			} else {
				await memory.store(`Gave up on "${plan.title}" — could not produce a valid patch after ${config.maxRetries + 1} attempts. Last error: ${lastError?.slice(0, 500)}`)
			}

			const reflection = await llm.reflect(
				`Failed after ${config.maxRetries + 1} attempts. Last error: ${lastError?.slice(0, 500)}`,
				plannerMessages,
				session.conversation,
			)
			await memory.store(`Self-reflection: ${reflection}`)
			logger.error(`Failed after ${config.maxRetries + 1} attempts — starting fresh plan.`)
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		try {
			await memory.store(`Iteration crashed with error: ${message}`)
		} catch { /* DB may be down */ }
		throw error
	} finally {
		await disconnectFromDatabase()
	}
}
