import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger from './logger.js'
import { compressOldMessages } from './compression.js'
import { trackUsage } from './usage.js'
import { PLANNER_TOOLS, BUILDER_TOOLS } from './tools/definitions.js'
import { SYSTEM_PLAN, SYSTEM_BUILD, SYSTEM_REFLECT } from './prompts.js'

export type Phase = 'planner' | 'builder' | 'reflect'

type CachedSystemBlock = { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }

const client = new Anthropic({ apiKey: config.anthropicApiKey })

function cachedSystem(text: string): CachedSystemBlock[] {
	return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]
}

const PHASE_EXTRAS: Record<Phase, {
	system: string
	tools?: Anthropic.Tool[]
}> = {
	planner: { system: SYSTEM_PLAN, tools: PLANNER_TOOLS },
	builder: { system: SYSTEM_BUILD, tools: BUILDER_TOOLS },
	reflect: { system: SYSTEM_REFLECT },
}

export async function callApi(phase: Phase, messages: Anthropic.MessageParam[], extraSystem?: string): Promise<Anthropic.Message> {
	compressOldMessages(messages)
	const { model, maxTokens } = config.phases[phase]
	const extras = PHASE_EXTRAS[phase]
	const system: CachedSystemBlock[] = [
		...cachedSystem(extras.system),
		...(extraSystem ? [{ type: 'text' as const, text: extraSystem, cache_control: { type: 'ephemeral' as const } }] : []),
	]

	const params: Anthropic.MessageCreateParamsNonStreaming = {
		model,
		max_tokens: maxTokens,
		system,
		messages,
		...(extras.tools && { tools: extras.tools }),
	}

	const { maxRetries, initialRetryDelay, maxRetryDelay } = config.api
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await client.messages.create(params)
			trackUsage(phase, model, response.usage)
			return response
		} catch (error: unknown) {
			const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 0
			if (status === 429 && attempt < maxRetries) {
				const delay = Math.min(maxRetryDelay, initialRetryDelay * 2 ** attempt)
				logger.warn(`Rate limited, waiting ${Math.round(delay / 1000)}s before retry (attempt ${attempt + 1}/${maxRetries})...`)
				await new Promise(r => setTimeout(r, delay))
				continue
			}
			throw error
		}
	}
}
