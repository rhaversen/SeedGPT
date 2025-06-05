import { Schema, model, Document } from 'mongoose'

export interface ITheme extends Document {
  name: string
  description: string
  priority: 'low' | 'medium' | 'high'
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const themeSchema = new Schema<ITheme>({
  name: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  active: { type: Boolean, default: true }
}, {
  timestamps: true
})

export const Theme = model<ITheme>('Theme', themeSchema)
