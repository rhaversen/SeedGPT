import { BaseDepartment, TaskContext } from '../base/baseDepartment.js'
import { WorkerResponse, WorkerPrompt, HeadPrompt } from '../../types/department.js'

interface CodeQualityResult {
  maintainability: number
  performance: number
  testability: number
  techDebtRisk: number
  dependencyComplexity: number
  qualityIssues: string[]
  improvements: string[]
}

export class CodeQualityDepartment extends BaseDepartment {
  constructor() {
    super('code-quality')
  }

  getWorkerPromptTemplate(): string {
    return `
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

Respond ONLY in JSON:
{
  "maintainability": 6,
  "performance": 8,
  "testability": 5,
  "techDebtRisk": 7,
  "dependencyComplexity": 4,
  "qualityIssues": ["..."],
  "improvements": ["..."]
}`.trim()
  }

  getHeadPromptTemplate(): string {
    return `You are a technical lead reviewing code quality assessments. Decide if this task meets quality standards or needs enhancements.

Worker Assessments:
\${summary}

Respond ONLY in JSON:
If approved: { "approved": true }
If not approved: { "approved": false, "feedback": "..." }`
  }
  parseWorkerResponses<T>(responses: WorkerResponse[]): T[] {
    return responses
      .map(r => this.parseJSON<CodeQualityResult>(r.response))
      .filter((result): result is CodeQualityResult => result !== null) as T[]
  }
  createSummary<T>(results: T[]): string {
    return (results as any[]).map((result: any, index) =>
      `Worker ${index + 1}:
  Maintainability=${result.maintainability}, Performance=${result.performance}, Testability=${result.testability}
  TechDebt=${result.techDebtRisk}, DependencyComplexity=${result.dependencyComplexity}
  Issues: ${result.qualityIssues.join(', ')}
  Improvements: ${result.improvements.join(', ')}`
    ).join('\n\n')
  }
}
