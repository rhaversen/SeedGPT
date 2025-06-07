import { AnthropicBatchClient } from './anthropicBatchClient.js'
import { BaseDepartment } from '../departments/base/baseDepartment.js'
import { HeadResponse, WorkerResponse, WorkerPrompt, HeadPrompt, DepartmentType } from '../types/department.js'
import logger from '../utils/logger.js'
import { CodeQualityDepartment } from '../departments/taskApprovers/codeQuality.js'
import { EvaluationDepartment } from '../departments/taskApprovers/evaluation.js'
import { SafetyDepartment } from '../departments/taskApprovers/safety.js'
import { getPendingTasks, updateTask, getTask } from '../scrum.js'

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

    logger.info(`🔍 Starting validation for ${pendingTasks.length} pending tasks`)
    logger.info(`📋 Tasks to validate:`)
    pendingTasks.forEach((task, index) => {
      logger.info(`   ${index + 1}. "${task.title}"`)
    })

    const workerResponses = await this.executeWorkerBatch()
    if (!workerResponses) {
      logger.error('Failed to get worker responses')
      return
    }

    logger.info(`📥 Received ${workerResponses.length} worker responses, proceeding to department heads`)

    const headResponses = await this.executeHeadBatch(workerResponses)
    if (!headResponses) {
      logger.error('Failed to get head responses')
      return
    }

    const approvedTasks = headResponses.filter(r => r.approved).length
    const rejectedTasks = headResponses.filter(r => !r.approved).length
    logger.info(`📊 Department validation complete: ${approvedTasks} approved, ${rejectedTasks} rejected`)

    // Log department-specific breakdown
    const departmentResults = new Map<string, { approved: number, rejected: number }>()
    headResponses.forEach(response => {
      const dept = response.department
      if (!departmentResults.has(dept)) {
        departmentResults.set(dept, { approved: 0, rejected: 0 })
      }
      if (response.approved) {
        departmentResults.get(dept)!.approved++
      } else {
        departmentResults.get(dept)!.rejected++
      }
    })

    logger.info(`🏢 Department breakdown:`)
    departmentResults.forEach((results, dept) => {
      logger.info(`   ${dept}: ✅ ${results.approved} approved, ❌ ${results.rejected} rejected`)
    })

    await this.updateTaskApprovals(headResponses)
  }

  private async executeWorkerBatch(): Promise<WorkerResponse[] | null> {
    logger.info('Generating worker prompts for all departments...')
    const workerPrompts: WorkerPrompt[] = []
    for (const department of this.departments.values()) {
      try {
        const departmentPrompts = await department.getDepartmentWorkerBatchPrompts()
        workerPrompts.push(...departmentPrompts)
      } catch (error) {
        logger.error(`Error generating worker prompts for department ${department.getDepartmentType()}:`, { error })
      }
    }

    if (workerPrompts.length === 0) {
      logger.info('No worker prompts generated.')
      return null
    }

    logger.info(`🔧 Processing ${workerPrompts.length} worker evaluations across ${this.departments.size} departments`)

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
    const headPrompts: HeadPrompt[] = []
    for (const department of this.departments.values()) {
      try {
        const departmentHeadPrompts = await department.getDepartmentHeadBatchPrompts(workerResponses)
        headPrompts.push(...departmentHeadPrompts)
      } catch (error) {
        logger.error(`Error generating head prompts for department ${department.getDepartmentType()}:`, { error })
      }
    }

    if (headPrompts.length === 0) {
      logger.info('No head prompts generated.')
      return null
    }

    logger.info(`🎯 Processing ${headPrompts.length} department head evaluations`)

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
    const taskUpdates = new Map<string, Map<DepartmentType, { approved: boolean, feedback?: string }>>()

    for (const response of headResponses) {
      if (!taskUpdates.has(response.taskId)) {
        taskUpdates.set(response.taskId, new Map())
      }

      taskUpdates.get(response.taskId)!.set(response.department, {
        approved: response.approved,
        feedback: response.feedback
      })
    }

    logger.info(`💾 Updating ${taskUpdates.size} tasks with department approvals`)
    
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
        const task = await getTask(taskId)
        const taskName = task?.title || `Task ${taskId}`

        const approvedDepts = Array.from(departmentApprovals.entries()).filter(([_, approval]) => approval.approved).map(([dept]) => dept)
        const rejectedDepts = Array.from(departmentApprovals.entries()).filter(([_, approval]) => !approval.approved).map(([dept]) => dept)

        logger.info(`   📋 ${taskName}:`)
        if (approvedDepts.length > 0) {
          logger.info(`     ✅ Approved by: ${approvedDepts.join(', ')}`)
        }
        if (rejectedDepts.length > 0) {
          logger.info(`     ❌ Rejected by: ${rejectedDepts.join(', ')}`)
        }

        // Show detailed LLM feedback for each department
        for (const [dept, approval] of departmentApprovals.entries()) {
          if (approval.feedback && approval.feedback.trim()) {
            const status = approval.approved ? '✅' : '❌'
            logger.info(`       ${status} ${dept}: "${approval.feedback}"`)
          } else if (!approval.approved) {
            logger.info(`       ❌ ${dept}: No specific feedback provided`)
          }
        }
      } catch (error) {
        logger.error(`Error updating task ${taskId}:`, { error })
      }
    }

    logger.info(`🏁 Task validation completed for ${taskUpdates.size} tasks`)
  }
}
