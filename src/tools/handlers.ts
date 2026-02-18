import { env } from '../env.js'
import logger from '../logger.js'
import * as memory from '../agents/memory.js'
import * as codebase from './codebase.js'
import * as git from './git.js'
import { config } from '../config.js'

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

export type ToolResult = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export async function handleTool(name: string, input: Record<string, unknown>, id: string): Promise<ToolResult> {
	if (name === 'read_file') {
		const { filePath, startLine, endLine } = input as { filePath: string; startLine?: number; endLine?: number }
		const MAX_LINES = config.tools.defaultReadWindow
		try {
			const fullContent = await codebase.readFile(env.workspacePath, filePath)
			const lines = fullContent.split('\n')
			const totalLines = lines.length
			if (startLine) {
				const start = Math.max(0, startLine - 1)
				const end = Math.min(endLine ?? lines.length, start + MAX_LINES)
				const content = lines.slice(start, end).map((l, i) => `${start + i + 1} | ${l}`).join('\n')
				const suffix = (endLine && endLine > end) ? `\n\n[Showing ${end - start} of ${endLine - start} requested lines. Use narrower ranges.]` : ''
				logger.info(`  → ${end - start} of ${totalLines} lines`)
				return { type: 'tool_result', tool_use_id: id, content: content + suffix }
			}
			if (totalLines > MAX_LINES) {
				const content = lines.slice(0, MAX_LINES).map((l, i) => `${i + 1} | ${l}`).join('\n')
				logger.info(`  → ${MAX_LINES} of ${totalLines} lines (truncated)`)
				return { type: 'tool_result', tool_use_id: id, content: content + `\n\n[Showing first ${MAX_LINES} of ${totalLines} lines. Use startLine/endLine to read specific sections.]` }
			}
			const content = lines.map((l, i) => `${i + 1} | ${l}`).join('\n')
			logger.info(`  → ${totalLines} lines`)
			return { type: 'tool_result', tool_use_id: id, content }
		} catch {
			return { type: 'tool_result', tool_use_id: id, content: `[File not found: ${filePath}]`, is_error: true }
		}
	}

	if (name === 'grep_search') {
		const { query, includePattern } = input as { query: string; includePattern?: string }
		const result = await codebase.grepSearch(env.workspacePath, query, { includePattern })
		const matchCount = result === 'No matches found.' ? 0 : result.split('\n').filter(l => !l.startsWith('(truncated')).length
		logger.info(`  → ${matchCount} match${matchCount !== 1 ? 'es' : ''}`)
		return { type: 'tool_result', tool_use_id: id, content: result }
	}

	if (name === 'file_search') {
		const { query } = input as { query: string }
		const result = await codebase.fileSearch(env.workspacePath, query)
		const matchCount = result === 'No files matched.' ? 0 : result.split('\n').length
		logger.info(`  → ${matchCount} file${matchCount !== 1 ? 's' : ''}`)
		return { type: 'tool_result', tool_use_id: id, content: result }
	}

	if (name === 'list_directory') {
		const { path } = input as { path: string }
		try {
			const result = await codebase.listDirectory(env.workspacePath, path)
			const entryCount = result.split('\n').filter(Boolean).length
			logger.info(`  → ${entryCount} entr${entryCount !== 1 ? 'ies' : 'y'}`)
			return { type: 'tool_result', tool_use_id: id, content: result }
		} catch {
			return { type: 'tool_result', tool_use_id: id, content: `[Directory not found: ${path}]`, is_error: true }
		}
	}

	if (name === 'note_to_self') {
		const { content } = input as { content: string }
		logger.info(`Saving note: "${content.slice(0, 200)}"`)
		const result = await memory.storeNote(content)
		return { type: 'tool_result', tool_use_id: id, content: result }
	}

	if (name === 'dismiss_note') {
		const { id: noteId } = input as { id: string }
		logger.info(`Dismissing note: ${noteId}`)
		const result = await memory.dismissNote(noteId)
		return { type: 'tool_result', tool_use_id: id, content: result }
	}

	if (name === 'recall_memory') {
		const { query, id: memoryId } = input as { query?: string; id?: string }
		if (memoryId) {
			logger.info(`Recalling memory by id: ${memoryId}`)
			const result = await memory.recallById(memoryId)
			return { type: 'tool_result', tool_use_id: id, content: result }
		}
		if (query) {
			logger.info(`Recalling memory by query: "${query}"`)
			const result = await memory.recall(query)
			return { type: 'tool_result', tool_use_id: id, content: result }
		}
		return { type: 'tool_result', tool_use_id: id, content: 'Provide a query or id to recall a memory.' }
	}

	if (name === 'git_diff') {
		const result = await git.getDiff()
		const diffLines = result.split('\n').length
		logger.info(`  → ${diffLines} line${diffLines !== 1 ? 's' : ''} of diff`)
		return { type: 'tool_result', tool_use_id: id, content: result }
	}

	if (name === 'edit_file') {
		const { filePath, oldString, newString } = input as { filePath: string; oldString: string; newString: string }
		const op: FileEdit = { type: 'replace', filePath, oldString, newString }
		try {
			await git.applyEdits([op])
			const fullContent = await codebase.readFile(env.workspacePath, filePath)
			const lines = fullContent.split('\n')
			const matchIdx = fullContent.indexOf(newString)
			if (matchIdx !== -1) {
				const lineNum = fullContent.slice(0, matchIdx).split('\n').length
				const changedLines = newString.split('\n').length
				logger.info(`  → Applied at L${lineNum}-${lineNum + changedLines - 1} (${lines.length} total)`)
			} else {
				logger.info(`  → Applied (${lines.length} total lines)`)
			}
			return { type: 'tool_result', tool_use_id: id, content: `Replaced text in ${filePath}` }
		} catch (err) {
			return { type: 'tool_result', tool_use_id: id, content: err instanceof Error ? err.message : String(err), is_error: true }
		}
	}

	if (name === 'create_file') {
		const { filePath, content } = input as { filePath: string; content: string }
		const op: FileCreate = { type: 'create', filePath, content }
		try {
			await git.applyEdits([op])
			const lineCount = content.split('\n').length
			logger.info(`  → Created with ${lineCount} line${lineCount !== 1 ? 's' : ''}`)
			return { type: 'tool_result', tool_use_id: id, content: `Created ${filePath}` }
		} catch (err) {
			return { type: 'tool_result', tool_use_id: id, content: err instanceof Error ? err.message : String(err), is_error: true }
		}
	}

	if (name === 'delete_file') {
		const { filePath } = input as { filePath: string }
		const op: FileDelete = { type: 'delete', filePath }
		try {
			await git.applyEdits([op])
			return { type: 'tool_result', tool_use_id: id, content: `Deleted ${filePath}` }
		} catch (err) {
			return { type: 'tool_result', tool_use_id: id, content: err instanceof Error ? err.message : String(err), is_error: true }
		}
	}

	if (name === 'done') {
		const { summary } = input as { summary: string }
		logger.info(`Builder summary: ${summary.slice(0, 200)}`)
		return { type: 'tool_result', tool_use_id: id, content: 'Implementation complete.' }
	}

	return { type: 'tool_result', tool_use_id: id, content: `Unknown tool: ${name}`, is_error: true }
}

export function getEditOperation(name: string, input: Record<string, unknown>): EditOperation | null {
	if (name === 'edit_file') {
		const { filePath, oldString, newString } = input as { filePath: string; oldString: string; newString: string }
		return { type: 'replace', filePath, oldString, newString }
	}
	if (name === 'create_file') {
		const { filePath, content } = input as { filePath: string; content: string }
		return { type: 'create', filePath, content }
	}
	if (name === 'delete_file') {
		const { filePath } = input as { filePath: string }
		return { type: 'delete', filePath }
	}
	return null
}
