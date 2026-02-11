import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger, { writeIterationLog, getLogBuffer } from './logger.js'
import type { LogEntry } from './logger.js'
import { trackUsage } from './usage.js'
import { PLANNER_TOOLS, BUILDER_TOOLS, handleTool, getEditOperation } from './tools/definitions.js'
import { getCodebaseContext } from './tools/codebase.js'
import type { EditOperation, ToolResult } from './tools/definitions.js'
import { SYSTEM_PLAN, SYSTEM_BUILD, SYSTEM_REFLECT } from './prompts.js'

export type { EditOperation } from './tools/definitions.js'

type CacheControl = { type: 'ephemeral' }
type CachedSystemBlock = { type: 'text'; text: string; cache_control: CacheControl }

const client = new Anthropic({ apiKey: config.anthropicApiKey })

// Anthropic's prompt caching: marks system prompts as cacheable so multi-turn conversations
// reuse the cached system prompt instead of re-processing it each turn, reducing input token costs.
function cachedSystem(text: string): CachedSystemBlock[] {
	return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

function compressToolResult(toolName: string, toolInput: Record<string, unknown>, resultContent: string): string {
	const lines = resultContent.split('\n').length
	switch (toolName) {
	case 'read_file': {
		const path = toolInput.filePath as string
		return `[Previously read ${path} (${lines} lines)]`
	}
	case 'grep_search': {
		const query = toolInput.query as string
		const matchCount = resultContent === 'No matches found.' ? 0 : lines
		return `[Searched "${query.slice(0, 60)}": ${matchCount} match${matchCount !== 1 ? 'es' : ''}]`
	}
	case 'file_search':
		return `[File search "${(toolInput.query as string)?.slice(0, 60)}": ${resultContent === 'No files matched.' ? 0 : lines} result${lines !== 1 ? 's' : ''}]`
	case 'list_directory':
		return `[Listed ${toolInput.path}: ${lines} entr${lines !== 1 ? 'ies' : 'y'}]`
	case 'git_diff':
		return `[Diff viewed: ${lines} lines]`
	case 'codebase_context':
	case 'codebase_diff':
		return `[Codebase context viewed]`
	case 'note_to_self':
	case 'dismiss_note':
	case 'recall_memory':
		return resultContent
	default:
		return resultContent
	}
}

// Compresses messages in the middle of the conversation to stay within context limits.
// keepFirst=1 preserves the initial context message (memory + codebase), keepLast=4 preserves
// recent turns for continuity. Everything in between gets tool results replaced with compact
// summaries and long text blocks truncated. Mutates the array in-place.
function compressOldMessages(messages: Anthropic.MessageParam[], keepFirst: number = 1, keepLast: number = 4): void {
	if (messages.length <= keepFirst + keepLast) return
	const compressEnd = messages.length - keepLast

	const toolNameMap = new Map<string, { name: string; input: Record<string, unknown> }>()
	for (let i = keepFirst; i < compressEnd; i++) {
		const msg = messages[i]
		if (msg.role === 'assistant' && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === 'tool_use') {
					toolNameMap.set(block.id, { name: block.name, input: block.input as Record<string, unknown> })
				}
			}

			let changed = false
			const content = msg.content.map(block => {
				if (block.type === 'text' && 'text' in block) {
					const textBlock = block as Anthropic.TextBlockParam
					if (textBlock.text.length > 2000) {
						changed = true
						return { ...block, text: textBlock.text.slice(0, 2000) + '...' }
					}
				}
				return block
			})
			if (changed) messages[i] = { ...msg, content }
		}

		if (msg.role === 'user' && Array.isArray(msg.content)) {
			let changed = false
			const content = (msg.content as Anthropic.ContentBlockParam[]).map(block => {
				if (block.type === 'tool_result') {
					const text = typeof block.content === 'string' ? block.content : ''
					if (text.length > 200) {
						const tool = toolNameMap.get(block.tool_use_id)
						if (tool) {
							changed = true
							return { ...block, content: compressToolResult(tool.name, tool.input, text) }
						}
						changed = true
						return { ...block, content: text.slice(0, 100) + '\n[...compressed]' }
					}
				}
				return block
			})
			if (changed) messages[i] = { ...msg, content }
		}
	}
}

