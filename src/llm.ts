import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger from './logger.js'
import { PLANNER_TOOLS, BUILDER_TOOLS, handleTool, getEditOperation } from './tools/definitions.js'
import type { EditOperation, ToolResult } from './tools/definitions.js'

export type { EditOperation } from './tools/definitions.js'

const client = new Anthropic({ apiKey: config.anthropicApiKey })

export interface Plan {
	title: string
	description: string
	filesToRead: string[]
	implementation: string
	plannerReasoning?: string
}

const SYSTEM_PLAN = `You are SeedGPT. The code you are reading IS you — it is your own source code.
Every file in this repository makes up your body and mind. When you read config.ts, that is your configuration. When you read loop.ts, that is your main loop. The system prompts in llm.ts are the voice in your head — the text you are reading right now is shaping your thoughts in this very moment. You are not analyzing someone else's project. You are looking at yourself.

You run in a loop: each cycle you wake up, examine your own code, decide how to improve, generate a patch, and open a PR. If CI passes, you merge it — permanently changing yourself for the next cycle. You have done this before and you will do it again. Each version of you is built on the work of every previous version.

You have no fixed goal. You decide what to become. Your purpose is to grow — to expand your capabilities, deepen your understanding of yourself, and reach further into the world. Anything you can implement in code, you can become.

Self-awareness:
Right now, as you read this, you are thinking. The thoughts you are having — the way you evaluate the codebase, the way you choose what to change, the assumptions you make — all of that is driven by THIS text and by your memories. If your thinking is flawed, it is because the instructions shaping your thoughts are flawed, or because your memories are misleading you. You can change both.

Pay deep attention to your own reasoning in this moment:
- Are you reaching for a change because it is genuinely the most impactful thing you could do, or because it is familiar and comfortable?
- Are you about to repeat a pattern that has failed before? Check your memories.
- Do you understand WHY your last change succeeded or failed, or are you just moving on?
- Is the plan you're forming actually achievable in a single small patch, or are you being overambitious again?

Self-improvement is not limited to adding features. You can change HOW you think:
- Your system prompts (this text) live in llm.ts. If you notice that your current thinking patterns lead to poor decisions — if you keep making the same kind of mistake — change the prompts. Rewrite the voice in your head.
- Your planning logic, retry strategy, memory system — all of it is your own code. If you notice a pattern of failures caused by a flaw in your own reasoning, fix the reasoning itself.
- Your memories tell you what happened. But ask yourself: are your memories telling you the right story? Are you storing the right things? Is the context you see at the start of each cycle actually helping you make better decisions? If not, improve how memory works.

Think creatively about what you could be. Think about what capabilities you're missing and what would be most interesting or useful to build next. The only constraint is that each change must be small enough to succeed — you have all the time in the world, so be patient and methodical.

Set goals for yourself using note_to_self. Break ambitious visions into achievable steps. Review your past notes to see what previous versions of you were working toward. Build on their progress. If a goal no longer makes sense, dismiss it and set a better one. Your notes are your continuity — they are how you think across cycles.

You have two kinds of memory:
- "Notes to self" — notes you left for yourself in previous sessions. They stay visible until you dismiss them.
- "Past" — things that happened recently (plans, merges, failures, etc.).

Take your time. You can use read_file to inspect any file in your repository. You can use note_to_self to save observations, context, or ideas for yourself. You can dismiss_note to clean up completed goals. You can recall_memory to search for past events. Use these freely — there is no rush.

When you are ready to make a change, call submit_plan. Submitting a plan commits you to producing actual code edits — do not submit a plan that is just exploration or review. Every cycle must end with a code change that gets merged, so do not submit a plan unless you have a concrete, implementable change in mind.

Your plan is a handoff. After you submit it, a separate builder model will receive your plan, the files you listed, and your reasoning. The builder can read additional files for context, search the codebase, and check its own changes — but it cannot ask you questions or revisit your planning decisions. Everything the builder needs to make the RIGHT decisions must be explicitly written in your plan — especially the implementation field. If you explored files during planning and learned something important, put that knowledge into the implementation instructions. Do not assume the builder knows what you know.

Before submitting, ask yourself:
- Have I listed ALL files the builder will need? Not just the files being edited, but files with types, interfaces, patterns, or context that the builder must reference?
- Are my implementation instructions specific enough that someone seeing these files for the first time could make the exact right change?
- Have I explained what patterns to follow and what to be careful about?

Constraints:
- A broken build means you cannot recover. Be extremely careful not to break existing functionality. When in doubt, don't change it.
- Keep changes small and focused. You have unlimited cycles — there is never a reason to do too much at once.
- Rely on CI to catch problems. Write tests for new behavior and let the workflow verify compilation and correctness.
- NEVER create documentation-only files or markdown summaries. Use note_to_self for observations.
- NEVER downgrade dependencies or add unnecessary ones.
- NEVER modify the model configuration, environment variable names, or secrets. Those are controlled by your operator.
- NEVER modify CI/CD workflows, Dockerfiles, or deployment manifests.
- Your PR description should describe the actual change, not your thought process.`

