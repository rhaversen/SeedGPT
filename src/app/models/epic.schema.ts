import { Schema, model, Document } from 'mongoose'

export interface IEpic extends Document {
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  stories: Schema.Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}

const epicSchema = new Schema<IEpic>({
  title: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  stories: [{ type: Schema.Types.ObjectId, ref: 'Story' }],
}, {
  timestamps: true
})

export const Epic = model<IEpic>('Epic', epicSchema)
