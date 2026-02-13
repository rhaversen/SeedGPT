import Anthropic from '@anthropic-ai/sdk'

// Redact tool use information to avoid model hallucination - strictly explain that the result was removed
export function redactToolResult(toolName: string, toolInput: Record<string, unknown>, resultContent: string): string {
	switch (toolName) {
	case 'read_file': {
		const path = toolInput.filePath as string
		return `[Content of ${path} was removed from context — you do NOT know what this file contains. Re-read it if needed.]`
	}
	case 'grep_search': {
		const query = toolInput.query as string
		return `[Search results for "${query.slice(0, 60)}" were removed from context — search again if needed.]`
	}
	case 'file_search':
		return `[File search results were removed from context — search again if needed.]`
	case 'list_directory':
		return `[Directory listing for ${toolInput.path} was removed from context — list again if needed.]`
	case 'git_diff':
		return `[Diff was removed from context — run git_diff again if needed.]`
	case 'codebase_context':
	case 'codebase_diff':
		return `[Codebase context was removed — call again if needed.]`
	case 'note_to_self':
	case 'dismiss_note':
	case 'recall_memory':
		return resultContent
	default:
		return resultContent
	}
}

export function compressOldMessages(messages: Anthropic.MessageParam[]): void {
	if (messages.length < 3) return

	let lastUserIdx = -1
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === 'user') { lastUserIdx = i; break }
	}

	const toolNameMap = new Map<string, { name: string; input: Record<string, unknown> }>()
	for (const msg of messages) {
		if (msg.role === 'assistant' && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === 'tool_use') {
					toolNameMap.set(block.id, { name: block.name, input: block.input as Record<string, unknown> })
				}
			}
		}
	}

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]
		if (msg.role !== 'user' || i === lastUserIdx || !Array.isArray(msg.content)) continue

		let changed = false
		const content = (msg.content as Anthropic.ContentBlockParam[]).map(block => {
			if (block.type !== 'tool_result') return block
			const text = typeof block.content === 'string' ? block.content : ''
			if (text.length <= 100) return block

			const tool = toolNameMap.get(block.tool_use_id)
			changed = true
			if (tool) return { ...block, content: redactToolResult(tool.name, tool.input, text) }
			return { ...block, content: text.slice(0, 100) + '\n[...compressed]' }
		})
		if (changed) messages[i] = { ...msg, content }
	}
}
