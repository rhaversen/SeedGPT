import { Schema, model, Document } from 'mongoose'

export interface IStory extends Document {
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  tasks: string[]
  createdAt: Date
  updatedAt: Date
}

const storySchema = new Schema<IStory>({
  title: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  tasks: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
}, {
  timestamps: true
})

export const Story = model<IStory>('Story', storySchema)
