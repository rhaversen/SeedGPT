import Anthropic from '@anthropic-ai/sdk'
import logger from '../utils/logger.js'

export class AnthropicClient {
  private client: Anthropic
  private readonly models = {
    high: "claude-3-opus-20240229", // Used for high complexity tasks, like code generation
    mid: "claude-3-sonnet-20240229", // Used for mid complexity tasks, like reading features and deciding what to do next
    low: "claude-3-haiku-20240307" // Used for low complexity tasks, like summarizing conversations
  }

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }

  async sendMessage(prompt: string, model: 'low' | 'mid' | 'high' = 'low'): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.models[model],
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: 0.7
      })

      if (response.content && response.content.length > 0) {
        const content = response.content[0]
        return content.type === 'text' ? content.text : ''
      }
      return ''
    } catch (error) {
      logger.error('Error sending message to Anthropic:', { error })
      throw error
    }
  }
}
