import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import logger from '../logger.js'
import { handleTool, getEditOperation } from '../tools/definitions.js'
import type { EditOperation, ToolResult } from '../tools/definitions.js'
import { callApi } from '../llm/api.js'
import { toolLogSuffix } from '../logger.js'

interface FixContext {
	planTitle: string
	planDescription: string
	implementation: string
	createdFiles: string[]
	modifiedFiles: string[]
}

export class FixSession {
	private readonly messages: Anthropic.MessageParam[] = []
	private readonly edits: EditOperation[] = []
	private readonly context: FixContext
	private roundsUsed = 0
	private fixAttempts = 0

	get exhausted(): boolean {
		return this.roundsUsed >= config.turns.maxFixer
	}

	get conversation(): Anthropic.MessageParam[] {
		return this.messages
	}

	constructor(context: FixContext) {
		this.context = context
	}

	async fix(error: string): Promise<EditOperation[]> {
		this.fixAttempts++
		const attempt = this.fixAttempts
		logger.info(`Fixer starting attempt ${attempt}...`)

		const sections = [
			`You were implementing "${this.context.planTitle}": ${this.context.planDescription}`,
			`## Implementation Instructions\n${this.context.implementation}`,
			'The changes were applied but CI failed. Diagnose and fix the issue.',
		]

		if (this.context.createdFiles.length > 0) {
			sections.push(`Files CREATED by the builder (entirely new):\n${this.context.createdFiles.map(f => `- ${f}`).join('\n')}`)
		}
		if (this.context.modifiedFiles.length > 0) {
			sections.push(`Files MODIFIED by the builder (edited existing):\n${this.context.modifiedFiles.map(f => `- ${f}`).join('\n')}`)
		}

		sections.push(`## Error (attempt ${attempt})\n\`\`\`\n${error}\n\`\`\``)

		if (attempt > 1) {
			sections.push(`This is fix attempt ${attempt}. Your previous changes were applied and CI was re-run, but it still failed. Analyze the error and make a new fix.`)
		}

		sections.push('Check your working context first — files already loaded are shown there with up-to-date content. Only call read_file for files or line ranges not already visible. Read the files implicated in the error, make the targeted fix, then call done.')

		const fixMessage: Anthropic.MessageParam = {
			role: 'user',
			content: sections.join('\n\n'),
		}
		this.messages.push(fixMessage)

		this.edits.length = 0
		return this.runFixerLoop()
	}

	private pushMessage(msg: Anthropic.MessageParam): void {
		this.messages.push(msg)
	}

	private async runFixerLoop(): Promise<EditOperation[]> {
		const maxRounds = config.turns.maxFixer
		while (this.roundsUsed < maxRounds) {
			this.roundsUsed++
			logger.info(`Fixer turn ${this.roundsUsed}/${maxRounds}`)

			const response = await callApi('fixer', this.messages)
			logger.info(`Fixer turn ${this.roundsUsed} usage: ${response.usage.input_tokens} in + ${response.usage.output_tokens} out tokens`)

			this.pushMessage({ role: 'assistant', content: response.content })

			const toolBlocks = response.content.filter(c => c.type === 'tool_use')
			if (toolBlocks.length === 0) {
				if (this.edits.length > 0) {
					logger.info(`Fixer stopped responding after ${this.edits.length} edit(s) — treating as done`)
					return this.edits
				}
				throw new Error('Fixer did not call any tools')
			}

			const toolResults: ToolResult[] = []

			for (const block of toolBlocks) {
				if (block.type !== 'tool_use') continue
				logger.info(`Fixer calling ${block.name}${toolLogSuffix(block)}`)

				const result = await handleTool(block.name, block.input as Record<string, unknown>, block.id)
				if (!result.is_error) {
					const op = getEditOperation(block.name, block.input as Record<string, unknown>)
					if (op) this.edits.push(op)
				}
				toolResults.push(result)

				if (block.name === 'done') {
					this.pushMessage({ role: 'user', content: toolResults })
					logger.info(`Fixer done: ${this.edits.length} edit(s) applied`)
					return this.edits
				}
			}

			toolResults[toolResults.length - 1].content += `\n\n(Turn ${this.roundsUsed} of ${maxRounds} — hard limit. Call done when ready.)`

			this.pushMessage({ role: 'user', content: toolResults })
		}

		if (this.edits.length > 0) {
			logger.warn(`Fixer hit turn limit with ${this.edits.length} edit(s) — returning what we have`)
			return this.edits
		}
		throw new Error(`Fixer exceeded maximum rounds (${maxRounds}) without completing`)
	}
}
