import Anthropic from '@anthropic-ai/sdk'

export function compressToolResult(toolName: string, toolInput: Record<string, unknown>, resultContent: string): string {
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

export function compressOldMessages(messages: Anthropic.MessageParam[], keepFirst: number = 1, keepLast: number = 4): void {
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
