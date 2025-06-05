import { WorkerResponse, WorkerPrompt, HeadPrompt } from '../../types/department.js'
import { BaseDepartment } from '../base/baseDepartment.js'
import { getEligibleTasks, getTask } from '../../scrum.js'

interface WorkerEvaluationResult {
  clarity: number
  feasibility: number
  scope: number
  effort: number
  impact: number
  suggestions: string[]
}

export class EvaluationDepartment extends BaseDepartment {
  id = 'evaluation'

  constructor() {
    super('evaluation')
  }

  async getDepartmentWorkerBatchPrompts(): Promise<WorkerPrompt[]> {
    const prompts: WorkerPrompt[] = []
    const tasksUnderReview = await getEligibleTasks()

    for (const task of tasksUnderReview) {
      const basePrompt = `
You are an expert task evaluator. Assess this software development task:

Task: $(TASK_TITLE)
Description: $(TASK_DESC)

Evaluate on a 1–10 scale:
- Clarity: How well-defined is this task? (10 = crystal clear)
- Feasibility: Can this be done in one iteration? (10 = very feasible)
- Scope: Is it appropriately sized? (10 = perfect size)
- Effort: Estimated complexity/time (10 = trivial)
- Impact: Value of completion (10 = critical)

Provide suggestions for improvement.

Respond ONLY in JSON, e.g.:
{
  "clarity": 8,
  "feasibility": 7,
  "scope": 6,
  "effort": 5,
  "impact": 9,
  "suggestions": ["..."]
}
      `.trim()

      prompts.push(...this.generateWorkerPrompts(
        { id: task.id.toString(), title: task.title, description: task.description },
        basePrompt
      ))
    }

    return prompts
  }

  async getDepartmentHeadBatchPrompts(responses: WorkerResponse[]): Promise<HeadPrompt[]> {
    const grouped: Record<string, WorkerResponse[]> = {}

    for (const resp of responses) {
      grouped[resp.taskId] = grouped[resp.taskId] || []
      grouped[resp.taskId].push(resp)
    }

    const taskIds = Object.keys(grouped)
    const tasks = await Promise.all(taskIds.map(id => getTask(id)))

    const prompts: HeadPrompt[] = []

    taskIds.forEach((taskId, index) => {
      const task = tasks[index]
      const reps = grouped[taskId]

      if (!task) {
        return
      }

      const parsed: WorkerEvaluationResult[] = reps
        .map(r => this.parseJSON<WorkerEvaluationResult>(r.response))
        .filter((x): x is WorkerEvaluationResult => x !== null)

      if (parsed.length === 0) {
        return
      }

      const summary = parsed.map((e, i) =>
        `Worker ${i + 1}:
  Clarity=${e.clarity}, Feasibility=${e.feasibility}, Scope=${e.scope}, Effort=${e.effort}, Impact=${e.impact}
  Suggestions: ${e.suggestions.join(', ')}`
      ).join('\n\n')

      prompts.push({
        department: this.id,
        taskId,
        headId: `${this.id}-head-${taskId}`,
        prompt: `You are a senior project manager reviewing task evaluations. Based on multiple worker assessments, decide if this task is approved.

Original Task:
Title: ${task.title}
Description: ${task.description}

Worker Evaluations:
${summary}

Respond ONLY in JSON:
If approved:
{ "approved": true }

If not approved:
{ "approved": false, "report": "..." }`
      })
    })

    return prompts
  }
}
