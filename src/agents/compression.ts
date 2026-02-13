import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import logger from '../logger.js'
import { callBatchApi, type BatchRequest } from '../llm/api.js'

// --- Types ---

interface ToolInfo {
	name: string
	input: Record<string, unknown>
}

interface Candidate {
	msgIdx: number
	blockIdx: number
	toolUseId: string
	toolName: string
	charLen: number
	inputHint: string
	contentPreview: string
}

// --- Constants ---

const NEVER_SUMMARIZE = new Set(['note_to_self', 'dismiss_note', 'recall_memory', 'done', 'submit_plan'])

// --- Public API ---

export async function compressConversation(messages: Anthropic.MessageParam[]): Promise<void> {
	if (messages.length < 3) return

	const totalChars = measureMessages(messages)
	if (totalChars <= config.summarization.charThreshold) return

	// Strip write inputs first so the summarizer doesn't see (or pay for) already-applied edits
	stripWriteInputs(messages)

	const toolMap = buildToolMap(messages)
	const candidates = selectCandidates(messages, toolMap)
	if (candidates.length === 0) return

	await summarizeCandidates(messages, candidates)
}

// --- Write Input Stripping ---

const WRITE_TOOLS = new Set(['edit_file', 'create_file'])

function stripWriteInputs(messages: Anthropic.MessageParam[]): void {
	const { protectedTurns } = config.summarization

	let assistantMsgCount = 0
	for (const msg of messages) if (msg.role === 'assistant') assistantMsgCount++

	let assistantIdx = 0
	let stripped = 0

	for (const msg of messages) {
		if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
		assistantIdx++
		if (assistantMsgCount - assistantIdx < protectedTurns) continue

		const content = msg.content as Anthropic.ContentBlockParam[]
		for (let j = 0; j < content.length; j++) {
			const block = content[j]
			if (block.type !== 'tool_use' || !WRITE_TOOLS.has(block.name)) continue

			const input = block.input as Record<string, unknown>
			if (block.name === 'edit_file' && typeof input.oldString === 'string' && !(input.oldString as string).startsWith('[applied')) {
				const oldLines = (input.oldString as string).split('\n').length
				const newLines = (input.newString as string).split('\n').length
				content[j] = { ...block, input: { filePath: input.filePath, oldString: `[applied — ${oldLines} lines]`, newString: `[applied — ${newLines} lines]` } }
				stripped++
			} else if (block.name === 'create_file' && typeof input.content === 'string' && !(input.content as string).startsWith('[applied')) {
				const lines = (input.content as string).split('\n').length
				content[j] = { ...block, input: { filePath: input.filePath, content: `[applied — ${lines} lines]` } }
				stripped++
			}
		}

		if (stripped > 0) msg.content = content
	}

	if (stripped > 0) logger.info(`Stripped ${stripped} write tool input(s)`)
}

// --- Helpers ---

function buildToolMap(messages: Anthropic.MessageParam[]): Map<string, ToolInfo> {
	const map = new Map<string, ToolInfo>()
	for (const msg of messages) {
		if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue
		for (const block of msg.content) {
			if (block.type === 'tool_use') {
				map.set(block.id, { name: block.name, input: block.input as Record<string, unknown> })
			}
		}
	}
	return map
}

function measureMessages(messages: Anthropic.MessageParam[]): number {
	let total = 0
	for (const msg of messages) {
		if (typeof msg.content === 'string') {
			total += msg.content.length
		} else if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === 'text') total += (block as Anthropic.TextBlock).text.length
				else if (block.type === 'tool_result') {
					const text = typeof (block as { content?: string }).content === 'string'
						? (block as { content: string }).content : ''
					total += text.length
				} else if (block.type === 'tool_use') {
					total += JSON.stringify((block as Anthropic.ToolUseBlock).input).length
				}
			}
		}
	}
	return total
}

function selectCandidates(messages: Anthropic.MessageParam[], toolMap: Map<string, ToolInfo>): Candidate[] {
	const { minResultChars, protectedTurns } = config.summarization

	let userMsgCount = 0
	for (const msg of messages) if (msg.role === 'user') userMsgCount++

	const candidates: Candidate[] = []
	let userIdx = 0

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (msg.role !== 'user') continue
		userIdx++
		if (!Array.isArray(msg.content)) continue
		if (userMsgCount - userIdx < protectedTurns) continue

		const blocks = msg.content as Anthropic.ContentBlockParam[]
		for (let j = 0; j < blocks.length; j++) {
			const block = blocks[j]
			if (block.type !== 'tool_result') continue

			const text = typeof (block as { content?: string }).content === 'string'
				? (block as { content: string }).content : ''
			if (text.length < minResultChars) continue

			const tool = toolMap.get((block as Anthropic.ToolResultBlockParam).tool_use_id)
			if (!tool || NEVER_SUMMARIZE.has(tool.name)) continue

			candidates.push({
				msgIdx: i, blockIdx: j,
				toolUseId: (block as Anthropic.ToolResultBlockParam).tool_use_id,
				toolName: tool.name,
				charLen: text.length,
				inputHint: buildInputHint(tool),
				contentPreview: text.slice(0, 200),
			})
		}
	}

	return candidates
}

