import { AnthropicBatchClient } from './anthropicBatchClient.js'
import { BaseDepartment } from '../departments/base/baseDepartment.js'
import { HeadResponse, WorkerResponse, WorkerPrompt, HeadPrompt, DepartmentType } from '../types/department.js'
import logger from '../utils/logger.js'
import { CodeQualityDepartment } from '../departments/taskApprovers/codeQuality.js'
import { EvaluationDepartment } from '../departments/taskApprovers/evaluation.js'
import { SafetyDepartment } from '../departments/taskApprovers/safety.js'
import { getPendingTasks, updateTask } from '../scrum.js'

export class TaskValidator {
  private departments: Map<DepartmentType, BaseDepartment>
  private batchClient: AnthropicBatchClient

  constructor() {
    this.departments = new Map()
    this.departments.set('evaluation', new EvaluationDepartment())
    this.departments.set('code-quality', new CodeQualityDepartment())
    this.departments.set('safety', new SafetyDepartment())
    this.batchClient = new AnthropicBatchClient()
  }

  async validateTasks(): Promise<void> {
    const pendingTasks = await getPendingTasks()
    
    if (pendingTasks.length === 0) {
      logger.info('No pending tasks found. Exiting task validator.')
      return
    }

    logger.info(`Found ${pendingTasks.length} pending tasks to validate`)

    const workerResponses = await this.executeWorkerBatch()
    if (!workerResponses) {
      logger.error('Failed to get worker responses')
      return
    }

    const headResponses = await this.executeHeadBatch(workerResponses)
    if (!headResponses) {
      logger.error('Failed to get head responses')
      return
    }

    await this.updateTaskApprovals(headResponses)
  }

  private async executeWorkerBatch(): Promise<WorkerResponse[] | null> {
    logger.info('Generating worker prompts for all departments...')
    const workerPrompts: WorkerPrompt[] = []
    for (const department of this.departments.values()) {
      try {
        const departmentPrompts = await department.getDepartmentWorkerBatchPrompts()
        logger.info(`Generated ${departmentPrompts.length} worker prompts for ${department.getDepartmentType()}`)
        workerPrompts.push(...departmentPrompts)
      } catch (error) {
        logger.error(`Error generating worker prompts for department ${department.getDepartmentType()}:`, { error })
      }
    }

    if (workerPrompts.length === 0) {
      logger.info('No worker prompts generated.')
      return null
    }

    logger.info(`Total worker prompts generated: ${workerPrompts.length}`)
    
    const batchId = await this.batchClient.processBatch({ 
      prompts: workerPrompts, 
      model: 'low' 
    })
    logger.info(`Worker batch created with ID: ${batchId}`)

    await this.batchClient.awaitBatchCompletion(batchId)
    logger.info(`Worker batch ${batchId} completed successfully`)

    const batchResults = await this.batchClient.getWorkerBatchResults(batchId)
    
    logger.info(`Total worker responses received: ${batchResults.responses.length}`)
    return batchResults.responses
  }

  private async executeHeadBatch(workerResponses: WorkerResponse[]): Promise<HeadResponse[] | null> {
    logger.info('Generating head prompts for all departments...')
    const headPrompts: HeadPrompt[] = []
    for (const department of this.departments.values()) {
      try {
        const departmentHeadPrompts = await department.getDepartmentHeadBatchPrompts(workerResponses)
        logger.info(`Generated ${departmentHeadPrompts.length} head prompts for ${department.getDepartmentType()}`)
        headPrompts.push(...departmentHeadPrompts)
      } catch (error) {
        logger.error(`Error generating head prompts for department ${department.getDepartmentType()}:`, { error })
      }
    }

    if (headPrompts.length === 0) {
      logger.info('No head prompts generated.')
      return null
    }

    logger.info(`Total head prompts generated: ${headPrompts.length}`)

    const batchId = await this.batchClient.processBatch({ 
      prompts: headPrompts, 
      model: 'mid' 
    })
    logger.info(`Head batch created with ID: ${batchId}`)

    await this.batchClient.awaitBatchCompletion(batchId)
    logger.info(`Head batch ${batchId} completed successfully`)

    const batchResults = await this.batchClient.getHeadBatchResults(batchId)
    
    logger.info(`Total head responses received: ${batchResults.responses.length}`)
    return batchResults.responses
  }

  private async updateTaskApprovals(headResponses: HeadResponse[]): Promise<void> {
    logger.info('Updating task approvals...')
    
    const taskUpdates = new Map<string, Map<DepartmentType, {approved: boolean, feedback?: string}>>()

    for (const response of headResponses) {
      if (!taskUpdates.has(response.taskId)) {
        taskUpdates.set(response.taskId, new Map())
      }
      
      taskUpdates.get(response.taskId)!.set(response.department, {
        approved: response.approved,
        feedback: response.feedback
      })
    }

    for (const [taskId, departmentApprovals] of taskUpdates.entries()) {
      const updates = {
        approvals: Array.from(departmentApprovals.entries()).map(([department, approval]) => ({
          department,
          approved: approval.approved,
          feedback: approval.feedback
        }))
      }

      try {
        await updateTask(taskId, updates)
        logger.info(`Updated task ${taskId} with approvals from ${departmentApprovals.size} departments`)
      } catch (error) {
        logger.error(`Error updating task ${taskId}:`, { error })
      }
    }

    logger.info('Task approval updates completed')
  }
}
