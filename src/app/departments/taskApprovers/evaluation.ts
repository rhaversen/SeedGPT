import { WorkerResponse, WorkerPrompt, HeadPrompt } from '../../types/department.js'
import { BaseDepartment, TaskContext } from '../base/baseDepartment.js'
import logger from '../../utils/logger.js'

interface EvaluationResult {
  clarity: number
  feasibility: number
  scope: number
  effort: number
  impact: number
  suggestions: string[]
}

export class EvaluationDepartment extends BaseDepartment {
  constructor() {
    super('evaluation')
  }

  getWorkerPromptTemplate(): string {
    return `
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

Respond ONLY in JSON:
{
  "clarity": 8,
  "feasibility": 7,
  "scope": 6,
  "effort": 5,
  "impact": 9,
  "suggestions": ["..."]
}`.trim()
  }

  getHeadPromptTemplate(): string {
    return `You are a senior project manager reviewing task evaluations. Based on multiple worker assessments, decide if this task is approved.

Worker Evaluations:
\${summary}

Respond ONLY in JSON:
If approved: { "approved": true }
If not approved: { "approved": false, "feedback": "..." }`
  }  parseWorkerResponses<T>(responses: WorkerResponse[]): T[] {
    logger.info(`Evaluation: Parsing ${responses.length} worker responses`)
    
    const results = responses
      .map((r, index) => {
        logger.info(`Evaluation: Worker response ${index}:`, { taskId: r.taskId, response: r.response })
        const parsed = this.parseJSON<EvaluationResult>(r.response)
        if (!parsed) {
          logger.warn(`Evaluation: Failed to parse worker response ${index} for task ${r.taskId}`)
        }
        return parsed
      })
      .filter((result): result is EvaluationResult => result !== null)
    
    logger.info(`Evaluation: Successfully parsed ${results.length} out of ${responses.length} responses`)
    return results as T[]
  }
  createSummary<T>(results: T[]): string {
    return (results as any[]).map((result: any, index) =>
      `Worker ${index + 1}:
  Clarity=${result.clarity}, Feasibility=${result.feasibility}, Scope=${result.scope}, Effort=${result.effort}, Impact=${result.impact}
  Suggestions: ${result.suggestions.join(', ')}`
    ).join('\n\n')
  }
}