function buildInputHint(tool: ToolInfo): string {
	const input = tool.input
	if (tool.name === 'read_file') return `: ${input.filePath}`
	if (tool.name === 'grep_search') return `: "${(input.query as string)?.slice(0, 60)}"`
	if (tool.name === 'file_search') return `: "${(input.query as string)?.slice(0, 60)}"`
	if (tool.name === 'list_directory') return `: ${input.path}`
	return ''
}

// --- Batched LLM Summarization with Prompt Caching ---

const KEEP_TOOL: Anthropic.Tool = {
	name: 'keep',
	description: 'Keep a tool result unchanged — it is still actively relevant.',
	input_schema: {
		type: 'object' as const,
		properties: {
			tool_use_id: { type: 'string' as const, description: 'The tool_use_id of the result to keep' },
		},
		required: ['tool_use_id'],
	},
}

const SUMMARIZE_TOOL: Anthropic.Tool = {
	name: 'summarize',
	description: 'Replace a tool result with a smaller version containing only the relevant portions.',
	input_schema: {
		type: 'object' as const,
		properties: {
			tool_use_id: { type: 'string' as const, description: 'The tool_use_id of the result to summarize' },
			summary: { type: 'string' as const, description: 'The summarized content — only the relevant portions, verbatim' },
		},
		required: ['tool_use_id', 'summary'],
	},
}

async function summarizeCandidates(
	messages: Anthropic.MessageParam[],
	candidates: Candidate[],
): Promise<void> {
	const cachedMessages = addCacheBreakpoint(messages)

	const requests: BatchRequest[] = candidates.map(c => ({
		phase: 'summarizer' as const,
		messages: [
			...cachedMessages,
			{ role: 'assistant' as const, content: 'I will now evaluate tool results for summarization.' },
			{
				role: 'user' as const,
				content: `Evaluate the tool result with tool_use_id="${c.toolUseId}" (${c.toolName}${c.inputHint}, ${c.charLen} chars) for summarization. Its content starts with:\n${c.contentPreview}\n\nCall either keep or summarize.`,
			},
		],
		tools: [KEEP_TOOL, SUMMARIZE_TOOL],
	}))

	let kept = 0
	let summarized = 0
	let failed = 0
	const diffs: string[] = []

	try {
		const responses = await callBatchApi(requests)

		for (let i = 0; i < candidates.length; i++) {
			const toolCall = responses[i].content.find(b => b.type === 'tool_use')
			if (!toolCall || toolCall.type !== 'tool_use' || toolCall.name === 'keep') {
				kept++
			} else {
				const input = toolCall.input as { summary?: string }
				const summary = input.summary ?? ''
				summarized++
				diffs.push(`${candidates[i].toolName}: ${candidates[i].charLen} → ${summary.length} chars`)
				applySummary(messages, candidates[i], summary)
			}
		}
	} catch {
		for (const candidate of candidates) {
			failed++
			applyRedaction(messages, candidate)
		}
	}

	const diffLog = diffs.length > 0 ? ` | ${diffs.join(' | ')}` : ''
	logger.info(`Summarizer: ${kept} kept, ${summarized} summarized, ${failed} failed (${candidates.length} candidates)${diffLog}`)
}

function addCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
	if (messages.length === 0) return messages
	const result = messages.map((m, i) => i < messages.length - 1 ? m : { ...m })
	const lastMsg = result[result.length - 1]

	if (typeof lastMsg.content === 'string') {
		result[result.length - 1] = {
			...lastMsg,
			content: [{ type: 'text' as const, text: lastMsg.content, cache_control: { type: 'ephemeral' as const } }],
		}
	} else if (Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
		const blocks = [...lastMsg.content] as Array<Anthropic.ContentBlockParam & { cache_control?: { type: 'ephemeral' } }>
		blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
		result[result.length - 1] = { ...lastMsg, content: blocks }
	}

	return result
}

function applySummary(messages: Anthropic.MessageParam[], candidate: Candidate, summary: string): void {
	const msg = messages[candidate.msgIdx]
	if (!Array.isArray(msg.content)) return
	const content = [...msg.content as Anthropic.ContentBlockParam[]]
	const block = content[candidate.blockIdx]
	if (block.type !== 'tool_result') return
	content[candidate.blockIdx] = { ...block, content: summary }
	messages[candidate.msgIdx] = { ...msg, content }
}

function applyRedaction(messages: Anthropic.MessageParam[], candidate: Candidate): void {
	const msg = messages[candidate.msgIdx]
	if (!Array.isArray(msg.content)) return
	const content = [...msg.content as Anthropic.ContentBlockParam[]]
	const block = content[candidate.blockIdx]
	if (block.type !== 'tool_result') return
	content[candidate.blockIdx] = { ...block, content: `[Redacted: ${candidate.toolName} result removed — re-call if needed.]` }
	messages[candidate.msgIdx] = { ...msg, content }
}
