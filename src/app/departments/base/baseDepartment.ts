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
  abstract parseWorkerResponses<T>(responses: WorkerResponse[]): T[]
  abstract createSummary<T>(results: T[]): string

  async getDepartmentWorkerBatchPrompts(): Promise<WorkerPrompt[]> {
    const tasks = await getPendingTasks()
    const taskContexts: TaskContext[] = tasks.map(task => ({
      id: task.id.toString(),
      title: task.title,
      description: task.description
    }))

    const promptTemplate = this.getWorkerPromptTemplate()
    return this.createWorkerPrompts(taskContexts, promptTemplate)
  }
  async getDepartmentHeadBatchPrompts(responses: WorkerResponse[]): Promise<HeadPrompt[]> {
    const taskGroups = this.groupResponsesByTask(responses)
    const prompts: HeadPrompt[] = []

    logger.info(`${this.departmentType}: Processing ${taskGroups.size} task groups`)

    for (const [taskId, workerResponses] of taskGroups.entries()) {
      logger.info(`${this.departmentType}: Task ${taskId} has ${workerResponses.length} worker responses`)
      
      const results = this.parseWorkerResponses(workerResponses)
      logger.info(`${this.departmentType}: Task ${taskId} parsed ${results.length} valid results from ${workerResponses.length} responses`)
      
      if (results.length === 0) {
        logger.warn(`${this.departmentType}: No valid results for task ${taskId}, skipping head prompt generation`)
        continue
      }

      const summary = this.createSummary(results)
      const headPromptTemplate = this.getHeadPromptTemplate()
      
      prompts.push({
        department: this.departmentType,
        taskId,
        workerResponses,
        prompt: headPromptTemplate.replace('${summary}', summary)
      })
    }

    return prompts
  }

  protected createWorkerPrompts(tasks: TaskContext[], promptTemplate: string): WorkerPrompt[] {
    return tasks.flatMap(task => 
      Array.from({ length: this.workerCount }, (_, workerIndex) => ({
        department: this.departmentType,
        taskId: task.id,
        workerIndex,
        prompt: this.processPromptTemplate(promptTemplate, task)
      }))
    )
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

  protected parseJSON<T>(raw: string): T | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      return jsonMatch ? JSON.parse(jsonMatch[0]) as T : null
    } catch {
      return null
    }
  }

  private processPromptTemplate(template: string, task: TaskContext): string {
    return template
      .replace(/\$\(TASK_TITLE\)/g, task.title)
      .replace(/\$\(TASK_DESC\)/g, task.description)
  }
}
