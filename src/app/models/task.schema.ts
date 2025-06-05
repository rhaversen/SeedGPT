import { Schema, model, Document } from 'mongoose'

export interface ITaskApproval {
  department: 'evaluation' | 'code-quality' | 'safety'
  approved: boolean
  feedback?: string
}

export interface ITask extends Document {
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  status: 'pending' | 'completed'
  approvals: ITaskApproval[]
  context: string
  createdAt: Date
  updatedAt: Date
}

const taskApprovalSchema = new Schema<ITaskApproval>({
  department: { type: String, enum: ['evaluation', 'code-quality', 'safety'], required: true },
  approved: { type: Boolean,  default: false },
  feedback: { type: String },
}, {
  _id: false,
  timestamps: true
})

const taskSchema = new Schema<ITask>({
  title: { type: String, required: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  approvals: [taskApprovalSchema],
  context: { type: String, default: '' },
}, {
  timestamps: true
})

export const Task = model<ITask>('Task', taskSchema)
