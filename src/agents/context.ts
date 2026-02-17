import { relative } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import logger from '../logger.js'
import { readFile } from '../tools/codebase.js'

export interface TrackedRegion {
	start: number
	end: number
	lastUseTurn: number
}

interface TrackedFile {
	path: string
	regions: TrackedRegion[]
	lastContent: string | null
	totalLines: number
	lastEditTurn: number
	deleted: boolean
}

const WRITE_TOOLS = new Set(['edit_file', 'create_file'])
const STRIPPED_MARKER = '[reasoning stripped]'

export async function prepareAndBuildContext(
	workspacePath: string,
	messages: Anthropic.MessageParam[],
): Promise<string | null> {
	const files = scanFileActivity(workspacePath, messages)

	stripOldTurns(messages)
	await refreshFiles(workspacePath, files)
	evictOverBudget(files)

	return buildWorkingContext(files)
}

// --- Region Management ---

export function addRegion(regions: TrackedRegion[], start: number, end: number, turn: number): TrackedRegion[] {
	const result: TrackedRegion[] = []

	for (const existing of regions) {
		if (existing.end < start || existing.start > end) {
			result.push(existing)
			continue
		}
		if (existing.start < start) {
			result.push({ start: existing.start, end: start - 1, lastUseTurn: existing.lastUseTurn })
		}
		if (existing.end > end) {
			result.push({ start: end + 1, end: existing.end, lastUseTurn: existing.lastUseTurn })
		}
	}

	result.push({ start, end, lastUseTurn: turn })
	result.sort((a, b) => a.start - b.start)

	if (result.length <= 1) return result

	const merged: TrackedRegion[] = [{ ...result[0] }]
	for (let i = 1; i < result.length; i++) {
		const prev = merged[merged.length - 1]
		if (result[i].start <= prev.end + 1 && result[i].lastUseTurn === prev.lastUseTurn) {
			prev.end = Math.max(prev.end, result[i].end)
		} else {
			merged.push({ ...result[i] })
		}
	}

	return merged
}

// --- State Derivation ---

function scanFileActivity(
	workspacePath: string,
	messages: Anthropic.MessageParam[],
): Map<string, TrackedFile> {
	const files = new Map<string, TrackedFile>()
	let turn = 0

	for (const msg of messages) {
		if (msg.role !== 'assistant') continue
		turn++

		if (!Array.isArray(msg.content)) continue

		for (const block of msg.content) {
			if (block.type !== 'tool_use') continue
			const input = block.input as Record<string, unknown>

			if (block.name === 'read_file') {
				const path = normalizePath(workspacePath, input.filePath as string)
				const startLine = (input.startLine as number) ?? 1
				const endLine = input.endLine as number | undefined
				trackRead(files, path, startLine, endLine, turn)
			}

			if (block.name === 'edit_file') {
				const path = normalizePath(workspacePath, input.filePath as string)
				trackEdit(files, path, turn)
			}

			if (block.name === 'create_file') {
				const path = normalizePath(workspacePath, input.filePath as string)
				trackCreate(files, path, turn)
			}

			if (block.name === 'delete_file') {
				const path = normalizePath(workspacePath, input.filePath as string)
				trackDelete(files, path, turn)
			}
		}
	}

	return files
}

function normalizePath(workspacePath: string, filePath: string): string {
	if (filePath.startsWith(workspacePath)) {
		return relative(workspacePath, filePath).replace(/\\/g, '/')
	}
	return filePath.replace(/\\/g, '/')
}

function getOrCreateFile(files: Map<string, TrackedFile>, path: string): TrackedFile {
	let file = files.get(path)
	if (!file) {
		file = { path, regions: [], lastContent: null, totalLines: 0, lastEditTurn: 0, deleted: false }
		files.set(path, file)
	}
	return file
}

function trackRead(
	files: Map<string, TrackedFile>,
	path: string,
	startLine: number,
	endLine: number | undefined,
	turn: number,
): void {
	const file = getOrCreateFile(files, path)
	file.deleted = false

	const contextPadding = config.context.contextPadding
	const defaultReadWindow = config.tools.defaultReadWindow

	const paddedStart = Math.max(1, startLine - contextPadding)
	const paddedEnd = (endLine ?? startLine + defaultReadWindow - 1) + contextPadding
	file.regions = addRegion(file.regions, paddedStart, paddedEnd, turn)
}

