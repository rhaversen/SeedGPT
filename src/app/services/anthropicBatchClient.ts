import Anthropic from '@anthropic-ai/sdk'
import { WorkerResponse, BatchRequest, HeadPrompt, WorkerPrompt, HeadResponse, DepartmentType, BatchResponse as DepartmentBatchResponse } from '../types/department.js'
import logger from '../utils/logger.js'

export interface BatchResponse {
  id: string
  response: string
  error?: string
}

export class AnthropicBatchClient {
  private client: Anthropic

  private readonly models = {
    high: "claude-opus-4-20250514",
    mid: "claude-sonnet-4-20250514",
    low: "claude-3-5-haiku-latest"
  }

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })
  }

  async processBatch(request: BatchRequest<WorkerPrompt | HeadPrompt>): Promise<string> {
    logger.info(`Creating batch with ${request.prompts.length} prompts using model: ${request.model}`)

    const batchRequests = request.prompts.map((prompt: WorkerPrompt | HeadPrompt) => {
      let customId: string
      if ('workerIndex' in prompt) {
        customId = `worker-${prompt.department}-${prompt.taskId}-${prompt.workerIndex}`
      } else {
        customId = `head-${prompt.department}-${prompt.taskId}`
      }

      return {
        custom_id: customId,
        params: {
          model: this.models[request.model],
          max_tokens: 1024,
          messages: [{
            role: 'user' as const,
            content: prompt.prompt
          }],
          temperature: 1
        }
      }
    })

    try {
      const batch = await this.client.messages.batches.create({
        requests: batchRequests
      })

      logger.info(`Batch created successfully with ID: ${batch.id}`)
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
      await new Promise(resolve => setTimeout(resolve, 1000 * 60)) // Check every minute
    }
  }

  async getWorkerBatchResults(batchId: string): Promise<DepartmentBatchResponse<WorkerResponse>> {
    logger.info(`Retrieving worker batch results for batch: ${batchId}`)
    const batch = await this.client.messages.batches.retrieve(batchId)

    if (batch.processing_status !== 'ended') {
      throw new Error(`Batch ${batchId} is not complete. Status: ${batch.processing_status}`)
    }

    if (!batch.results_url) {
      throw new Error(`No results URL available for batch ${batchId}`)
    }

    logger.info(`Fetching results from URL: ${batch.results_url}`)

    const resultsResponse = await fetch(batch.results_url, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!
      }
    })

    if (!resultsResponse.ok) {
      const errorText = await resultsResponse.text()
      logger.error(`Failed to fetch batch results: ${resultsResponse.status} ${resultsResponse.statusText}`, { errorText })
      throw new Error(`Failed to fetch batch results: ${resultsResponse.status} ${resultsResponse.statusText}. Response: ${errorText}`)
    } const resultsText = await resultsResponse.text()
    const results = resultsText.trim().split('\n').map(line => JSON.parse(line))

    const responses: WorkerResponse[] = results.map((result, index) => {
      if (!result.custom_id) {
        throw new Error(`Result at index ${index} is missing custom_id`)
      } const content = this.extractContentFromBatchResult(result, index)
      const customIdParts = result.custom_id.split('-')

      if (customIdParts.length < 4) {
        throw new Error(`Invalid custom_id format: ${result.custom_id}`)
      }

      // Parse custom_id: worker-{department}-{taskId}-{workerIndex}
      // Department can contain hyphens, so we need to parse from the end
      const workerIndex = parseInt(customIdParts[customIdParts.length - 1])
      const taskId = customIdParts[customIdParts.length - 2]
      const department = customIdParts.slice(1, -2).join('-') as DepartmentType

      return {
        taskId,
        department,
        workerIndex,
        response: content,
      }
    })

    logger.info(`Successfully processed ${responses.length} worker responses`)
    return { responses }
  }

  async getHeadBatchResults(batchId: string): Promise<DepartmentBatchResponse<HeadResponse>> {
    logger.info(`Retrieving head batch results for batch: ${batchId}`)
    const batch = await this.client.messages.batches.retrieve(batchId)

    if (batch.processing_status !== 'ended') {
      throw new Error(`Batch ${batchId} is not complete. Status: ${batch.processing_status}`)
    }

    if (!batch.results_url) {
      throw new Error(`No results URL available for batch ${batchId}`)
    }

    logger.info(`Fetching head results from URL: ${batch.results_url}`)

    const resultsResponse = await fetch(batch.results_url, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY!
      }
    })

    if (!resultsResponse.ok) {
      const errorText = await resultsResponse.text()
      logger.error(`Failed to fetch head batch results: ${resultsResponse.status} ${resultsResponse.statusText}`, { errorText })
      throw new Error(`Failed to fetch head batch results: ${resultsResponse.status} ${resultsResponse.statusText}. Response: ${errorText}`)
    } const resultsText = await resultsResponse.text()
    const results = resultsText.trim().split('\n').map(line => JSON.parse(line))

    const responses: HeadResponse[] = results.map((result, index) => {
      if (!result.custom_id) {
        throw new Error(`Head result at index ${index} is missing custom_id`)
      } const content = this.extractContentFromBatchResult(result, index)

      const customIdParts = result.custom_id.split('-')

      if (customIdParts.length < 3) {
        throw new Error(`Invalid head custom_id format: ${result.custom_id}`)
      }

      // Parse custom_id: head-{department}-{taskId}
      // Department can contain hyphens, so we need to parse from the end
      const taskId = customIdParts[customIdParts.length - 1]
      const department = customIdParts.slice(1, -1).join('-') as DepartmentType

      const parsed = this.parseJSON<{ approved: boolean, feedback?: string }>(content)
      return {
        taskId,
        department,
        approved: parsed?.approved || false,
        feedback: parsed?.feedback
      }
    })

    logger.info(`Successfully processed ${responses.length} head responses`)
    return { responses }
  }
  private extractContentFromBatchResult(result: any, index: number): string {
    if (result.result?.type === 'error') {
      logger.error(`Result ${index} has error:`, { customId: result.custom_id, error: result.result })
      return `Error: ${result.result.error?.message || 'Unknown error'}`
    }

    if (result?.result?.message?.content?.[0]?.text) {
      return result.result.message.content[0].text
    }

    logger.warn(`Unable to extract content from result ${index}`)
    return 'Error processing request'
  }

  private parseJSON<T>(raw: string): T | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T
      }
    } catch {
      return null
    }
    return null
  }
}