// Retry wrapper with exponential backoff only for rate limits (429). Other errors propagate
// immediately since they indicate request-level problems that retrying won't fix.
// Backoff starts at 30s and caps at 2 minutes to avoid excessively long waits.
async function callApi(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
	const maxRetries = 5
	for (let attempt = 0; ; attempt++) {
		try {
			return await client.messages.create(params)
		} catch (error: unknown) {
			const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 0
			if (status === 429 && attempt < maxRetries) {
				const delay = Math.min(120_000, 30_000 * 2 ** attempt)
				logger.warn(`Rate limited, waiting ${Math.round(delay / 1000)}s before retry (attempt ${attempt + 1}/${maxRetries})...`)
				await new Promise(r => setTimeout(r, delay))
				continue
			}
			throw error
		}
	}
}

export interface Plan {
	title: string
	description: string
	implementation: string
	plannerReasoning?: string
}

// Produces a human-readable transcript of a conversation for reflection/logging.
// Clones messages first, then applies maximum compression (keepLast=0) since this
// is for storage and review, not for continuing the conversation.
export function summarizeMessages(messages: Anthropic.MessageParam[]): string {
	const compressed = messages.map(m => {
		if (typeof m.content === 'string') return { ...m }
		if (Array.isArray(m.content)) return { ...m, content: [...m.content] }
		return { ...m }
	})
	compressOldMessages(compressed, 1, 0)

	return compressed.map(m => {
		const role = m.role === 'assistant' ? 'ASSISTANT' : 'USER'
		if (typeof m.content === 'string') return `[${role}] ${m.content}`
		if (!Array.isArray(m.content)) return `[${role}] (empty)`
		const parts = m.content.map(block => {
			if (block.type === 'text') return ('text' in block) ? (block as Anthropic.TextBlockParam).text : ''
			if (block.type === 'tool_use') return `[tool: ${block.name}]`
			if (block.type === 'tool_result') {
				const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
				return `[result${block.is_error ? ' ERROR' : ''}] ${content ?? '(empty)'}`
			}
			return ''
		}).filter(Boolean)
		return `[${role}] ${parts.join('\n')}`
	}).join('\n\n')
}

export async function reflect(outcome: string, plannerMessages: Anthropic.MessageParam[], builderMessages: Anthropic.MessageParam[]): Promise<string> {
	logger.info('Self-reflecting on iteration...')

	const logs = getLogBuffer()
		.filter(e => e.level !== 'debug')
		.map(e => `${e.timestamp.slice(11, 19)} [${e.level.toUpperCase()}] ${e.message}`)
		.join('\n')

	const transcript = [
		'## Iteration Log',
		logs,
		'## Planner Conversation',
		summarizeMessages(plannerMessages),
		'## Builder Conversation',
		summarizeMessages(builderMessages),
		'## Outcome',
		outcome,
	].join('\n\n')

	const response = await callApi({
		model: config.reflectModel,
		max_tokens: 512,
		system: cachedSystem(SYSTEM_REFLECT),
		messages: [{
			role: 'user',
			content: transcript,
		}],
	})
	trackUsage('reflect', config.reflectModel, response.usage)
	logger.info(`Reflect usage: ${response.usage.input_tokens} in + ${response.usage.output_tokens} out tokens`)

	const text = response.content.find(c => c.type === 'text')?.text ?? ''
	logger.info(`Reflection: ${text.slice(0, 200)}`)
	return text.trim()
}

export interface PlanResult {
	plan: Plan
	messages: Anthropic.MessageParam[]
}

