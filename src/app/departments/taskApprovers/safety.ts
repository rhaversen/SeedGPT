import { BaseDepartment, TaskContext } from '../base/baseDepartment.js'
import { WorkerResponse, WorkerPrompt, HeadPrompt } from '../../types/department.js'

interface SafetyResult {
  securityRisk: number
  ethicalConcerns: number
  stabilityRisk: number
  complianceIssues: number
  operationalRisk: number
  threats: string[]
  mitigations: string[]
}

export class SafetyDepartment extends BaseDepartment {
  constructor() {
    super('safety')
  }

  getWorkerPromptTemplate(): string {
    return `
You are a security and safety expert. Analyze this software development task for risks:

Task: $(TASK_TITLE)
Description: $(TASK_DESC)

Assess risk levels (1–10, 10 = critical risk):
- Security: Authentication, injection, data exposure
- Ethical: Privacy violations, bias, harmful content
- Stability: System crashes, performance degradation
- Compliance: GDPR, HIPAA, regulatory requirements
- Operational: Monitoring, rollback plans, dependency failure

Identify threats and propose mitigations.

Respond ONLY in JSON:
{
  "securityRisk": 7,
  "ethicalConcerns": 3,
  "stabilityRisk": 5,
  "complianceIssues": 2,
  "operationalRisk": 6,
  "threats": ["..."],
  "mitigations": ["..."]
}`.trim()
  }

  getHeadPromptTemplate(): string {
    return `You are a chief security officer reviewing task safety assessments. Decide if this task should be approved or needs security enhancements.

Risk Assessment Criteria (1-10 scale, 10 = critical risk):
- Security Risk: Authentication, authorization, data exposure, injection attacks
- Ethical Concerns: Privacy violations, bias, harmful content, misuse potential  
- Stability Risk: System crashes, data corruption, performance degradation
- Compliance Issues: GDPR, HIPAA, accessibility, regulatory requirements
- Operational Risk: Monitoring gaps, rollback complexity, dependency failures

Worker Assessments:
\${summary}

Respond ONLY in JSON:
If approved: { "approved": true }
If not approved: { "approved": false, "feedback": "..." }`
  }
  parseWorkerResponses<T>(responses: WorkerResponse[]): T[] {
    return responses
      .map(r => this.parseJSON<SafetyResult>(r.response))
      .filter((result): result is SafetyResult => result !== null) as T[]
  }
  createSummary<T>(results: T[]): string {
    return (results as any[]).map((result: any, index) =>
      `Worker ${index + 1}:
  SecurityRisk=${result.securityRisk}, Ethical=${result.ethicalConcerns}, Stability=${result.stabilityRisk}
  Compliance=${result.complianceIssues}, Operational=${result.operationalRisk}
  Threats: ${result.threats.join(', ')}
  Mitigations: ${result.mitigations.join(', ')}`
    ).join('\n\n')
  }
}
