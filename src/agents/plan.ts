import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import logger from '../logger.js'
import { handleTool } from '../tools/definitions.js'
import type { ToolResult } from '../tools/definitions.js'
import { callApi } from '../llm/api.js'
import { toolLogSuffix } from '../logger.js'

export interface Plan {
	title: string
	description: string
	implementation: string
}

export interface PlanResult {
	plan: Plan
	messages: Anthropic.MessageParam[]
}

export async function plan(): Promise<PlanResult> {
	logger.info('Asking LLM for a plan...')

	const messages: Anthropic.MessageParam[] = [
		{ role: 'user', content: 'Plan the next iteration.' },
	]

	const maxRounds = config.turns.maxPlanner
	for (let round = 0; round < maxRounds; round++) {
		logger.info(`Planner turn ${round + 1}/${maxRounds}`)
		const response = await callApi('planner', messages)
		logger.info(`Planner turn ${round + 1} usage: ${response.usage.input_tokens} in + ${response.usage.output_tokens} out tokens`)

		const toolBlocks = response.content.filter(c => c.type === 'tool_use')
		if (toolBlocks.length === 0) {
			throw new Error('LLM did not return a tool_use block during planning')
		}

		const submitBlock = toolBlocks.find(b => b.type === 'tool_use' && b.name === 'submit_plan')
		if (submitBlock && submitBlock.type === 'tool_use') {
			const input = submitBlock.input as Plan

			logger.info(`Plan: "${input.title}"`)
			messages.push({ role: 'assistant', content: response.content })
			return { plan: input, messages }
		}

		const toolResults: ToolResult[] = []

		for (const toolBlock of toolBlocks) {
			if (toolBlock.type !== 'tool_use') continue
			logger.info(`Planner calling ${toolBlock.name}${toolLogSuffix(toolBlock)}`)

			const result = await handleTool(toolBlock.name, toolBlock.input as Record<string, unknown>, toolBlock.id)
			toolResults.push(result)
		}

		toolResults[toolResults.length - 1].content += `\n\n(Turn ${round + 1} of ${maxRounds} — hard limit. Call submit_plan when ready.)`

		messages.push({ role: 'assistant', content: response.content })
		messages.push({ role: 'user', content: toolResults })
	}

	throw new Error(`Planner exceeded maximum rounds (${maxRounds}) without submitting a plan`)
}
