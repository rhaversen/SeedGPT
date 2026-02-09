import mongoose, { type Document, type Model, Schema } from 'mongoose'

interface CallerBreakdown {
	caller: string
	model: string
	calls: number
	inputTokens: number
	outputTokens: number
	cost: number
}

export interface IUsage extends Document {
	planTitle: string
	totalCalls: number
	totalInputTokens: number
	totalOutputTokens: number
	totalCost: number
	breakdown: CallerBreakdown[]
	createdAt: Date
}

const usageSchema = new Schema<IUsage>({
	planTitle: { type: String, required: true },
	totalCalls: { type: Number, required: true },
	totalInputTokens: { type: Number, required: true },
	totalOutputTokens: { type: Number, required: true },
	totalCost: { type: Number, required: true },
	breakdown: [{
		caller: { type: String, required: true },
		model: { type: String, required: true },
		calls: { type: Number, required: true },
		inputTokens: { type: Number, required: true },
		outputTokens: { type: Number, required: true },
		cost: { type: Number, required: true },
	}],
}, {
	timestamps: { createdAt: true, updatedAt: false },
})

usageSchema.index({ createdAt: -1 })

const UsageModel: Model<IUsage> = mongoose.model<IUsage>('Usage', usageSchema)

export default UsageModel
