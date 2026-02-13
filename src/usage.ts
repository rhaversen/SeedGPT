import logger from './logger.js'
import UsageModel from './models/Usage.js'

interface ModelPricing {
	inputPerMTok: number
	cacheWrite5mPerMTok: number
	cacheWrite1hPerMTok: number
	cacheReadPerMTok: number
	outputPerMTok: number
}

const PRICING: Record<string, ModelPricing> = {
	'claude-opus-4-6':   { inputPerMTok: 5,    cacheWrite5mPerMTok: 6.25,  cacheWrite1hPerMTok: 10,   cacheReadPerMTok: 0.50, outputPerMTok: 25   },
	'claude-sonnet-4-5': { inputPerMTok: 3,    cacheWrite5mPerMTok: 3.75,  cacheWrite1hPerMTok: 6,    cacheReadPerMTok: 0.30, outputPerMTok: 15   },
	'claude-haiku-4-5':  { inputPerMTok: 1,    cacheWrite5mPerMTok: 1.25,  cacheWrite1hPerMTok: 2,    cacheReadPerMTok: 0.10, outputPerMTok: 5    },
}

// Defaults to the most expensive tier (opus pricing) so unknown models never underestimate cost
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 5, cacheWrite5mPerMTok: 6.25, cacheWrite1hPerMTok: 10, cacheReadPerMTok: 0.50, outputPerMTok: 25 }

export interface ApiUsage {
	input_tokens: number
	output_tokens: number
	cache_creation_input_tokens?: number | null
	cache_read_input_tokens?: number | null
	cache_creation?: {
		ephemeral_5m_input_tokens: number
		ephemeral_1h_input_tokens: number
	} | null
}

interface UsageEntry {
	caller: string
	model: string
	inputTokens: number
	outputTokens: number
	cacheWrite5mTokens: number
	cacheWrite1hTokens: number
	cacheReadTokens: number
	cost: number
}

const entries: UsageEntry[] = []

export function computeCost(model: string, usage: ApiUsage): number {
	const pricing = PRICING[model] ?? DEFAULT_PRICING

	const totalCacheWrite = usage.cache_creation_input_tokens ?? 0
	const cacheRead = usage.cache_read_input_tokens ?? 0

	let cacheWrite5m: number
	let cacheWrite1h: number
	if (usage.cache_creation) {
		cacheWrite5m = usage.cache_creation.ephemeral_5m_input_tokens
		cacheWrite1h = usage.cache_creation.ephemeral_1h_input_tokens
	} else {
		cacheWrite5m = totalCacheWrite
		cacheWrite1h = 0
	}

	const uncached = usage.input_tokens - totalCacheWrite - cacheRead

	const inputCost = uncached * pricing.inputPerMTok
		+ cacheWrite5m * pricing.cacheWrite5mPerMTok
		+ cacheWrite1h * pricing.cacheWrite1hPerMTok
		+ cacheRead * pricing.cacheReadPerMTok
	const outputCost = usage.output_tokens * pricing.outputPerMTok

	return (inputCost + outputCost) / 1_000_000
}

export function trackUsage(caller: string, model: string, usage: ApiUsage): void {
	const cost = computeCost(model, usage)
	const totalCacheWrite = usage.cache_creation_input_tokens ?? 0
	entries.push({
		caller, model,
		inputTokens: usage.input_tokens,
		outputTokens: usage.output_tokens,
		cacheWrite5mTokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? totalCacheWrite,
		cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
		cacheReadTokens: usage.cache_read_input_tokens ?? 0,
		cost,
	})
}