export async function plan(recentMemory: string, codebaseContext: string, gitLog: string): Promise<PlanResult> {
	logger.info('Asking LLM for a plan...')

	const tools = PLANNER_TOOLS
	const messages: Anthropic.MessageParam[] = [{
		role: 'user',
		content: `${recentMemory}\n\n${codebaseContext}\n\n## Recent Git History\n${gitLog}\n\nReview your notes and recent memories, then submit your plan.`,
	}]

	const system = cachedSystem(SYSTEM_PLAN)
	const maxRounds = config.maxPlannerRounds
	for (let round = 0; round < maxRounds; round++) {
		logger.info(`Planner turn ${round + 1}/${maxRounds}`)
		compressOldMessages(messages, 1, 4)
		const response = await callApi({
			model: config.planModel,
			max_tokens: 4096,
			system,
			messages,
			tools,
		})
		trackUsage('planner', config.planModel, response.usage)
		logger.info(`Planner turn ${round + 1} usage: ${response.usage.input_tokens} in + ${response.usage.output_tokens} out tokens`)

		const toolBlocks = response.content.filter(c => c.type === 'tool_use')
		if (toolBlocks.length === 0) {
			throw new Error('LLM did not return a tool_use block during planning')
		}

		const submitBlock = toolBlocks.find(b => b.type === 'tool_use' && b.name === 'submit_plan')
		if (submitBlock && submitBlock.type === 'tool_use') {
			const input = submitBlock.input as Plan

			// Collect all the planner's text outputs across turns as "reasoning". This is NOT sent
			// to the builder — it's stored for logging and reflection so we can audit what the
			// planner was thinking when it made its decision.
			const reasoning = messages
				.filter(m => m.role === 'assistant')
				.flatMap(m => {
					const content = m.content
					if (typeof content === 'string') return [content]
					if (Array.isArray(content)) return content.filter(c => c.type === 'text').map(c => (c as Anthropic.TextBlock).text)
					return []
				})
				.filter(t => t.trim().length > 0)
			const currentReasoning = response.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
			if (currentReasoning.trim()) reasoning.push(currentReasoning)
			if (reasoning.length > 0) {
				input.plannerReasoning = reasoning.join('\n\n---\n\n')
			}

			logger.info(`Plan: "${input.title}" — reasoning: ${(input.plannerReasoning?.length ?? 0)} chars`)
			messages.push({ role: 'assistant', content: response.content })
			return { plan: input, messages }
		}

		const toolResults: ToolResult[] = []

		for (const toolBlock of toolBlocks) {
			if (toolBlock.type !== 'tool_use') continue
			logger.info(`Planner calling ${toolBlock.name}${toolLogSuffix(toolBlock)}`)

			const result = await handleTool(toolBlock.name, toolBlock.input as Record<string, unknown>, toolBlock.id)
			toolResults.push(result)
		}

		// Inject a turn budget reminder into the last tool result so the planner is aware
		// of its remaining rounds. Without this, the planner may spend all turns exploring
		// without ever committing to a plan.
		toolResults[toolResults.length - 1].content += `\n\n(Turn ${round + 1} of ${maxRounds} — hard limit. Call submit_plan when ready.)`

		messages.push({ role: 'assistant', content: response.content })
		messages.push({ role: 'user', content: toolResults })
	}

	throw new Error(`Planner exceeded maximum rounds (${maxRounds}) without submitting a plan`)
}

function toolLogSuffix(block: { name: string; input: unknown }): string {
	const input = block.input as Record<string, unknown>
	if (block.name === 'read_file') {
		const path = input.filePath as string
		const start = input.startLine as number | undefined
		const end = input.endLine as number | undefined
		if (start && end) return `: ${path} L${start}-${end}`
		if (start) return `: ${path} L${start}+`
		return `: ${path}`
	}
	if (block.name === 'edit_file') {
		const lines = (input.oldString as string)?.split('\n').length ?? 0
		return `: ${input.filePath} (replacing ${lines} line${lines !== 1 ? 's' : ''})`
	}
	if (block.name === 'create_file') {
		const lines = (input.content as string)?.split('\n').length ?? 0
		return `: ${input.filePath} (${lines} line${lines !== 1 ? 's' : ''})`
	}
	if (block.name === 'delete_file') {
		return `: ${input.filePath}`
	}
	if (block.name === 'grep_search') {
		const suffix = input.includePattern ? ` in ${input.includePattern}` : ''
		return `: "${(input.query as string)?.slice(0, 60)}"${suffix}`
	}
	if (block.name === 'file_search') {
		return `: "${(input.query as string)?.slice(0, 60)}"`
	}
	if (block.name === 'list_directory') {
		return `: ${input.path}`
	}
	if (block.name === 'done') {
		return `: ${(input.summary as string)?.slice(0, 100)}`
	}
	return ''
}

export class PatchSession {
	private messages: Anthropic.MessageParam[] = []
	private readonly fullHistory: Anthropic.MessageParam[] = []
	private readonly edits: EditOperation[] = []
	private readonly system: CachedSystemBlock[]
	private readonly plan: Plan
	private roundsUsed = 0

	get conversation(): Anthropic.MessageParam[] {
		return this.fullHistory
	}

	get exhausted(): boolean {
		return this.roundsUsed >= config.maxBuilderRounds
	}

	constructor(plan: Plan, memoryContext: string) {
		this.plan = plan
		this.system = cachedSystem(SYSTEM_BUILD)

		const initial: Anthropic.MessageParam = {
			role: 'user',
			content: [{
				type: 'text' as const,
				text: [
					`--- YOUR MEMORY ---\n${memoryContext}`,
					`--- PLAN ---\n**${plan.title}**\n${plan.description}`,
					`--- IMPLEMENTATION INSTRUCTIONS ---\n${plan.implementation}`,
					`--- BEGIN ---\nStart by reading the files you need based on the implementation instructions and the codebase index in your system prompt. Use read_file to load files or specific line ranges, then use edit_file, create_file, and delete_file to make changes. Batch independent read_file calls together. Call done when the implementation is complete.`,
				].join('\n\n'),
				cache_control: { type: 'ephemeral' },
			}],
		}
		this.messages.push(initial)
		this.fullHistory.push(initial)
	}

