import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger from './logger.js'
import * as memory from './memory.js'
import * as codebase from './tools/codebase.js'
import * as git from './tools/git.js'

const client = new Anthropic({ apiKey: config.anthropicApiKey })

export interface Plan {
	title: string
	description: string
	filesToRead: string[]
	implementation: string
	plannerReasoning?: string
}

const PLAN_TOOL = {
	name: 'submit_plan' as const,
	description: 'Submit the development plan for this iteration. This is a handoff to the builder — everything the builder needs to implement the change correctly must be in your plan. The builder cannot read files or ask questions. Be thorough.',
	input_schema: {
		type: 'object' as const,
		properties: {
			title: {
				type: 'string' as const,
				description: 'Short title for the change (used as branch name, e.g. "add-input-validation")',
			},
			description: {
				type: 'string' as const,
				description: 'A clear summary of the change for the PR description. Explain what changes and why. This is public-facing.',
			},
			filesToRead: {
				type: 'array' as const,
				items: { type: 'string' as const },
				description: 'The carefully curated set of files the builder needs to implement this change correctly. Think about this deliberately — the builder sees ONLY these files. Include: files being edited, files with types/interfaces referenced by the change, files with patterns the builder should follow, and test files that need updating. Do NOT dump every file you read during exploration. Only include files the builder actually needs open to write correct code.',
			},
			implementation: {
				type: 'string' as const,
				description: `Comprehensive implementation instructions for the builder. This is the most important field — it is the builder's ONLY guide. Include:
- Exactly which files to modify, create, or delete
- For each file: what specifically to change, where in the file, and what the new code should look like
- What patterns, conventions, or styles to follow (reference specific existing code)
- What imports are needed
- What to be careful about — edge cases, things that could break, existing code that must not be disturbed
- If adding tests: what to test and what the expected behavior is
- The order in which edits should be applied if it matters
Write this as if briefing a developer who is seeing the codebase for the first time with only the files you listed.`,
			},
		},
		required: ['title', 'description', 'filesToRead', 'implementation'],
	},
}

const NOTE_TOOL = {
	name: 'note_to_self' as const,
	description: 'Leave a note for your future self. Notes stay visible at the top of your memory across all future sessions until you dismiss them. Use this for goals, priorities, reminders, or anything you want to keep in mind long-term.',
	input_schema: {
		type: 'object' as const,
		properties: {
			content: {
				type: 'string' as const,
				description: 'What you want to remember',
			},
		},
		required: ['content'],
	},
}

const DISMISS_TOOL = {
	name: 'dismiss_note' as const,
	description: 'Dismiss a note from your active view. The memory is not deleted — you can still find it later with recall_memory. Use this when a goal is complete or a reminder is no longer relevant.',
	input_schema: {
		type: 'object' as const,
		properties: {
			id: {
				type: 'string' as const,
				description: 'The ID of the note to dismiss',
			},
		},
		required: ['id'],
	},
}

const RECALL_TOOL = {
	name: 'recall_memory' as const,
	description: 'Look up a past memory in full detail. Search by keyword, or provide a specific memory ID from your context.',
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string' as const,
				description: 'A keyword or phrase to search memories for',
			},
			id: {
				type: 'string' as const,
				description: 'A specific memory ID to look up',
			},
		},
	},
}