export function logSummary(): void {
	if (entries.length === 0) {
		logger.info('No API calls recorded.')
		return
	}

	interface Agg { inputTokens: number; outputTokens: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; cost: number; calls: number }
	const emptyAgg = (): Agg => ({ inputTokens: 0, outputTokens: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, cost: 0, calls: 0 })

	const byModel = new Map<string, Agg>()
	const byCaller = new Map<string, Agg>()
	const totals = emptyAgg()

	for (const e of entries) {
		totals.inputTokens += e.inputTokens
		totals.outputTokens += e.outputTokens
		totals.cacheWrite5m += e.cacheWrite5mTokens
		totals.cacheWrite1h += e.cacheWrite1hTokens
		totals.cacheRead += e.cacheReadTokens
		totals.cost += e.cost

		const m = byModel.get(e.model) ?? emptyAgg()
		m.inputTokens += e.inputTokens
		m.outputTokens += e.outputTokens
		m.cacheWrite5m += e.cacheWrite5mTokens
		m.cacheWrite1h += e.cacheWrite1hTokens
		m.cacheRead += e.cacheReadTokens
		m.cost += e.cost
		m.calls++
		byModel.set(e.model, m)

		const c = byCaller.get(e.caller) ?? emptyAgg()
		c.inputTokens += e.inputTokens
		c.outputTokens += e.outputTokens
		c.cacheWrite5m += e.cacheWrite5mTokens
		c.cacheWrite1h += e.cacheWrite1hTokens
		c.cacheRead += e.cacheReadTokens
		c.cost += e.cost
		c.calls++
		byCaller.set(e.caller, c)
	}

	const cachePct = totals.inputTokens > 0 ? Math.round((totals.cacheRead / totals.inputTokens) * 100) : 0
	logger.info(`Usage: ${entries.length} API calls | ${totals.inputTokens} in (${cachePct}% cached) + ${totals.outputTokens} out tokens | $${totals.cost.toFixed(4)}`)
	for (const [caller, s] of [...byCaller].sort((a, b) => b[1].cost - a[1].cost)) {
		logger.info(`  ${caller}: ${s.calls} calls | ${s.inputTokens} in + ${s.outputTokens} out | $${s.cost.toFixed(4)}`)
	}
	for (const [model, s] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
		logger.info(`  ${model}: ${s.calls} calls | ${s.inputTokens} in + ${s.outputTokens} out | $${s.cost.toFixed(4)}`)
	}
}

export async function saveUsageData(planTitle: string): Promise<void> {
	try {
		let totalInput = 0
		let totalOutput = 0
		let totalCacheWrite5m = 0
		let totalCacheWrite1h = 0
		let totalCacheRead = 0
		let totalCost = 0
		const callerMap = new Map<string, { caller: string; model: string; calls: number; inputTokens: number; outputTokens: number; cacheWrite5mTokens: number; cacheWrite1hTokens: number; cacheReadTokens: number; cost: number }>()
		for (const e of entries) {
			totalInput += e.inputTokens
			totalOutput += e.outputTokens
			totalCacheWrite5m += e.cacheWrite5mTokens
			totalCacheWrite1h += e.cacheWrite1hTokens
			totalCacheRead += e.cacheReadTokens
			totalCost += e.cost
			const key = `${e.caller}:${e.model}`
			const existing = callerMap.get(key) ?? { caller: e.caller, model: e.model, calls: 0, inputTokens: 0, outputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, cost: 0 }
			existing.calls++
			existing.inputTokens += e.inputTokens
			existing.outputTokens += e.outputTokens
			existing.cacheWrite5mTokens += e.cacheWrite5mTokens
			existing.cacheWrite1hTokens += e.cacheWrite1hTokens
			existing.cacheReadTokens += e.cacheReadTokens
			existing.cost += e.cost
			callerMap.set(key, existing)
		}

		await UsageModel.create({
			planTitle,
			totalCalls: entries.length,
			totalInputTokens: totalInput,
			totalOutputTokens: totalOutput,
			totalCacheWrite5mTokens: totalCacheWrite5m,
			totalCacheWrite1hTokens: totalCacheWrite1h,
			totalCacheReadTokens: totalCacheRead,
			totalCost,
			breakdown: [...callerMap.values()],
		})

		logger.info(`Saved usage data for "${planTitle}"`)
		entries.length = 0
	} catch (err) {
		logger.error('Failed to save usage data', { error: err })
	}
}

export function resetUsage(): void {
	entries.length = 0
}
