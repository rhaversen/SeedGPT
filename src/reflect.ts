import Anthropic from '@anthropic-ai/sdk'
import logger, { getLogBuffer } from './logger.js'
import { callApi } from './api.js'
import { summarizeMessages } from './compression.js'

export async function reflect(outcome: string, plannerMessages: Anthropic.MessageParam[], builderMessages: Anthropic.MessageParam[]): Promise<string> {
	logger.info('Self-reflecting on iteration...')

	const logs = getLogBuffer()
		.filter(e => e.level !== 'debug')
		.map(e => `${e.timestamp.slice(11, 19)} [${e.level.toUpperCase()}] ${e.message}`)
		.join('\n')

	const transcript = [
		'## Iteration Log',
		logs,
		'## Planner Conversation',
		summarizeMessages(plannerMessages),
		'## Builder Conversation',
		summarizeMessages(builderMessages),
		'## Outcome',
		outcome,
	].join('\n\n')

	const response = await callApi('reflect', [{
		role: 'user',
		content: transcript,
	}])
	logger.info(`Reflect usage: ${response.usage.input_tokens} in + ${response.usage.output_tokens} out tokens`)

	const text = response.content.find(c => c.type === 'text')?.text ?? ''
	logger.info(`Reflection: ${text.slice(0, 200)}`)
	return text.trim()
}