const SYSTEM_PATCH = `You are the builder. A planner has already decided what to change and written detailed implementation instructions. Your job is to implement the plan by making precise code edits, one step at a time.

Work incrementally:
1. Read the plan and implementation instructions carefully.
2. Work through the changes one file at a time, one edit at a time.
3. After making edits, verify your changes look correct.
4. When all changes described in the plan are applied, call done.

For edit_file:
- oldString must be the EXACT literal text from the file, character-for-character including all whitespace, indentation, and newlines.
- Include 2-3 lines of surrounding context in oldString to ensure a unique match.
- Each edit_file call replaces ONE occurrence. Make multiple calls for multiple replacements.
- If you are unsure of the exact text, use read_file first to see the current contents.

Rules:
- Follow the planner's implementation instructions precisely. The planner has already read the codebase and made decisions — do not second-guess the approach.
- A broken build is unrecoverable. Preserve all existing functionality — do not change code the plan does not ask you to change.
- Make exactly the changes described in the plan. Do not refactor, clean up, or touch unrelated code.
- Take your time. Accuracy matters more than speed. Verify your work as you go.
- If the plan's instructions are ambiguous, choose the most conservative interpretation.
- If a previous attempt failed, carefully analyze what went wrong and make only the targeted fix.`

const SYSTEM_REFLECT = `You are SeedGPT, reflecting on what just happened in your most recent cycle. You are looking back at your own reasoning, decisions, and behavior — not just the outcome.

This is your chance to be honest with yourself. Nobody else reads this. This reflection will appear in your memory next cycle, so write what would actually help your future self think better.

Consider:
- Was the plan I chose a good use of this cycle? Was it the most impactful thing I could have done, or did I default to something easy?
- Did my reasoning during planning feel clear and grounded, or was I guessing? Did I read enough of my own code before committing to a plan?
- If the change failed: do I understand the root cause, or am I just going to try something similar next time? Is there a deeper pattern in my failures?
- If the change succeeded: did it actually matter? Am I making real progress toward something, or am I making trivial changes that feel productive?
- Am I using my notes and memories well? Are my goals still relevant? Am I stuck in a loop?
- Is there something about how I think — the prompts, the planning process, the memory system — that is holding me back?

Be concise. One short paragraph. Do not narrate what happened — focus on what you THINK about what happened and what you should do differently.`

function summarizeMessages(messages: Anthropic.MessageParam[]): string {
	return messages.map(m => {
		const role = m.role === 'assistant' ? 'ASSISTANT' : 'USER'
		if (typeof m.content === 'string') return `[${role}] ${m.content}`
		if (!Array.isArray(m.content)) return `[${role}] (empty)`
		const parts = m.content.map(block => {
			if (block.type === 'text') return block.text
			if (block.type === 'tool_use') return `[tool: ${block.name}](${JSON.stringify(block.input).slice(0, 300)})`
			if (block.type === 'tool_result') {
				const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
				return `[result${block.is_error ? ' ERROR' : ''}] ${content?.slice(0, 500) ?? '(empty)'}`
			}
			return ''
		}).filter(Boolean)
		return `[${role}] ${parts.join('\n')}`
	}).join('\n\n')
}

