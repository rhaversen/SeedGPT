import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger from './logger.js'
import { compressConversation } from './compression.js'
import { PLANNER_TOOLS, BUILDER_TOOLS } from './tools/definitions.js'
import { getCodebaseContext } from './tools/codebase.js'
import { SYSTEM_PLAN, SYSTEM_BUILD, SYSTEM_REFLECT, SYSTEM_MEMORY, SYSTEM_SUMMARIZE } from './prompts.js'
import GeneratedModel, { computeCost, type ApiUsage } from './models/Generated.js'

export type Phase = 'planner' | 'builder' | 'reflect' | 'memory' | 'summarizer'

const client = new Anthropic({ apiKey: config.anthropicApiKey })

const PHASE_EXTRAS: Record<Phase, {
	system: string
	tools?: Anthropic.Tool[]
}> = {
	planner: { system: SYSTEM_PLAN, tools: PLANNER_TOOLS },
	builder: { system: SYSTEM_BUILD, tools: BUILDER_TOOLS },
	reflect: { system: SYSTEM_REFLECT },
	memory: { system: SYSTEM_MEMORY },
	summarizer: { system: SYSTEM_SUMMARIZE },
}

async function buildParams(phase: Phase, messages: Anthropic.MessageParam[], tools?: Anthropic.Tool[]): Promise<Anthropic.MessageCreateParamsNonStreaming> {
	if (phase !== 'memory' && phase !== 'summarizer') await compressConversation(messages)

	const { model, maxTokens } = config.phases[phase]
	const extras = PHASE_EXTRAS[phase]
	const system: Anthropic.TextBlockParam[] = []
	system.push({ type: 'text', text: extras.system, cache_control: { type: 'ephemeral' as const } })

	if (phase === 'builder' || phase === 'planner') {
		const codebaseContext = await getCodebaseContext(config.workspacePath)
		system.push({ type: 'text', text: `\n\n${codebaseContext}`, cache_control: { type: 'ephemeral' as const } })
	}

	const allTools = [...(extras.tools ?? []), ...(tools ?? [])]

	return {
		model,
		max_tokens: maxTokens,
		system,
		messages,
		...(allTools.length > 0 && { tools: allTools }),
	}
}

async function recordGenerated(
	phase: string,
	params: Anthropic.MessageCreateParamsNonStreaming,
	response: Anthropic.Message,
	batch: boolean,
): Promise<void> {
	const usage = response.usage as ApiUsage
	const cost = computeCost(params.model, usage, { batch })
	const totalCacheWrite = usage.cache_creation_input_tokens ?? 0
	try {
		await GeneratedModel.create({
			phase,
			modelId: params.model,
			system: params.system ?? [],
			messages: params.messages,
			response: response.content,
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			cacheWrite5mTokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? totalCacheWrite,
			cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
			cacheReadTokens: usage.cache_read_input_tokens ?? 0,
			cost,
			batch,
			stopReason: response.stop_reason ?? 'unknown',
		})
	} catch (err) {
		logger.error('Failed to save generated data', { error: err })
	}
}

export async function callApi(phase: Phase, messages: Anthropic.MessageParam[], tools?: Anthropic.Tool[]): Promise<Anthropic.Message> {
	const params = await buildParams(phase, messages, tools)
	const { maxRetries, initialRetryDelay, maxRetryDelay } = config.api
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await client.messages.create(params)
			await recordGenerated(phase, params, response, false)
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

export interface BatchRequest {
	phase: Phase
	messages: Anthropic.MessageParam[]
	tools?: Anthropic.Tool[]
}

export async function callBatchApi(requests: BatchRequest[]): Promise<Anthropic.Message[]> {
	if (requests.length === 0) return []

	const entries = await Promise.all(
		requests.map(async r => ({ phase: r.phase, params: await buildParams(r.phase, r.messages, r.tools) }))
	)

	const idPrefix = `req-${Date.now()}-`
	const batchRequests = entries.map((e, i) => ({ custom_id: `${idPrefix}${i}`, params: e.params }))

	logger.info(`Submitting batch with ${entries.length} request(s)...`)
	const batch = await client.messages.batches.create({ requests: batchRequests })

	const { pollInterval, maxPollInterval, pollBackoff } = config.batch
	let delay: number = pollInterval
	let status: string = batch.processing_status

	while (status !== 'ended') {
		await new Promise(r => setTimeout(r, delay))
		const poll = await client.messages.batches.retrieve(batch.id)
		status = poll.processing_status
		logger.debug(`Batch ${batch.id} status: ${status}`)
		delay = Math.min(maxPollInterval, delay * pollBackoff)
	}

	const resultMap = new Map<string, Anthropic.Message>()
	const decoder = await client.messages.batches.results(batch.id)

	for await (const entry of decoder) {
		if (entry.result.type === 'succeeded') {
			resultMap.set(entry.custom_id, entry.result.message)
		} else {
			const detail = entry.result.type === 'errored'
				? JSON.stringify((entry.result as Anthropic.Messages.Batches.MessageBatchErroredResult).error)
				: entry.result.type
			throw new Error(`Batch request ${entry.custom_id} failed: ${detail}`)
		}
	}

	if (resultMap.size !== entries.length) {
		const missing = entries.map((_, i) => i).filter(i => !resultMap.has(`${idPrefix}${i}`))
		throw new Error(`Batch completed but missing results for indices: ${missing.join(', ')}`)
	}

	const ordered: Anthropic.Message[] = []
	for (let i = 0; i < entries.length; i++) {
		const response = resultMap.get(`${idPrefix}${i}`)!
		await recordGenerated(entries[i].phase, entries[i].params, response, true)
		ordered.push(response)
	}

	logger.info(`Batch completed: ${resultMap.size} result(s) (50% discount applied)`)
	return ordered
}
