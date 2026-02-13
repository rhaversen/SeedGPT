import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.js'
import logger from './logger.js'
import { compressConversation } from './compression.js'
import { PLANNER_TOOLS, BUILDER_TOOLS } from './tools/definitions.js'
import { getCodebaseContext } from './tools/codebase.js'
import { SYSTEM_PLAN, SYSTEM_BUILD, SYSTEM_REFLECT, SYSTEM_MEMORY } from './prompts.js'
import GeneratedModel, { computeCost, type ApiUsage } from './models/Generated.js'

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

async function buildParams(phase: Phase, messages: Anthropic.MessageParam[]): Promise<Anthropic.MessageCreateParamsNonStreaming> {
	if (phase !== 'memory') await compressConversation(messages)

	const { model, maxTokens } = config.phases[phase]
	const extras = PHASE_EXTRAS[phase]
	const system: Anthropic.TextBlockParam[] = []
	system.push({ type: 'text', text: extras.system, cache_control: { type: 'ephemeral' as const } })

	if (phase === 'builder' || phase === 'planner') {
		const codebaseContext = await getCodebaseContext(config.workspacePath)
		system.push({ type: 'text', text: `\n\n${codebaseContext}`, cache_control: { type: 'ephemeral' as const } })
	}

	return {
		model,
		max_tokens: maxTokens,
		system,
		messages,
		...(extras.tools && { tools: extras.tools }),
	}
}

async function recordGenerated(phase: Phase, model: string, system: Anthropic.TextBlockParam[], messages: Anthropic.MessageParam[], response: Anthropic.Message, usage: ApiUsage, cost: number, batch: boolean): Promise<void> {
	const totalCacheWrite = usage.cache_creation_input_tokens ?? 0
	try {
		await GeneratedModel.create({
			phase,
			modelId: model,
			system,
			messages,
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

export async function callApi(phase: Phase, messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> {
	const params = await buildParams(phase, messages)

	const { maxRetries, initialRetryDelay, maxRetryDelay } = config.api
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await client.messages.create(params)
			const cost = computeCost(params.model, response.usage)
			await recordGenerated(phase, params.model, params.system as Anthropic.TextBlockParam[], messages, response, response.usage, cost, false)
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
}

export async function callBatchApi(requests: BatchRequest[]): Promise<Anthropic.Message[]> {
	if (requests.length === 0) return []

	const prepared = await Promise.all(
		requests.map(async (r, i) => ({ idx: i, phase: r.phase, params: await buildParams(r.phase, r.messages) }))
	)

	const idPrefix = `req-${Date.now()}-`
	logger.info(`Submitting batch with ${requests.length} request(s)...`)
	const batch = await client.messages.batches.create({
		requests: prepared.map(p => ({ custom_id: `${idPrefix}${p.idx}`, params: p.params })),
	})

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

	const byId = new Map(prepared.map(p => [`${idPrefix}${p.idx}`, p]))
	const resultMap = new Map<number, Anthropic.Message>()
	const decoder = await client.messages.batches.results(batch.id)

	for await (const entry of decoder) {
		const req = byId.get(entry.custom_id)
		if (!req) continue

		if (entry.result.type === 'succeeded') {
			const response = entry.result.message
			const cost = computeCost(req.params.model, response.usage, { batch: true })
			await recordGenerated(req.phase, req.params.model, req.params.system as Anthropic.TextBlockParam[], requests[req.idx].messages, response, response.usage, cost, true)
			resultMap.set(req.idx, response)
		} else {
			const detail = entry.result.type === 'errored'
				? JSON.stringify((entry.result as Anthropic.Messages.Batches.MessageBatchErroredResult).error)
				: entry.result.type
			throw new Error(`Batch request ${req.idx} failed: ${detail}`)
		}
	}

	if (resultMap.size !== requests.length) {
		const missing = prepared.filter(p => !resultMap.has(p.idx)).map(p => p.idx)
		throw new Error(`Batch completed but missing results for indices: ${missing.join(', ')}`)
	}

	logger.info(`Batch completed: ${resultMap.size} result(s) (50% discount applied)`)
	return prepared.map(p => resultMap.get(p.idx)!)
}
