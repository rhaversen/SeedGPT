import mongoose, { type Document, type Model, Schema } from 'mongoose'

export interface IGenerated extends Document {
	phase: string
	modelId: string
	messages: unknown[]
	response: unknown[]
	inputTokens: number
	outputTokens: number
	cost: number
	stopReason: string
	createdAt: Date
}

const generatedSchema = new Schema<IGenerated>({
	phase: { type: String, required: true },
	modelId: { type: String, required: true },
	messages: { type: Schema.Types.Mixed, required: true },
	response: { type: Schema.Types.Mixed, required: true },
	inputTokens: { type: Number, required: true },
	outputTokens: { type: Number, required: true },
	cost: { type: Number, required: true },
	stopReason: { type: String, required: true },
}, {
	timestamps: { createdAt: true, updatedAt: false },
})

generatedSchema.index({ createdAt: -1 })

const GeneratedModel: Model<IGenerated> = mongoose.model<IGenerated>('Generated', generatedSchema)

export default GeneratedModel
