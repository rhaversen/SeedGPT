import Anthropic from '@anthropic-ai/sdk'
import { WorkerResponse, BatchPromptRequest, BatchPromptResponse, HeadPrompt } from '../types/department.js'
import logger from '../utils/logger.js'

export interface BatchResponse {
  id: string
  response: string
  error?: string
}

export class AnthropicBatchClient {
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

  async processBatch(request: BatchPromptRequest): Promise<string> {
    const batchRequests = request.prompts.map((prompt) => ({
      custom_id: `${'workerId' in prompt ? prompt.workerId : prompt.headId}-${prompt.taskId}`,
      params: {
        model: this.models[request.model],
        max_tokens: 1024,
        messages: [{
          role: 'user' as const,
          content: prompt.prompt
        }],
        temperature: 1
      }
    }))

    try {
      const batch = await this.client.messages.batches.create({
        requests: batchRequests
      })

      return batch.id
    } catch (error) {
      logger.error('Error creating batch', { error })
      throw error
    }
  }

  async getBatchStatus(batchId: string) {
    try {
      return await this.client.messages.batches.retrieve(batchId)
    } catch (error) {
      logger.error(`Error retrieving batch ${batchId}:`, { error })
      throw error
    }
  }

  async awaitBatchCompletion(batchId: string, timeoutMs: number = 1000 * 60 * 60 * 24): Promise<void> {
    const startTime = Date.now()
    while (true) {
      const batch = await this.getBatchStatus(batchId)
      if (batch.processing_status !== 'in_progress') {
        return
      }
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Batch ${batchId} did not complete within ${timeoutMs}ms. Current status: ${batch.processing_status}`)
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * 60 * 5)) // Check every 5 minutes
    }
  }

  async getBatchResults(batchId: string): Promise<BatchPromptResponse> {
    try {
      const batch = await this.client.messages.batches.retrieve(batchId)

      if (batch.processing_status !== 'ended') {
        throw new Error(`Batch ${batchId} is not complete. Status: ${batch.processing_status}`)
      }

      if (!batch.results_url) {
        throw new Error(`No results URL available for batch ${batchId}`)
      }

      const resultsResponse = await fetch(batch.results_url)
      const resultsText = await resultsResponse.text()
      const results = resultsText.trim().split('\n').map(line => JSON.parse(line))

      const responses: WorkerResponse[] = results.map(result => {
        const [workerId, taskId] = result.custom_id.split('-')
        const content = result.result?.content?.[0]?.text || 'Error processing request'

        return {
          workerId,
          taskId,
          department: 'unknown',
          response: content,
        }
      })

      return { responses }
    } catch (error) {
      logger.error(`Error retrieving batch results for ${batchId}:`, { error })
      throw error
    }
  }
}
