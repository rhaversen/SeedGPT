import mongoose, { type Document, type Model, Schema } from 'mongoose'

interface CallerBreakdown {
	caller: string
	model: string
	calls: number
	inputTokens: number
	outputTokens: number
	cacheWrite5mTokens: number
	cacheWrite1hTokens: number
	cacheReadTokens: number
	cost: number
}

export interface IUsage extends Document {
	planTitle: string
	totalCalls: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCacheWrite5mTokens: number
	totalCacheWrite1hTokens: number
	totalCacheReadTokens: number
	totalCost: number
	breakdown: CallerBreakdown[]
	createdAt: Date
}

const usageSchema = new Schema<IUsage>({
	planTitle: { type: String, required: true },
	totalCalls: { type: Number, required: true },
	totalInputTokens: { type: Number, required: true },
	totalOutputTokens: { type: Number, required: true },
	totalCacheWrite5mTokens: { type: Number, default: 0 },
	totalCacheWrite1hTokens: { type: Number, default: 0 },
	totalCacheReadTokens: { type: Number, default: 0 },
	totalCost: { type: Number, required: true },
	breakdown: [{
		caller: { type: String, required: true },
		model: { type: String, required: true },
		calls: { type: Number, required: true },
		inputTokens: { type: Number, required: true },
		outputTokens: { type: Number, required: true },
		cacheWrite5mTokens: { type: Number, default: 0 },
		cacheWrite1hTokens: { type: Number, default: 0 },
		cacheReadTokens: { type: Number, default: 0 },
		cost: { type: Number, required: true },
	}],
}, {
	timestamps: { createdAt: true, updatedAt: false },
})

usageSchema.index({ createdAt: -1 })

const UsageModel: Model<IUsage> = mongoose.model<IUsage>('Usage', usageSchema)

export default UsageModel
