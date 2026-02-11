import mongoose, { type Document, type Model, Schema } from 'mongoose'

export interface IGenerated extends Document {
	planTitle: string
	outcome: string
	transcript: string
	reflection: string
	createdAt: Date
}

const generatedSchema = new Schema<IGenerated>({
	planTitle: { type: String, required: true },
	outcome: { type: String, required: true },
	transcript: { type: String, required: true },
	reflection: { type: String, required: true },
}, {
	timestamps: { createdAt: true, updatedAt: false },
})

generatedSchema.index({ createdAt: -1 })

const GeneratedModel: Model<IGenerated> = mongoose.model<IGenerated>('Generated', generatedSchema)

export default GeneratedModel
