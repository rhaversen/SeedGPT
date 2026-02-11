import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger from './logger.js'
import { compressOldMessages } from './compression.js'
import { trackUsage } from './usage.js'
import { PLANNER_TOOLS, BUILDER_TOOLS } from './tools/definitions.js'
import { getCodebaseContext } from './tools/codebase.js'
import { SYSTEM_PLAN, SYSTEM_BUILD, SYSTEM_REFLECT, SYSTEM_MEMORY } from './prompts.js'

export type Phase = 'planner' | 'builder' | 'reflect' | 'memory'

const client = new Anthropic({ apiKey: config.anthropicApiKey })

const PHASE_EXTRAS: Record<Phase, {
	system: string
	tools?: Anthropic.Tool[]
}> = {
	planner: { system: SYSTEM_PLAN, tools: PLANNER_TOOLS },
	builder: { system: SYSTEM_BUILD, tools: BUILDER_TOOLS },
	reflect: { system: SYSTEM_REFLECT },
	memory: { system: SYSTEM_MEMORY },
}

export async function callApi(phase: Phase, messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
	if (phase !== 'memory') compressOldMessages(messages)

	const { model, maxTokens } = config.phases[phase]
	const extras = PHASE_EXTRAS[phase]
	const system: Anthropic.TextBlockParam[] = []
	system.push({ type: 'text', text: extras.system, cache_control: { type: 'ephemeral' as const } })

	if (phase === 'builder' || phase === 'planner') {
		const codebaseContext = await getCodebaseContext(config.workspacePath)
		if (phase === 'planner') {
			system.push({ type: 'text', text: `\n\n${codebaseContext}`, cache_control: { type: 'ephemeral' as const } })
		} else {
			// No cache for the builder context, because it will keep changing
			system.push({ type: 'text', text: `\n\n${codebaseContext}` })
		}
	}

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
