import logger from './logger.js'
import UsageModel from './models/Usage.js'

interface ModelPricing {
	inputPerMTok: number
	outputPerMTok: number
}

const PRICING: Record<string, ModelPricing> = {
	'claude-opus-4-6':   { inputPerMTok: 5, outputPerMTok: 25 },
	'claude-sonnet-4-5': { inputPerMTok: 3, outputPerMTok: 15 },
	'claude-haiku-4-5':  { inputPerMTok: 1, outputPerMTok: 5  },
}

// Defaults to the most expensive tier (opus pricing) so unknown models never underestimate cost
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 5, outputPerMTok: 25 }

interface UsageEntry {
	caller: string
	model: string
	inputTokens: number
	outputTokens: number
	cost: number
}

const entries: UsageEntry[] = []

export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
	const pricing = PRICING[model] ?? DEFAULT_PRICING
	return (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1_000_000
}

export function trackUsage(caller: string, model: string, usage: { input_tokens: number; output_tokens: number }): void {
	const cost = computeCost(model, usage.input_tokens, usage.output_tokens)
	entries.push({ caller, model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cost })
}

export function logSummary(): void {
	if (entries.length === 0) {
		logger.info('No API calls recorded.')
		return
	}

	const byModel = new Map<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }>()
	const byCaller = new Map<string, { inputTokens: number; outputTokens: number; cost: number; calls: number }>()

	let totalInput = 0
	let totalOutput = 0
	let totalCost = 0

	for (const e of entries) {
		totalInput += e.inputTokens
		totalOutput += e.outputTokens
		totalCost += e.cost

		const m = byModel.get(e.model) ?? { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 }
		m.inputTokens += e.inputTokens
		m.outputTokens += e.outputTokens
		m.cost += e.cost
		m.calls++
		byModel.set(e.model, m)

		const c = byCaller.get(e.caller) ?? { inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 }
		c.inputTokens += e.inputTokens
		c.outputTokens += e.outputTokens
		c.cost += e.cost
		c.calls++
		byCaller.set(e.caller, c)
	}

	logger.info(`Usage: ${entries.length} API calls | ${totalInput} in + ${totalOutput} out tokens | $${totalCost.toFixed(4)}`)
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
		let totalCost = 0
		const callerMap = new Map<string, { caller: string; model: string; calls: number; inputTokens: number; outputTokens: number; cost: number }>()
		for (const e of entries) {
			totalInput += e.inputTokens
			totalOutput += e.outputTokens
			totalCost += e.cost
			const key = `${e.caller}:${e.model}`
			const existing = callerMap.get(key) ?? { caller: e.caller, model: e.model, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
			existing.calls++
			existing.inputTokens += e.inputTokens
			existing.outputTokens += e.outputTokens
			existing.cost += e.cost
			callerMap.set(key, existing)
		}

		await UsageModel.create({
			planTitle,
			totalCalls: entries.length,
			totalInputTokens: totalInput,
			totalOutputTokens: totalOutput,
			totalCost,
			breakdown: [...callerMap.values()],
		})

		logger.info(`Saved usage data for "${planTitle}"`)
	} catch (err) {
		logger.error('Failed to save usage data', { error: err })
	}
}

export function resetUsage(): void {
	entries.length = 0
}
