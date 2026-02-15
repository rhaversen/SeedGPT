import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'
import logger from '../logger.js'
import { compressConversation } from '../agents/compression.js'
import { PLANNER_TOOLS, BUILDER_TOOLS } from '../tools/definitions.js'
import { getCodebaseContext } from '../tools/codebase.js'
import { SYSTEM_PLAN, SYSTEM_BUILD, SYSTEM_REFLECT, SYSTEM_MEMORY, SYSTEM_SUMMARIZE } from '../llm/prompts.js'
import GeneratedModel, { computeCost, type ApiUsage } from '../models/Generated.js'
import { getMemoryContext } from '../agents/memory.js'
import { getRecentLog } from '../tools/git.js'
import { getLatestMainCoverage } from '../tools/github.js'

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

	// Builder and planner gets codebase context
	if (phase === 'builder' || phase === 'planner') {
		const codebaseContext = await getCodebaseContext(config.workspacePath)
		system.push({ type: 'text', text: `\n\n${codebaseContext}`, cache_control: { type: 'ephemeral' as const } })
	}

	// Add role-specific system prompt
	system.push({ type: 'text', text: extras.system, cache_control: { type: 'ephemeral' as const } })

	// Planner also gets memory and recent git log for situational awareness to make informed plans.
	// Memory is excluded from the builder since it should focus on the current plan and implementation,
	// not be distracted by past memories which may or may not be relevant to the current task.
	if (phase === 'planner') {
		const memoryContext = await getMemoryContext()
		system.push({ type: 'text', text: `\n\n${memoryContext}`, cache_control: { type: 'ephemeral' as const } })
		const gitLog = await getRecentLog()
		system.push({ type: 'text', text: `\n\nRecent git log:\n${gitLog}`, cache_control: { type: 'ephemeral' as const } })
		const coverage = await getLatestMainCoverage()
		if (coverage) {
			system.push({ type: 'text', text: `\n\n## Code Coverage (last CI run on main)\n${coverage}`, cache_control: { type: 'ephemeral' as const } })
		}
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

let activeIterationId = ''

export function setIterationId(id: string): void {
	activeIterationId = id
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
			iterationId: activeIterationId,
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
		if (status !== 'ended') {
			const nextDelay = Math.min(maxPollInterval, delay * pollBackoff)
			logger.info(`Batch ${batch.id} still ${status}, retrying in ${Math.round(nextDelay / 1000)}s...`)
			delay = nextDelay
		}
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
	let totalCacheRead = 0
	let totalCacheWrite = 0
	let totalInput = 0
	for (let i = 0; i < entries.length; i++) {
		const response = resultMap.get(`${idPrefix}${i}`)!
		const usage = response.usage as ApiUsage
		totalCacheRead += usage.cache_read_input_tokens ?? 0
		totalCacheWrite += usage.cache_creation_input_tokens ?? 0
		totalInput += usage.input_tokens
		await recordGenerated(entries[i].phase, entries[i].params, response, true)
		ordered.push(response)
	}

	const cacheStatus = totalCacheRead > 0
		? `cache hit (${totalCacheRead} read, ${totalCacheWrite} written)`
		: totalCacheWrite > 0 ? `cache miss (${totalCacheWrite} written, 0 read)` : 'no cache'
	logger.info(`Batch completed: ${resultMap.size} result(s), ${totalInput} input tokens, ${cacheStatus}`)
	return ordered
}