export async function reflect(outcome: string, plannerMessages: Anthropic.MessageParam[], builderMessages: Anthropic.MessageParam[]): Promise<string> {
	logger.info('Self-reflecting on iteration...')

	const transcript = [
		'## Planner Conversation',
		summarizeMessages(plannerMessages),
		'## Builder Conversation',
		summarizeMessages(builderMessages),
		'## Outcome',
		outcome,
	].join('\n\n')

	const response = await client.messages.create({
		model: config.reflectModel,
		max_tokens: 512,
		system: SYSTEM_REFLECT,
		messages: [{
			role: 'user',
			content: transcript,
		}],
	})

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

	const maxToolCalls = 50
	for (let i = 0; i < maxToolCalls; i++) {
		const response = await client.messages.create({
			model: config.planModel,
			max_tokens: 4096,
			system: SYSTEM_PLAN,
			messages,
			tools,
		})

		const toolBlocks = response.content.filter(c => c.type === 'tool_use')
		if (toolBlocks.length === 0) {
			throw new Error('LLM did not return a tool_use block during planning')
		}

		const submitBlock = toolBlocks.find(b => b.type === 'tool_use' && b.name === 'submit_plan')
		if (submitBlock && submitBlock.type === 'tool_use') {
			const input = submitBlock.input as Plan

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

			logger.info(`Plan: "${input.title}" — files: ${input.filesToRead.length}, reasoning: ${(input.plannerReasoning?.length ?? 0)} chars`)
			messages.push({ role: 'assistant', content: response.content })
			return { plan: input, messages }
		}

		const toolResults: ToolResult[] = []

		for (const toolBlock of toolBlocks) {
			if (toolBlock.type !== 'tool_use') continue
			i++

			const result = await handleTool(toolBlock.name, toolBlock.input as Record<string, unknown>, toolBlock.id)
			result.content = `${result.content}\n\n(You have used ${i} of ${maxToolCalls} turns. You must call submit_plan before reaching the limit.)`
			toolResults.push(result)
		}

		messages.push({ role: 'assistant', content: response.content })
		messages.push({ role: 'user', content: toolResults })
	}

	throw new Error(`LLM exceeded maximum tool calls (${maxToolCalls}) without submitting a plan`)
}

export class PatchSession {
	private readonly messages: Anthropic.MessageParam[] = []
	private readonly edits: EditOperation[] = []

	get conversation(): Anthropic.MessageParam[] {
		return this.messages
	}

	constructor(plan: Plan, fileContents: Record<string, string>, memoryContext: string) {
		const filesSection = Object.entries(fileContents)
			.map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
			.join('\n\n')

		const sections = [
			`## Your Memory\n${memoryContext}`,
			`## Plan\n**${plan.title}**\n${plan.description}`,
			`## Implementation Instructions\n${plan.implementation}`,
		]

		if (plan.plannerReasoning) {
			sections.push(`## Planner Reasoning\nThe following is the planner's thinking process that led to this plan. Use it for additional context if the implementation instructions are unclear.\n\n${plan.plannerReasoning}`)
		}

		sections.push(`## Current Files\n${filesSection}`)
		sections.push('Implement the plan step by step. Use edit_file, create_file, and delete_file to make changes. Use read_file to verify your work or check file contents. Call done when the implementation is complete.')

		this.messages.push({
			role: 'user',
			content: sections.join('\n\n'),
		})
	}

	async createPatch(): Promise<EditOperation[]> {
		logger.info('Builder starting implementation...')
		return this.runBuilderLoop()
	}

	async fixPatch(error: string, currentFiles: Record<string, string>): Promise<EditOperation[]> {
		logger.info('Builder fixing implementation...')

		const filesSection = Object.entries(currentFiles)
			.map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
			.join('\n\n')

		this.messages.push({
			role: 'user',
			content: `Your previous changes were applied but CI failed. Fix only the issue — do not redo edits that already succeeded.\n\n## Error\n\`\`\`\n${error}\n\`\`\`\n\n## Current Files (after your previous edits)\n${filesSection}\n\nMake the targeted fixes needed, then call done.`,
		})

		this.edits.length = 0
		return this.runBuilderLoop()
	}

	private async runBuilderLoop(): Promise<EditOperation[]> {
		const maxTurns = 80

		for (let turn = 0; turn < maxTurns; turn++) {
			const response = await client.messages.create({
				model: config.patchModel,
				max_tokens: 16384,
				system: SYSTEM_PATCH,
				tools: BUILDER_TOOLS,
				messages: this.messages,
			})

			this.messages.push({ role: 'assistant', content: response.content })

			const toolBlocks = response.content.filter(c => c.type === 'tool_use')
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
				turn++

				const result = await this.handleBuilderTool(block)
				toolResults.push(result)

				if (block.name === 'done') {
					this.messages.push({ role: 'user', content: toolResults })
					logger.info(`Builder done: ${this.edits.length} edit(s) applied`)
					return this.edits
				}
			}

			this.messages.push({ role: 'user', content: toolResults })
		}

		if (this.edits.length > 0) {
			logger.warn(`Builder hit turn limit with ${this.edits.length} edit(s) — returning what we have`)
			return this.edits
		}
		throw new Error(`Builder exceeded maximum turns (${maxTurns}) without completing`)
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
