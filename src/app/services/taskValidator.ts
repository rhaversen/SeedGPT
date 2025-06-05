import { AnthropicBatchClient } from './anthropicBatchClient.js'
import { BaseDepartment } from '../departments/base/baseDepartment.js'
import { HeadResponse, WorkerResponse, WorkerPrompt, HeadPrompt } from '../types/department.js'
import logger from '../utils/logger.js'
import { CodeQualityDepartment } from '../departments/taskApprovers/codeQuality.js'
import { EvaluationDepartment } from '../departments/taskApprovers/evaluation.js'
import { SafetyDepartment } from '../departments/taskApprovers/safety.js'

export class TaskValidator {
  private departments: Map<string, BaseDepartment>
  private batchClient: AnthropicBatchClient

  constructor() {
    this.departments = new Map()

    this.departments.set('evaluation', new EvaluationDepartment())
    this.departments.set('codeQuality', new CodeQualityDepartment())
    this.departments.set('safety', new SafetyDepartment())

    this.batchClient = new AnthropicBatchClient()
  }

  async validateTasks(): Promise<HeadResponse[] | null> {
    const workerPrompts: WorkerPrompt[] = []

    for (const department of this.departments.values()) {
      logger.info(`Generating worker prompts for department: ${department.getId()}`)
      try {
        const departmentPrompts = await department.getDepartmentWorkerBatchPrompts()
        logger.info(`Generated ${departmentPrompts.length} worker prompts for ${department.getId()}`)
        workerPrompts.push(...departmentPrompts)
      } catch (error) {
        logger.error(`Error generating worker prompts for department ${department.getId()}:`, { error })
      }
    }

    if (workerPrompts.length === 0) {
      logger.info('No worker prompts generated. Exiting task validator.')
      return null
    }

    logger.info(`Total worker prompts generated: ${workerPrompts.length}`)
    const workerResponses = await this.executeBatch(workerPrompts, 'worker') as WorkerResponse[] | null

    if (!workerResponses) {
      logger.info('No worker responses received. Exiting task validator.')
      return null
    }

    logger.info(`Total worker responses received: ${workerResponses.length}`)

    logger.info('Processing head prompts for each department...')
    const headPrompts: HeadPrompt[] = []

    for (const department of this.departments.values()) {
      logger.info(`Generating head prompts for department: ${department.getId()}`)
      try {
        const departmentHeadPrompts = await department.getDepartmentHeadBatchPrompts(workerResponses)
        logger.info(`Generated ${departmentHeadPrompts.length} head prompts for ${department.getId()}`)
        headPrompts.push(...departmentHeadPrompts)
      } catch (error) {
        logger.error(`Error generating head prompts for department ${department.getId()}:`, { error })
      }
    }

    if (headPrompts.length === 0) {
      logger.info('No head prompts generated. Exiting task validator.')
      return null
    }

    logger.info(`Total head prompts generated: ${headPrompts.length}`)

    const headResponses = await this.executeBatch(headPrompts, 'head') as HeadResponse[] | null
    if (!headResponses) {
      logger.info('No head responses received. Exiting task validator.')
      return null
    }
    logger.info(`Total head responses received: ${headResponses.length}`)
    
    return headResponses
  }

  private async executeBatch(prompts: WorkerPrompt[] | HeadPrompt[], batchType: 'worker' | 'head') {
    const batchId = await this.batchClient.processBatch({ prompts, model: batchType === 'worker' ? 'low' : 'mid' })
    logger.info(`${batchType} batch created with ID: ${batchId}`)

    await this.batchClient.awaitBatchCompletion(batchId)
    logger.info(`${batchType} batch ${batchId} completed successfully.`)

    const batchResponse = await this.batchClient.getBatchStatus(batchId)
    logger.info(`${batchType} batch ${batchId} responses received.`)

    if (batchResponse.processing_status !== 'ended') {
      logger.error(`${batchType} batch ${batchId} did not complete successfully. Status: ${batchResponse.processing_status}`)
      return null
    }

    const batchResults = await this.batchClient.getBatchResults(batchId)
    logger.info(`${batchType} batch ${batchId} results retrieved.`)
    logger.info(`Total ${batchType} responses received: ${batchResults.responses.length}`)

    if (batchResults.responses.length === 0) {
      logger.info(`No ${batchType} responses received. Exiting task validator.`)
      return null
    }

    return batchResults.responses
  }
}
