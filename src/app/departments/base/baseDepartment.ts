import { WorkerResponse, WorkerPrompt, HeadPrompt, DepartmentType } from '../../types/department.js'
import { getPendingTasks } from '../../scrum.js'
import logger from '../../utils/logger.js'

export interface TaskContext {
  id: string
  title: string
  description: string
}

export abstract class BaseDepartment {
  protected readonly departmentType: DepartmentType
  protected readonly workerCount = 10

  constructor(departmentType: DepartmentType) {
    this.departmentType = departmentType
  }

  getDepartmentType(): DepartmentType {
    return this.departmentType
  }

  abstract getWorkerPromptTemplate(): string
  abstract getHeadPromptTemplate(): string

  private extractJSONStrings(responses: WorkerResponse[]): string[] {
    const jsonStrings: string[] = []

    for (const [index, response] of responses.entries()) {
      const jsonString = this.extractJSONString(response.response)
      if (jsonString) {
        jsonStrings.push(jsonString)
      } else {
        logger.warn(`${this.departmentType}: No valid JSON in worker response ${index} for task ${response.taskId}`)
        logger.debug(`   Raw response: ${response.response.substring(0, 200)}...`)
      }
    }

    if (jsonStrings.length !== responses.length) {
      const failedCount = responses.length - jsonStrings.length
      logger.info(`📊 ${this.departmentType}: Found ${jsonStrings.length}/${responses.length} valid responses (${failedCount} invalid)`)
    }

    return jsonStrings
  }

  private extractJSONString(raw: string): string | null {
    try {
      const lines = raw.trim().split('\n')

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (line.startsWith('{') && line.endsWith('}')) {
          try {
            JSON.parse(line)
            return line
          } catch {
            continue
          }
        }
      }

      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        JSON.parse(jsonMatch[0])
        return jsonMatch[0]
      }
      return null
    } catch {
      return null
    }
  }

  async getDepartmentWorkerBatchPrompts(): Promise<WorkerPrompt[]> {
    const tasks = await getPendingTasks()
    const taskContexts: TaskContext[] = tasks.map(task => ({
      id: task.id.toString(),
      title: task.title,
      description: task.description
    }))

    if (taskContexts.length === 0) {
      logger.info(`${this.departmentType}: No pending tasks to evaluate`)
      return []
    }

    const promptTemplate = this.getWorkerPromptTemplate()
    const prompts = this.createWorkerPrompts(taskContexts, promptTemplate)

    logger.info(`🔧 ${this.departmentType}: Generated ${prompts.length} worker prompts for ${taskContexts.length} tasks`)

    return prompts
  }

  async getDepartmentHeadBatchPrompts(responses: WorkerResponse[]): Promise<HeadPrompt[]> {
    const taskGroups = this.groupResponsesByTask(responses)
    const prompts: HeadPrompt[] = []
    const tasks = await getPendingTasks()
    const taskContextMap = new Map(tasks.map(task => [task.id.toString(), { id: task.id.toString(), title: task.title, description: task.description }]))

    logger.info(`🎯 ${this.departmentType}: Processing ${taskGroups.size} tasks for head evaluation`)

    for (const [taskId, workerResponses] of taskGroups.entries()) {
      const jsonStrings = this.extractJSONStrings(workerResponses)

      if (jsonStrings.length === 0) {
        logger.warn(`${this.departmentType}: No valid responses for task ${taskId}, skipping head prompt generation`)
        continue
      }

      const taskContext = taskContextMap.get(taskId)
      if (!taskContext) {
        logger.warn(`${this.departmentType}: No task context found for task ${taskId}, skipping head prompt generation`)
        continue
      }

      const workerSummaries = jsonStrings.map((json, index) => `Worker ${index + 1}: ${json}`).join('\n\n')
      const headPromptTemplate = this.getHeadPromptTemplate()

      const processedPrompt = headPromptTemplate
        .replace(/\$\(TASK_TITLE\)/g, taskContext.title)
        .replace(/\$\(TASK_DESC\)/g, taskContext.description)
        .replace(/\$\(WORKER_SUMMARIES\)/g, workerSummaries)

      prompts.push({
        department: this.departmentType,
        taskId,
        workerResponses,
        prompt: processedPrompt
      })
    }

    logger.info(`   ${this.departmentType}: Generated ${prompts.length} head prompts`)
    return prompts
  }

  protected createWorkerPrompts(tasks: TaskContext[], promptTemplate: string): WorkerPrompt[] {
    return tasks.flatMap(task => {
      const prompt = promptTemplate
        .replace(/\$\(TASK_TITLE\)/g, task.title)
        .replace(/\$\(TASK_DESC\)/g, task.description)
      return Array.from({ length: this.workerCount }, (_, workerIndex) => ({
        department: this.departmentType,
        taskId: task.id,
        workerIndex,
        prompt
      }))
    })
  }

  protected groupResponsesByTask(responses: WorkerResponse[]): Map<string, WorkerResponse[]> {
    return responses
      .filter(r => r.department === this.departmentType)
      .reduce((groups, response) => {
        const taskResponses = groups.get(response.taskId) || []
        taskResponses.push(response)
        groups.set(response.taskId, taskResponses)
        return groups
      }, new Map<string, WorkerResponse[]>())
  }
}
