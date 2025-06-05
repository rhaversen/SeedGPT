import { WorkerResponse, WorkerPrompt, HeadPrompt } from '../../types/department.js'

export abstract class BaseDepartment {
  // Unique identifier for this department
  protected id: string

  // How many parallel workers to spawn per department
  protected workerCount = 10

  constructor(protected departmentName: string) {
    this.id = departmentName
  }

  getId(): string {
    return this.id
  }

  // Return a batch of prompts for all relevant tasks
  abstract getDepartmentWorkerBatchPrompts(): Promise<WorkerPrompt[]>

  // Given all worker outputs for this department, reduce them to reports
  abstract getDepartmentHeadBatchPrompts(responses: WorkerResponse[]): Promise<HeadPrompt[]>

  // Generate worker prompts based on a task and a base prompt template
  protected generateWorkerPrompts(
    task: { id: string; title: string; description: string },
    basePrompt: string,
  ): WorkerPrompt[] {
    const processedPrompt = basePrompt
      .replace(/\$\(TASK_TITLE\)/g, task.title)
      .replace(/\$\(TASK_DESC\)/g, task.description)

    return Array.from({ length: this.workerCount }, (_, i) => ({
      department: this.id,
      taskId: task.id,
      prompt: processedPrompt,
      workerId: `${this.id}-${task.id}-${i}`
    }))
  }

  // Utility: parse a JSON object out of a multi-line string
  protected parseJSON<T>(raw: string): T | null {
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
