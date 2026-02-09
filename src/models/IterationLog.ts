import mongoose, { type Document, type Model, Schema } from 'mongoose'

interface LogEntryDoc {
	timestamp: string
	level: string
	message: string
	context?: Record<string, unknown>
}

export interface IIterationLog extends Document {
	entries: LogEntryDoc[]
	createdAt: Date
}

const iterationLogSchema = new Schema<IIterationLog>({
	entries: [{
		timestamp: { type: String, required: true },
		level: { type: String, required: true },
		message: { type: String, required: true },
		context: { type: Schema.Types.Mixed },
	}],
}, {
	timestamps: { createdAt: true, updatedAt: false },
})

iterationLogSchema.index({ createdAt: -1 })

const IterationLogModel: Model<IIterationLog> = mongoose.model<IIterationLog>('IterationLog', iterationLogSchema)

export default IterationLogModel
