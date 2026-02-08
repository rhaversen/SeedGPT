import Anthropic from '@anthropic-ai/sdk'
import MemoryModel from './models/Memory.js'
import { config } from './config.js'
import logger from './logger.js'

const client = new Anthropic({ apiKey: config.anthropicApiKey })

async function summarize(content: string): Promise<string> {
	const response = await client.messages.create({
		model: config.planModel,
		max_tokens: 256,
		system: 'Write a single concise sentence summarizing the following. Be specific — include names, numbers, outcomes. No preamble.',
		messages: [{ role: 'user', content }],
	})
	const text = response.content.find(c => c.type === 'text')?.text ?? content.slice(0, 200)
	return text.trim()
}

export async function store(content: string): Promise<void> {
	const summary = await summarize(content)
	await MemoryModel.create({ content, summary })
	logger.debug(`Stored memory: ${summary.slice(0, 80)}`)
}

export async function pin(content: string): Promise<string> {
	const summary = await summarize(content)
	const memory = await MemoryModel.create({ content, summary, pinned: true })
	logger.debug(`Pinned note: ${summary.slice(0, 80)}`)
	return `Note saved (${memory._id}): ${summary}`
}

export async function unpin(id: string): Promise<string> {
	const memory = await MemoryModel.findById(id)
	if (!memory) return `No note found with id "${id}".`
	if (!memory.pinned) return `That memory is not a note.`
	memory.pinned = false
	await memory.save()
	logger.debug(`Dismissed note: ${memory.summary.slice(0, 80)}`)
	return `Note dismissed: ${memory.summary}`
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

export async function getContext(): Promise<string> {
	const budget = config.memoryTokenBudget
	let tokensUsed = 0

	const notes = await MemoryModel
		.find({ pinned: true })
		.sort({ createdAt: -1 })
		.select('_id summary')
		.lean()

	const sections: string[] = []

	if (notes.length > 0) {
		const header = '## Notes to self\n'
		const lines = notes.map(m => `- (${m._id}) ${m.summary}`)
		const notesSection = header + lines.join('\n')
		tokensUsed += estimateTokens(notesSection)
		sections.push(notesSection)
	}

	const remaining = budget - tokensUsed
	if (remaining > 0) {
		const recent = await MemoryModel
			.find({ pinned: false })
			.sort({ createdAt: -1 })
			.select('_id summary createdAt')
			.lean()

		const header = '## Past\n'
		let pastTokens = estimateTokens(header)
		const lines: string[] = []

		for (const m of recent) {
			const date = new Date(m.createdAt).toISOString().slice(0, 19).replace('T', ' ')
			const line = `- (${m._id}) [${date}] ${m.summary}`
			const lineTokens = estimateTokens(line + '\n')
			if (tokensUsed + pastTokens + lineTokens > budget) break
			pastTokens += lineTokens
			lines.push(line)
		}

		if (lines.length > 0) {
			sections.push(header + lines.join('\n'))
		}
	}

	if (sections.length === 0) {
		return 'No memories yet. This is your first run.'
	}

	return sections.join('\n\n')
}

export async function recall(query: string): Promise<string> {
	let memories = await MemoryModel
		.find({ $text: { $search: query } }, { score: { $meta: 'textScore' } })
		.sort({ score: { $meta: 'textScore' } })
		.limit(5)
		.lean()

	if (memories.length === 0) {
		const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		memories = await MemoryModel
			.find({ $or: [{ summary: new RegExp(escaped, 'i') }, { content: new RegExp(escaped, 'i') }] })
			.sort({ createdAt: -1 })
			.limit(5)
			.lean()
	}

	if (memories.length === 0) return `No memories matching "${query}".`

	return memories.map(m => {
		const date = new Date(m.createdAt).toISOString().slice(0, 19).replace('T', ' ')
		return `**${m._id}** [${date}]\n${m.content}`
	}).join('\n\n---\n\n')
}

export async function recallById(id: string): Promise<string> {
	const memory = await MemoryModel.findById(id).lean()
	if (!memory) return `No memory with id "${id}".`

	const date = new Date(memory.createdAt).toISOString().slice(0, 19).replace('T', ' ')
	return `**${memory._id}** [${date}]\n${memory.content}`
}