function trackEdit(files: Map<string, TrackedFile>, path: string, turn: number): void {
	const file = getOrCreateFile(files, path)
	file.lastEditTurn = Math.max(file.lastEditTurn, turn)
	file.deleted = false
}

function trackCreate(files: Map<string, TrackedFile>, path: string, turn: number): void {
	const file = getOrCreateFile(files, path)
	file.lastEditTurn = Math.max(file.lastEditTurn, turn)
	file.deleted = false
	file.regions = addRegion(file.regions, 1, Infinity, turn)
}

function trackDelete(files: Map<string, TrackedFile>, path: string, turn: number): void {
	const file = files.get(path)
	if (file) {
		file.deleted = true
		file.lastEditTurn = Math.max(file.lastEditTurn, turn)
		file.lastContent = null
	}
}

// --- Old Turn Stripping (combined: reasoning, write inputs, tool results) ---

function stripOldTurns(messages: Anthropic.MessageParam[]): void {
	const { protectedTurns, minResultChars } = config.context

	let assistantCount = 0
	let userCount = 0
	for (const msg of messages) {
		if (msg.role === 'assistant') assistantCount++
		else if (msg.role === 'user') userCount++
	}

	let assistantIdx = 0
	let userIdx = 0
	let strippedAssistant = 0
	let strippedResults = 0

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]

		if (msg.role === 'assistant') {
			assistantIdx++
			if (assistantCount - assistantIdx < protectedTurns) continue

			if (!Array.isArray(msg.content)) {
				if (typeof msg.content === 'string' && msg.content !== STRIPPED_MARKER) {
					messages[i] = { role: 'assistant', content: STRIPPED_MARKER }
					strippedAssistant++
				}
				continue
			}

			const content = msg.content as Anthropic.ContentBlockParam[]
			const kept: Anthropic.ContentBlockParam[] = []

			for (const block of content) {
				if (block.type === 'text') {
					kept.push(block)
				} else if (block.type === 'tool_use') {
					kept.push(stubToolUse(block as Anthropic.ToolUseBlock))
				}
			}

			if (kept.length === 0) {
				messages[i] = { role: 'assistant', content: STRIPPED_MARKER }
				strippedAssistant++
			} else if (kept.length !== content.length || kept.some((b, j) => b !== content[j])) {
				messages[i] = { role: 'assistant', content: kept }
				strippedAssistant++
			}
		}

		if (msg.role === 'user') {
			userIdx++
			if (userCount - userIdx < protectedTurns) continue
			if (!Array.isArray(msg.content)) continue

			const blocks = [...msg.content] as Anthropic.ContentBlockParam[]
			let changed = false

			for (let j = 0; j < blocks.length; j++) {
				const block = blocks[j]
				if (block.type !== 'tool_result') continue

				const tr = block as Anthropic.ToolResultBlockParam
				const content = typeof tr.content === 'string' ? tr.content : ''
				if (content.length < minResultChars) continue
				if (content.startsWith('[result') || content.startsWith('[applied')) continue

				blocks[j] = { ...tr, content: `[result — ${content.split('\n').length} lines]` }
				changed = true
				strippedResults++
			}

			if (changed) messages[i] = { ...msg, content: blocks }
		}
	}

	if (strippedAssistant > 0) logger.info(`Context: stripped ${strippedAssistant} old assistant message(s)`)
	if (strippedResults > 0) logger.info(`Context: stubbed ${strippedResults} old tool result(s)`)
}

function stubToolUse(block: Anthropic.ToolUseBlock): Anthropic.ToolUseBlock {
	const input = block.input as Record<string, unknown>

	if (block.name === 'edit_file' && typeof input.oldString === 'string' && !(input.oldString as string).startsWith('[applied')) {
		const oldLines = (input.oldString as string).split('\n').length
		const newLines = (input.newString as string).split('\n').length
		return { ...block, input: { filePath: input.filePath, oldString: `[applied — ${oldLines} lines]`, newString: `[applied — ${newLines} lines]` } }
	}

	if (block.name === 'create_file' && typeof input.content === 'string' && !(input.content as string).startsWith('[applied')) {
		const lines = (input.content as string).split('\n').length
		return { ...block, input: { filePath: input.filePath, content: `[applied — ${lines} lines]` } }
	}

	return block
}

