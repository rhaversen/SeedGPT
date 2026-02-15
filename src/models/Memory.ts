import mongoose, { type Document, type Model, Schema } from 'mongoose'

export type MemoryCategory = 'note' | 'reflection'

export interface IMemory extends Document {
	content: string
	summary: string
	category: MemoryCategory
	active: boolean
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
	category: {
		type: String,
		enum: ['note', 'reflection'],
		required: true,
	},
	active: {
		type: Boolean,
		default: true,
	},
}, {
	timestamps: true,
})

memorySchema.index({ category: 1, active: 1, createdAt: -1 })
memorySchema.index({ category: 1, createdAt: -1 })
memorySchema.index({ content: 'text', summary: 'text' })

const MemoryModel: Model<IMemory> = mongoose.model<IMemory>('Memory', memorySchema)

export default MemoryModel