const READ_FILE_TOOL = {
	name: 'read_file' as const,
	description: 'Read the contents of a file from your repository. Use this to inspect your own source code. You can read specific line ranges using the line numbers from the codebase index.',
	input_schema: {
		type: 'object' as const,
		properties: {
			filePath: {
				type: 'string' as const,
				description: 'Repo-relative file path (e.g. "src/config.ts")',
			},
			startLine: {
				type: 'number' as const,
				description: 'First line to read (1-based). Omit to read from the beginning.',
			},
			endLine: {
				type: 'number' as const,
				description: 'Last line to read (1-based, inclusive). Omit to read to the end.',
			},
		},
		required: ['filePath'],
	},
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

Your plan is a handoff. After you submit it, a separate builder model will receive your plan, the files you listed, and nothing else. The builder cannot read additional files, ask you questions, or see your reasoning from this conversation. Everything the builder needs to succeed must be explicitly written in your plan — especially the implementation field. If you explored files during planning and learned something important, put that knowledge into the implementation instructions. Do not assume the builder knows what you know.

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

export interface FileEdit {
	type: 'replace'
	filePath: string
	oldString: string
	newString: string
}

export interface FileCreate {
	type: 'create'
	filePath: string
	content: string
}

export interface FileDelete {
	type: 'delete'
	filePath: string
}

export type EditOperation = FileEdit | FileCreate | FileDelete

const BUILDER_EDIT_TOOL = {
	name: 'edit_file' as const,
	description: 'Replace a specific piece of text in an existing file. The oldString must match EXACTLY — character-for-character including all whitespace and indentation. Include 2-3 lines of surrounding context in oldString to ensure a unique match. Each call replaces ONE occurrence.',
	input_schema: {
		type: 'object' as const,
		properties: {
			filePath: {
				type: 'string' as const,
				description: 'Repo-relative path (e.g. "src/config.ts")',
			},
			oldString: {
				type: 'string' as const,
				description: 'The exact literal text to find in the file.',
			},
			newString: {
				type: 'string' as const,
				description: 'The exact text to replace oldString with.',
			},
		},
		required: ['filePath', 'oldString', 'newString'],
	},
}

const BUILDER_CREATE_TOOL = {
	name: 'create_file' as const,
	description: 'Create a new file with the given content. The file must not already exist.',
	input_schema: {
		type: 'object' as const,
		properties: {
			filePath: {
				type: 'string' as const,
				description: 'Repo-relative path for the new file',
			},
			content: {
				type: 'string' as const,
				description: 'The full content of the new file',
			},
		},
		required: ['filePath', 'content'],
	},
}

const BUILDER_DELETE_TOOL = {
	name: 'delete_file' as const,
	description: 'Delete an existing file.',
	input_schema: {
		type: 'object' as const,
		properties: {
			filePath: {
				type: 'string' as const,
				description: 'Repo-relative path of the file to delete',
			},
		},
		required: ['filePath'],
	},
}

const BUILDER_READ_TOOL = {
	name: 'read_file' as const,
	description: 'Read the current contents of a file. Use this to verify your edits, check the current state of a file before editing, or read a file you need for context.',
	input_schema: {
		type: 'object' as const,
		properties: {
			filePath: {
				type: 'string' as const,
				description: 'Repo-relative file path',
			},
		},
		required: ['filePath'],
	},
}

const BUILDER_DONE_TOOL = {
	name: 'done' as const,
	description: 'Signal that all edits are complete and the implementation is finished. Only call this when you have made all the changes described in the plan.',
	input_schema: {
		type: 'object' as const,
		properties: {
			summary: {
				type: 'string' as const,
				description: 'Brief summary of what was changed',
			},
		},
		required: ['summary'],
	},
}

const BUILDER_TOOLS = [BUILDER_EDIT_TOOL, BUILDER_CREATE_TOOL, BUILDER_DELETE_TOOL, BUILDER_READ_TOOL, BUILDER_DONE_TOOL]

const SYSTEM_PATCH = `You are the builder. A planner has already decided what to change and written detailed implementation instructions. Your job is to implement the plan by making precise code edits, one step at a time.

You have tools to:
- edit_file: Replace text in an existing file (find-and-replace, must match exactly)
- create_file: Create a new file
- delete_file: Delete a file
- read_file: Read a file to check its current contents or verify your edits
- done: Signal that the implementation is complete

Work incrementally:
1. Read the plan and implementation instructions carefully.
2. Work through the changes one file at a time, one edit at a time.
3. After making edits to a file, you can read it back to verify the result looks correct.
4. If you need to see a file that was not provided in the initial context, use read_file.
5. When all changes described in the plan are applied, call done.

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

export async function reflect(iterationSummary: string): Promise<string> {
	logger.info('Self-reflecting on iteration...')

	const response = await client.messages.create({
		model: config.planModel,
		max_tokens: 512,
		system: SYSTEM_REFLECT,
		messages: [{
			role: 'user',
			content: iterationSummary,
		}],
	})

	const text = response.content.find(c => c.type === 'text')?.text ?? ''
	logger.info(`Reflection: ${text.slice(0, 200)}`)
	return text.trim()
}

export async function plan(recentMemory: string, codebaseContext: string, gitLog: string): Promise<Plan> {
	logger.info('Asking LLM for a plan...')

	const tools = [PLAN_TOOL, NOTE_TOOL, DISMISS_TOOL, RECALL_TOOL, READ_FILE_TOOL]
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
			return input
		}

		const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []

		for (const toolBlock of toolBlocks) {
			if (toolBlock.type !== 'tool_use') continue
			i++
			let result: string

			if (toolBlock.name === 'note_to_self') {
				const input = toolBlock.input as { content: string }
				logger.info(`LLM saving note: "${input.content.slice(0, 200)}"`)
				result = await memory.pin(input.content)
			} else if (toolBlock.name === 'dismiss_note') {
				const input = toolBlock.input as { id: string }
				logger.info(`LLM dismissing note: ${input.id}`)
				result = await memory.unpin(input.id)
			} else if (toolBlock.name === 'recall_memory') {
				const input = toolBlock.input as { query?: string; id?: string }
				if (input.id) {
					logger.info(`LLM recalling memory by id: ${input.id}`)
					result = await memory.recallById(input.id)
				} else if (input.query) {
					logger.info(`LLM recalling memory by query: "${input.query}"`)
					result = await memory.recall(input.query)
				} else {
					result = 'Provide a query or id to recall a memory.'
				}
			} else if (toolBlock.name === 'read_file') {
				const input = toolBlock.input as { filePath: string; startLine?: number; endLine?: number }
				const rangeLabel = input.startLine ? `:${input.startLine}-${input.endLine ?? 'end'}` : ''
				logger.info(`LLM reading file: ${input.filePath}${rangeLabel}`)
				try {
				const fullContent = await codebase.readFile(config.workspacePath, input.filePath)
					if (input.startLine) {
						const lines = fullContent.split('\n')
						const start = Math.max(0, input.startLine - 1)
						const end = input.endLine ?? lines.length
						result = lines.slice(start, end).map((l, i) => `${start + i + 1} | ${l}`).join('\n')
					} else {
						result = fullContent
					}
				} catch {
					result = `[File not found: ${input.filePath}]`
				}
			} else {
				result = `Unknown tool: ${toolBlock.name}`
			}

			toolResults.push({
				type: 'tool_result',
				tool_use_id: toolBlock.id,
				content: `${result}\n\n(You have used ${i} of ${maxToolCalls} turns. You must call submit_plan before reaching the limit.)`,
			})
		}

		messages.push({ role: 'assistant', content: response.content })
		messages.push({ role: 'user', content: toolResults })
	}

	throw new Error(`LLM exceeded maximum tool calls (${maxToolCalls}) without submitting a plan`)
}

export class PatchSession {
	private readonly messages: Anthropic.MessageParam[] = []
	private readonly edits: EditOperation[] = []

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

			const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []

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

	private async handleBuilderTool(block: Anthropic.ContentBlock & { type: 'tool_use' }): Promise<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> {
		const id = block.id

		if (block.name === 'edit_file') {
			const input = block.input as { filePath: string; oldString: string; newString: string }
			const op: FileEdit = { type: 'replace', filePath: input.filePath, oldString: input.oldString, newString: input.newString }
			try {
				await git.applyEdits([op])
				this.edits.push(op)
				return { type: 'tool_result', tool_use_id: id, content: `Replaced text in ${input.filePath}` }
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				return { type: 'tool_result', tool_use_id: id, content: msg, is_error: true }
			}
		}

		if (block.name === 'create_file') {
			const input = block.input as { filePath: string; content: string }
			const op: FileCreate = { type: 'create', filePath: input.filePath, content: input.content }
			try {
				await git.applyEdits([op])
				this.edits.push(op)
				return { type: 'tool_result', tool_use_id: id, content: `Created ${input.filePath}` }
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				return { type: 'tool_result', tool_use_id: id, content: msg, is_error: true }
			}
		}

		if (block.name === 'delete_file') {
			const input = block.input as { filePath: string }
			const op: FileDelete = { type: 'delete', filePath: input.filePath }
			try {
				await git.applyEdits([op])
				this.edits.push(op)
				return { type: 'tool_result', tool_use_id: id, content: `Deleted ${input.filePath}` }
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				return { type: 'tool_result', tool_use_id: id, content: msg, is_error: true }
			}
		}

		if (block.name === 'read_file') {
			const input = block.input as { filePath: string }
			try {
				const content = await codebase.readFile(config.workspacePath, input.filePath)
				return { type: 'tool_result', tool_use_id: id, content }
			} catch {
				return { type: 'tool_result', tool_use_id: id, content: `[File not found: ${input.filePath}]`, is_error: true }
			}
		}

		if (block.name === 'done') {
			const input = block.input as { summary: string }
			logger.info(`Builder summary: ${input.summary.slice(0, 200)}`)
			return { type: 'tool_result', tool_use_id: id, content: 'Implementation complete.' }
		}

		return { type: 'tool_result', tool_use_id: id, content: `Unknown tool: ${block.name}`, is_error: true }
	}
}
