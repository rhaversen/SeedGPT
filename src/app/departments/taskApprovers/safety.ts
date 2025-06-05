import { BaseDepartment } from '../base/baseDepartment.js'
import { WorkerResponse, WorkerPrompt, HeadPrompt } from '../../types/department.js'
import { getEligibleTasks, getTask } from '../../scrum.js'

interface WorkerSafetyResult {
  securityRisk: number
  ethicalConcerns: number
  stabilityRisk: number
  complianceIssues: number
  operationalRisk: number
  threats: string[]
  mitigations: string[]
}

export class SafetyDepartment extends BaseDepartment {
  id = 'safety'

  constructor() {
    super('safety')
  }

  async getDepartmentWorkerBatchPrompts(): Promise<WorkerPrompt[]> {
    const prompts: WorkerPrompt[] = []
    const tasksUnderReview = await getEligibleTasks()

    for (const task of tasksUnderReview) {
      const basePrompt = `
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

Respond ONLY in JSON, e.g.:
{
  "securityRisk": 7,
  "ethicalConcerns": 3,
  "stabilityRisk": 5,
  "complianceIssues": 2,
  "operationalRisk": 6,
  "threats": ["..."],
  "mitigations": ["..."]
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

      const parsed: WorkerSafetyResult[] = reps
        .map(r => this.parseJSON<WorkerSafetyResult>(r.response))
        .filter((x): x is WorkerSafetyResult => x !== null)

      if (parsed.length === 0) {
        return
      }

      const summary = parsed.map((s, i) =>
        `Worker ${i + 1}:
  SecurityRisk=${s.securityRisk}, Ethical=${s.ethicalConcerns}, Stability=${s.stabilityRisk}, Compliance=${s.complianceIssues}, Operational=${s.operationalRisk}
  Threats: ${s.threats.join(', ')}
  Mitigations: ${s.mitigations.join(', ')}`
      ).join('\n\n')

      prompts.push({
        department: this.id,
        taskId,
        headId: `${this.id}-head-${taskId}`,
        prompt: `You are a chief security officer reviewing task safety assessments. Decide if this task should be approved or needs security enhancements.

Original Task:
Title: ${task.title}
Description: ${task.description}

Risk Assessment Criteria (1-10 scale, 10 = critical risk):
- Security Risk: Authentication, authorization, data exposure, injection attacks
- Ethical Concerns: Privacy violations, bias, harmful content, misuse potential  
- Stability Risk: System crashes, data corruption, performance degradation
- Compliance Issues: GDPR, HIPAA, accessibility, regulatory requirements
- Operational Risk: Monitoring gaps, rollback complexity, dependency failures

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
