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

		let changed = false
		const content = msg.content as Anthropic.ContentBlockParam[]
		for (let j = 0; j < content.length; j++) {
			const block = content[j]
			if (block.type !== 'tool_use' || !WRITE_TOOLS.has(block.name)) continue

			const input = block.input as Record<string, unknown>
			if (block.name === 'edit_file' && typeof input.oldString === 'string' && !(input.oldString as string).startsWith('[applied')) {
				const oldLines = (input.oldString as string).split('\n').length
				const newLines = (input.newString as string).split('\n').length
				content[j] = { ...block, input: { filePath: input.filePath, oldString: `[applied — ${oldLines} lines]`, newString: `[applied — ${newLines} lines]` } }
				changed = true
				stripped++
			} else if (block.name === 'create_file' && typeof input.content === 'string' && !(input.content as string).startsWith('[applied')) {
				const lines = (input.content as string).split('\n').length
				content[j] = { ...block, input: { filePath: input.filePath, content: `[applied — ${lines} lines]` } }
				changed = true
				stripped++
			}
		}

		if (changed) msg.content = content
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

const SUMMARIZE_LINES_TOOL: Anthropic.Tool = {
	name: 'summarize_lines',
	description: `Specify which lines of the tool result to keep in the conversation history.
Use this for any large tool result - code, JSON, binary output, etc. - when only specific sections are relevant.
Line numbers refer to the content as currently numbered (starting from 1).
You can specify individual lines or ranges: "1", "1-5", "1-5,10", "1-5,10-15", etc.
Gap markers will be automatically added to show where content was omitted.`,
	input_schema: {
		type: 'object' as const,
		properties: {
			tool_use_id: { type: 'string' as const, description: 'The tool_use_id of the result to summarize' },
			keep_lines: { type: 'string' as const, description: 'Line ranges to keep, e.g., "1-10,15,20-25"' },
		},
		required: ['tool_use_id', 'keep_lines'],
	},
}

// --- Line-Based Compression Utilities ---

/**
 * Add ephemeral line numbers to content (one char separator)
 */
function addLineNumbers(content: string): string {
	const lines = content.split('\n')
	return lines.map((line, i) => `${i + 1}|${line}`).join('\n')
}

/**
 * Parse line ranges like "1", "1-5", "1-5,10-15"
 * Returns sorted array of [start, end] tuples
 */
function parseLineRanges(rangeStr: string): Array<[number, number]> {
	const parts = rangeStr.split(',').map(s => s.trim())
	const ranges: Array<[number, number]> = []

	for (const part of parts) {
		if (part.includes('-')) {
			const [start, end] = part.split('-').map(Number)
			if (start && end && start <= end) {
				ranges.push([start, end])
			}
		} else {
			const num = Number(part)
			if (num) {
				ranges.push([num, num])
			}
		}
	}

	ranges.sort((a, b) => a[0] - b[0])

	const merged: Array<[number, number]> = []
	for (const range of ranges) {
		const prev = merged[merged.length - 1]
		if (prev && range[0] <= prev[1] + 1) {
			prev[1] = Math.max(prev[1], range[1])
		} else {
			merged.push([...range])
		}
	}

	return merged
}

/**
 * Filter lines by keeping only specified ranges, adding gap markers
 * Always add gap markers for consistency:
 * - Before first range if not starting at line 1
 * - Between non-consecutive ranges
 * - After last range if not ending at last line
 */
function filterByLineRanges(content: string, rangeStr: string): string {
	const lines = content.split('\n')
	const totalLines = lines.length
	const ranges = parseLineRanges(rangeStr)

	if (ranges.length === 0) {
		return content // Keep unchanged if invalid ranges
	}

	const kept: string[] = []

	// Add gap marker before first range if not starting at line 1
	if (ranges[0][0] > 1) {
		kept.push(config.summarization.gapMarker)
	}

	// Add lines for each range and gap markers between them
	for (let i = 0; i < ranges.length; i++) {
		const [start, end] = ranges[i]

		// Add lines in this range (with bounds checking)
		for (let lineNum = start; lineNum <= end && lineNum <= totalLines; lineNum++) {
			kept.push(lines[lineNum - 1])
		}

		if (i < ranges.length - 1) {
			kept.push(config.summarization.gapMarker)
		}
	}

	// Add gap marker after last range if not ending at last line
	const lastRange = ranges[ranges.length - 1]
	if (lastRange[1] < totalLines) {
		kept.push(config.summarization.gapMarker)
	}

	return kept.join('\n')
}

