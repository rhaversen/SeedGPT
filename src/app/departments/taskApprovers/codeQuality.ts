import { BaseDepartment } from '../base/baseDepartment.js'
import { WorkerResponse, WorkerPrompt, HeadPrompt } from '../../types/department.js'
import { getEligibleTasks, getTask } from '../../scrum.js'

interface WorkerCodeQualityResult {
  maintainability: number
  performance: number
  testability: number
  techDebtRisk: number
  dependencyComplexity: number
  qualityIssues: string[]
  improvements: string[]
}

export class CodeQualityDepartment extends BaseDepartment {
  id = 'code-quality'

  constructor() {
    super('code-quality')
  }
  async getDepartmentWorkerBatchPrompts(): Promise<WorkerPrompt[]> {
    const prompts: WorkerPrompt[] = []
    const tasks = await getEligibleTasks()

    for (const task of tasks) {
      const basePrompt = `
You are a senior software architect reviewing code quality implications. Analyze this task:

Task: $(TASK_TITLE)
Description: $(TASK_DESC)

Assess these on a 1-10 scale (10 = best, 1 = worst):
- Maintainability: Code clarity, modularity, documentation
- Performance: Efficiency, scalability, resource usage
- Testability: Ease of unit/integration testing
- Tech Debt Risk: Will this introduce complexity or duplication?
- Dependency Complexity: Third-party requirements, version conflicts

Identify quality issues and suggest improvements.

Respond ONLY in JSON, e.g.:
{
  "maintainability": 6,
  "performance": 8,
  "testability": 5,
  "techDebtRisk": 7,
  "dependencyComplexity": 4,
  "qualityIssues": ["..."],
  "improvements": ["..."]
}`.trim()

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

      const parsedResults: WorkerCodeQualityResult[] = reps
        .map(r => this.parseJSON<WorkerCodeQualityResult>(r.response))
        .filter((x): x is WorkerCodeQualityResult => x !== null)

      if (parsedResults.length === 0) {
        return
      }

      const summary = parsedResults.map((a, i) =>
        `Worker ${i + 1}:
  Maintainability=${a.maintainability},
  Performance=${a.performance},
  Testability=${a.testability},
  TechDebt=${a.techDebtRisk},
  DependencyComplexity=${a.dependencyComplexity}
  Issues: ${a.qualityIssues.join(', ')}
  Improvements: ${a.improvements.join(', ')}`
      ).join('\n\n')

      prompts.push({
        department: this.id,
        taskId,
        headId: `${this.id}-head-${taskId}`,
        prompt: `You are a technical lead reviewing code quality assessments. Decide if this task meets quality standards or needs enhancements.

Original Task:
Title: ${task.title}
Description: ${task.description}

Worker Assessments:
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
