import mongoose, { type Document, type Model, Schema } from 'mongoose'

export interface IMemory extends Document {
	content: string
	summary: string
	pinned: boolean
	createdAt: Date
	updatedAt: Date
}

const memorySchema = new Schema<IMemory>({
	content: {
		type: String,
		required: true,
	},
	summary: {
		type: String,
		required: true,
	},
	pinned: {
		type: Boolean,
		default: false,
	},
}, {
	timestamps: true,
})

memorySchema.index({ pinned: 1, createdAt: -1 })
memorySchema.index({ createdAt: -1 })
memorySchema.index({ content: 'text', summary: 'text' })

const MemoryModel: Model<IMemory> = mongoose.model<IMemory>('Memory', memorySchema)

export default MemoryModel