async function summarizeCandidates(
	messages: Anthropic.MessageParam[],
	candidates: Candidate[],
): Promise<void> {
	const cachedMessages = addCacheBreakpoint(messages)

	const requests: BatchRequest[] = candidates.map(c => {
		// Get the actual content and add line numbers
		const msg = messages[c.msgIdx]
		const blocks = msg.content as Anthropic.ContentBlockParam[]
		const block = blocks[c.blockIdx] as Anthropic.ToolResultBlockParam
		const content = typeof block.content === 'string' ? block.content : ''
		const numberedContent = addLineNumbers(content)

		return {
			phase: 'summarizer' as const,
			messages: [
				...cachedMessages,
				{ role: 'assistant' as const, content: 'I will now evaluate tool results for summarization.' },
				{
					role: 'user' as const,
					content: `Evaluate the tool result with tool_use_id="${c.toolUseId}" (${c.toolName}${c.inputHint}, ${c.charLen} chars) for summarization. Its content with line numbers:\n\n${numberedContent}\n\nCall keep to preserve unchanged, or summarize_lines with line ranges to keep (e.g., "1-10,15-20").`,
				},
			],
			tools: [KEEP_TOOL, SUMMARIZE_LINES_TOOL],
		}
	})

	let kept = 0
	let summarized = 0
	let apiErrors = 0
	const diffs: string[] = []

	let responses: Anthropic.Message[] = []
	try {
		responses = await callBatchApi(requests)
		if (responses.length !== candidates.length) {
			logger.warn(`Batch API returned ${responses.length} responses for ${candidates.length} candidates — processing available responses`)
		}
	} catch (err) {
		logger.warn(`Batch API failed: ${err instanceof Error ? err.message : String(err)} — keeping all candidates unchanged`)
		kept = candidates.length
		logger.info(`Summarizer: ${kept} kept, ${summarized} summarized (${candidates.length} candidates, ${apiErrors} errors)`)
		return
	}

	// Build map of tool_use_id -> response for resilient matching
	const responseMap = new Map<string, Anthropic.Message>()
	for (const response of responses) {
		if (!response?.content) continue
		try {
			const toolCall = response.content.find(b => b.type === 'tool_use')
			if (toolCall && toolCall.type === 'tool_use') {
				const input = toolCall.input as { tool_use_id?: string }
				if (input.tool_use_id) {
					responseMap.set(input.tool_use_id, response)
				}
			}
		} catch (err) {
			logger.warn(`Error parsing response: ${err instanceof Error ? err.message : String(err)}`)
			apiErrors++
		}
	}

	// Apply responses by matching tool_use_id
	for (const candidate of candidates) {
		const response = responseMap.get(candidate.toolUseId)
		if (!response?.content) {
			kept++
			continue
		}

		try {
			const toolCall = response.content.find(b => b.type === 'tool_use')
			if (!toolCall || toolCall.type !== 'tool_use' || toolCall.name === 'keep') {
				kept++
			} else if (toolCall.name === 'summarize_lines') {
				const input = toolCall.input as { keep_lines?: string }
				const keepLines = input.keep_lines
				if (typeof keepLines === 'string') {
					const msg = messages[candidate.msgIdx]
					const blocks = msg.content as Anthropic.ContentBlockParam[]
					const block = blocks[candidate.blockIdx] as Anthropic.ToolResultBlockParam
					const originalContent = typeof block.content === 'string' ? block.content : ''
					
					const filtered = filterByLineRanges(originalContent, keepLines)
					summarized++
					diffs.push(`${candidate.toolName}: ${candidate.charLen} → ${filtered.length} chars`)
					applySummary(messages, candidate, filtered)
				} else {
					kept++
				}
			} else {
				kept++
			}
		} catch (err) {
			logger.warn(`Error processing candidate ${candidate.toolUseId}: ${err instanceof Error ? err.message : String(err)}`)
			apiErrors++
			kept++
		}
	}

	const errorLog = apiErrors > 0 ? `, ${apiErrors} errors` : ''
	const diffLog = diffs.length > 0 ? ` | ${diffs.join(' | ')}` : ''
	logger.info(`Summarizer: ${kept} kept, ${summarized} summarized (${candidates.length} candidates${errorLog})${diffLog}`)
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
