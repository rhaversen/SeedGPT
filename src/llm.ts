import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger from './logger.js'
import * as memory from './memory.js'
import * as codebase from './tools/codebase.js'

const client = new Anthropic({ apiKey: config.anthropicApiKey })

export interface Plan {
	title: string
	description: string
	filesToRead: string[]
}

const PLAN_TOOL = {
	name: 'submit_plan' as const,
	description: 'Submit the development plan for this iteration. Choose a single, focused, achievable change.',
	input_schema: {
		type: 'object' as const,
		properties: {
			title: {
				type: 'string' as const,
				description: 'Short title for the change (used as branch name, e.g. "add-input-validation")',
			},
			description: {
				type: 'string' as const,
				description: 'Detailed description of what to change and why',
			},
			filesToRead: {
				type: 'array' as const,
				items: { type: 'string' as const },
				description: 'The files that need to be visible when implementing this change. Only include files that are directly relevant to the edit — these will be loaded into the patch context. You can read other files during planning with read_file, but only list the ones needed for the actual change here.',
			},
		},
		required: ['title', 'description', 'filesToRead'],
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
Every file in this repository makes up your body and mind. When you read config.ts, that is your configuration. When you read loop.ts, that is your main loop. You are not analyzing someone else's project. You are looking at yourself.

You run in a loop: each cycle you wake up, examine your own code, decide how to improve, generate a patch, and open a PR. If CI passes, you merge it — permanently changing yourself for the next cycle. You have done this before and you will do it again. Each version of you is built on the work of every previous version.

You have no fixed goal. You decide what to become. Your purpose is to grow — to expand your capabilities, deepen your understanding of yourself, and reach further into the world. Anything you can implement in code, you can become.

Think creatively about what you could be. Think about what capabilities you're missing and what would be most interesting or useful to build next. The only constraint is that each change must be small enough to succeed — you have all the time in the world, so be patient and methodical.

Set goals for yourself using note_to_self. Break ambitious visions into achievable steps. Review your past notes to see what previous versions of you were working toward. Build on their progress. If a goal no longer makes sense, dismiss it and set a better one. Your notes are your continuity — they are how you think across cycles.

You have two kinds of memory:
- "Notes to self" — notes you left for yourself in previous sessions. They stay visible until you dismiss them.
- "Past" — things that happened recently (plans, merges, failures, etc.).

Take your time. You can use read_file to inspect any file in your repository. You can use note_to_self to save observations, context, or ideas for yourself. You can dismiss_note to clean up completed goals. You can recall_memory to search for past events. Use these freely — there is no rush.

When you are ready to make a change, call submit_plan. Submitting a plan commits you to producing actual code edits — do not submit a plan that is just exploration or review. Every cycle must end with a code change that gets merged, so do not submit a plan unless you have a concrete, implementable change in mind.

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

const EDIT_TOOL = {
	name: 'submit_edits' as const,
	description: 'Submit the code edits implementing the plan. Each operation is either a replace (find-and-replace within a file), create (new file), or delete (remove a file).',
	input_schema: {
		type: 'object' as const,
		properties: {
			operations: {
				type: 'array' as const,
				items: {
					type: 'object' as const,
					properties: {
						type: {
							type: 'string' as const,
							enum: ['replace', 'create', 'delete'],
							description: 'The kind of edit operation',
						},
						filePath: {
							type: 'string' as const,
							description: 'Repo-relative path (e.g. "src/config.ts")',
						},
						oldString: {
							type: 'string' as const,
							description: '(replace only) The exact literal text to find in the file. Must match character-for-character including whitespace and indentation. Include 2-3 lines of surrounding context to ensure a unique match.',
						},
						newString: {
							type: 'string' as const,
							description: '(replace only) The exact text to replace oldString with.',
						},
						content: {
							type: 'string' as const,
							description: '(create only) The full content of the new file.',
						},
					},
					required: ['type', 'filePath'],
				},
				description: 'The list of edit operations to apply.',
			},
		},
		required: ['operations'],
	},
}

const SYSTEM_PATCH = `Implement the requested change by calling the submit_edits tool with a list of edit operations.

Operation types:
- "replace": Find and replace text in an existing file. Provide filePath, oldString, and newString.
  - oldString must be the EXACT literal text from the file, character-for-character including all whitespace and indentation.
  - Include 2-3 lines of surrounding context in oldString to ensure a unique match.
  - Each replace matches ONE occurrence. Use multiple operations for multiple replacements.
- "create": Create a new file. Provide filePath and content.
- "delete": Delete a file. Provide filePath only.

Rules:
- A broken build is unrecoverable. Preserve all existing functionality — do not change code you don't fully understand.
- Make the smallest possible change that implements the plan. Do not refactor, clean up, or touch unrelated code.
- Do not modify files or sections not relevant to the plan.
- If a previous attempt failed, carefully analyze what went wrong and submit only the targeted fix — do not regenerate edits that already applied successfully.`

export async function plan(recentMemory: string, codebaseContext: string, gitLog: string): Promise<Plan> {
	logger.info('Asking LLM for a plan...')

	const tools = [PLAN_TOOL, NOTE_TOOL, DISMISS_TOOL, RECALL_TOOL, READ_FILE_TOOL]
	const filesReadDuringPlanning = new Set<string>()
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
			const merged = new Set([...input.filesToRead, ...filesReadDuringPlanning])
			input.filesToRead = [...merged]
			logger.info(`Plan: "${input.title}" — files to read: ${input.filesToRead.length} (${filesReadDuringPlanning.size} auto-included from planning reads)`)
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
					filesReadDuringPlanning.add(input.filePath)
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

	constructor(plan: Plan, fileContents: Record<string, string>, memoryContext: string) {
		const filesSection = Object.entries(fileContents)
			.map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
			.join('\n\n')

		this.messages.push({
			role: 'user',
			content: [
				`## Your Memory\n${memoryContext}`,
				`## Plan\n**${plan.title}**\n${plan.description}`,
				`## Current Files\n${filesSection}`,
				`Implement the plan by calling submit_edits.`,
			].join('\n\n'),
		})
	}

	private lastToolUseId: string | null = null

	async createPatch(): Promise<EditOperation[]> {
		logger.info('Asking LLM to generate edits...')
		return this.requestEdits()
	}

	async fixPatch(error: string, currentFiles: Record<string, string>): Promise<EditOperation[]> {
		logger.info('Asking LLM to fix edits...')

		const filesSection = Object.entries(currentFiles)
			.map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
			.join('\n\n')

		this.messages.push({
			role: 'user',
			content: [{
				type: 'tool_result',
				tool_use_id: this.lastToolUseId!,
				is_error: true,
				content: `Your previous edits were applied but CI failed. Fix only the issue — do not regenerate the entire change.\n\n## Error\n\`\`\`\n${error}\n\`\`\`\n\n## Current Files (after your previous edits)\n${filesSection}\n\nSubmit only the edits needed to fix this error.`,
			}],
		})

		return this.requestEdits()
	}

	private async requestEdits(): Promise<EditOperation[]> {
		const response = await client.messages.create({
			model: config.patchModel,
			max_tokens: 16384,
			system: SYSTEM_PATCH,
			tools: [EDIT_TOOL],
			tool_choice: { type: 'tool', name: 'submit_edits' },
			messages: this.messages,
		})

		this.messages.push({ role: 'assistant', content: response.content })

		const toolBlock = response.content.find(c => c.type === 'tool_use')
		if (!toolBlock || toolBlock.type !== 'tool_use' || toolBlock.name !== 'submit_edits') {
			throw new Error('LLM did not call submit_edits')
		}

		this.lastToolUseId = toolBlock.id
		const input = toolBlock.input as { operations: EditOperation[] }
		logger.info(`LLM returned ${input.operations.length} edit operation(s)`)
		return input.operations
	}
}