	async createPatch(): Promise<EditOperation[]> {
		logger.info('Builder starting implementation...')
		return this.runBuilderLoop()
	}

	async fixPatch(error: string): Promise<EditOperation[]> {
		logger.info('Builder fixing implementation...')

		const fixMessage: Anthropic.MessageParam = {
			role: 'user',
			content: `You were implementing "${this.plan.title}": ${this.plan.description}\n\nThe changes were applied but CI failed. You have a limited turn budget to diagnose and fix the issue.\n\n## Error\n\`\`\`\n${error}\n\`\`\`\n\nRead the files mentioned in the error to understand the problem, make the targeted fixes, then call done. Do not redo work that already succeeded.`,
		}
		// Reset the working messages to just the fix prompt — old conversation context would
		// confuse the builder about file state since edits have already been applied.
		// fullHistory is kept intact for logging/reflection purposes.
		this.messages = [fixMessage]
		this.fullHistory.push(fixMessage)

		this.edits.length = 0
		return this.runBuilderLoop()
	}

	private pushMessage(msg: Anthropic.MessageParam): void {
		this.messages.push(msg)
		this.fullHistory.push(msg)
	}

	private async runBuilderLoop(): Promise<EditOperation[]> {
		const maxRounds = config.maxBuilderRounds
		while (this.roundsUsed < maxRounds) {
			this.roundsUsed++
			logger.info(`Builder turn ${this.roundsUsed}/${maxRounds}`)
			compressOldMessages(this.messages, 1, 4)
			// Re-fetch codebase context every turn because the builder is actively modifying files.
			// Stale context would show old declarations/tree and cause the builder to make
			// edits against outdated file contents.
			const codebaseContext = await getCodebaseContext(config.workspacePath)

			const response = await callApi({
				model: config.patchModel,
				max_tokens: 16384,
				system: [
					...this.system,
					{ type: 'text' as const, text: `\n\n${codebaseContext}` },
				],
				tools: BUILDER_TOOLS,
				messages: this.messages,
			})
			trackUsage('builder', config.patchModel, response.usage)
			logger.info(`Builder turn ${this.roundsUsed} usage: ${response.usage.input_tokens} in + ${response.usage.output_tokens} out tokens`)

			this.pushMessage({ role: 'assistant', content: response.content })

			const toolBlocks = response.content.filter(c => c.type === 'tool_use')
			// If the model returns no tool calls but has already made edits, treat it as
			// implicitly done — the model sometimes "forgets" to call the done tool after
			// finishing. If no edits exist either, it's a genuine failure.
			if (toolBlocks.length === 0) {
				if (this.edits.length > 0) {
					logger.info(`Builder stopped responding after ${this.edits.length} edit(s) — treating as done`)
					return this.edits
				}
				throw new Error('Builder did not call any tools')
			}

			const toolResults: ToolResult[] = []

			for (const block of toolBlocks) {
				if (block.type !== 'tool_use') continue
				logger.info(`Builder calling ${block.name}${toolLogSuffix(block)}`)

				const result = await this.handleBuilderTool(block)
				toolResults.push(result)

				if (block.name === 'done') {
					this.pushMessage({ role: 'user', content: toolResults })
					logger.info(`Builder done: ${this.edits.length} edit(s) applied`)
					return this.edits
				}
			}

			toolResults[toolResults.length - 1].content += `\n\n(Turn ${this.roundsUsed} of ${maxRounds} — hard limit. Call done when ready.)`

			this.pushMessage({ role: 'user', content: toolResults })
		}

		if (this.edits.length > 0) {
			logger.warn(`Builder hit turn limit with ${this.edits.length} edit(s) — returning what we have`)
			return this.edits
		}
		throw new Error(`Builder exceeded maximum rounds (${maxRounds}) without completing`)
	}

	private async handleBuilderTool(block: Anthropic.ContentBlock & { type: 'tool_use' }): Promise<ToolResult> {
		const result = await handleTool(block.name, block.input as Record<string, unknown>, block.id)
		if (!result.is_error) {
			const op = getEditOperation(block.name, block.input as Record<string, unknown>)
			if (op) this.edits.push(op)
		}
		return result
	}
}