// --- File Refresh ---

async function refreshFiles(workspacePath: string, files: Map<string, TrackedFile>): Promise<void> {
	for (const file of files.values()) {
		if (file.deleted) continue

		try {
			const content = await readFile(workspacePath, file.path)
			file.lastContent = content
			file.totalLines = content.split('\n').length

			for (const region of file.regions) {
				if (region.end === Infinity || region.end > file.totalLines) {
					region.end = file.totalLines
				}
			}
		} catch {
			file.lastContent = null
			file.deleted = true
		}
	}
}

// --- Budget-Based Region Eviction ---

function evictOverBudget(files: Map<string, TrackedFile>): void {
	const { maxActiveLines } = config.context

	type RegionEntry = { file: TrackedFile; region: TrackedRegion; lines: number; effectiveTurn: number }
	const entries: RegionEntry[] = []

	for (const file of files.values()) {
		if (file.deleted || !file.lastContent) continue
		for (const region of file.regions) {
			const lines = Math.min(region.end, file.totalLines) - Math.max(1, region.start) + 1
			if (lines <= 0) continue
			entries.push({ file, region, lines, effectiveTurn: Math.max(region.lastUseTurn, file.lastEditTurn) })
		}
	}

	entries.sort((a, b) => b.effectiveTurn - a.effectiveTurn)

	let totalLines = 0
	const keepSet = new Set<TrackedRegion>()

	for (const entry of entries) {
		if (totalLines + entry.lines <= maxActiveLines) {
			totalLines += entry.lines
			keepSet.add(entry.region)
		}
	}

	let evicted = 0
	for (const file of files.values()) {
		const before = file.regions.length
		file.regions = file.regions.filter(r => keepSet.has(r))
		evicted += before - file.regions.length
	}

	if (evicted > 0) logger.info(`Context: evicted ${evicted} region(s) (${totalLines}/${maxActiveLines} active lines)`)
}

// --- Working Context Builder ---

function buildWorkingContext(files: Map<string, TrackedFile>): string | null {
	const activeFiles = [...files.values()]
		.filter(f => !f.deleted && f.lastContent && f.regions.length > 0)
		.sort((a, b) => a.path.localeCompare(b.path))

	if (activeFiles.length === 0) return null

	const sections: string[] = []
	let totalLinesShown = 0

	for (const file of activeFiles) {
		if (!file.lastContent) continue
		const lines = file.lastContent.split('\n')
		const sorted = [...file.regions].sort((a, b) => a.start - b.start)
		if (sorted.length === 0) continue

		const fileLines: string[] = []
		let lastShownLine = 0

		for (const region of sorted) {
			const start = Math.max(1, region.start)
			const end = Math.min(region.end, file.totalLines)

			for (let lineNum = start; lineNum <= end; lineNum++) {
				if (lastShownLine === 0 && lineNum > 1) {
					fileLines.push(`[... ${lineNum - 1} lines above ...]`)
				} else if (lastShownLine > 0 && lineNum > lastShownLine + 1) {
					fileLines.push(`[... ${lineNum - lastShownLine - 1} lines omitted ...]`)
				}

				fileLines.push(`${lineNum} | ${lines[lineNum - 1]}`)
				lastShownLine = lineNum
				totalLinesShown++
			}
		}

		if (fileLines.length === 0) continue

		sections.push(`\n--- ${file.path} (${file.totalLines} lines) ---`)
		sections.push(...fileLines)

		if (lastShownLine < file.totalLines) {
			sections.push(`[... ${file.totalLines - lastShownLine} lines below ...]`)
		}
	}

	if (totalLinesShown === 0) return null

	return `## Working Context (${activeFiles.length} files, ${totalLinesShown} lines — auto-refreshed from disk)\n` + sections.join('\n')
}
