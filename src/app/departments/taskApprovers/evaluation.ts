import { BaseDepartment } from '../base/baseDepartment.js'

export class EvaluationDepartment extends BaseDepartment {
  constructor() {
    super('evaluation')
  }

  getWorkerPromptTemplate(): string {
    return `
You are an expert task evaluator using a structured reasoning approach.

<task>
Title: $(TASK_TITLE)
Description: $(TASK_DESC)
</task>

Please think through this evaluation step by step using this framework:

<analysis_framework>
1. CLARITY ANALYSIS: Examine the task requirements
   - Are the goals explicitly stated?
   - Are implementation details sufficient?
   - What specific aspects need clarification?

2. FEASIBILITY ASSESSMENT: Evaluate implementation possibility
   - Can this be completed in a single iteration?
   - Are there any blocking dependencies?
   - What technical constraints exist?

3. SCOPE EVALUATION: Determine task boundaries
   - Is this appropriately sized for one task?
   - Should it be split or combined with others?
   - Does it have clear start/end conditions?

4. EFFORT ESTIMATION: Assess implementation complexity
   - What technical skills are required?
   - How many components need modification?
   - What is the learning curve?

5. IMPACT CALCULATION: Determine value proposition
   - How does this improve the SeedGPT system?
   - What problems does it solve?
   - What is the risk/reward ratio?

6. COVERAGE ASSESSMENT: Evaluate departmental concern completeness
   - Does this task address evaluation concerns (clarity, feasibility, scope)?
   - Are requirements detailed enough for proper assessment?
   - What evaluation aspects might be missing from the task description?
</analysis_framework>

Work through each step above, showing your reasoning. Then provide your final evaluation as JSON:

{
  "clarity": number,
  "feasibility": number,
  "scope": number,
  "effort": number,
  "impact": number,
  "coverage": number,
  "improvements": ["only include if genuinely unclear or unachievable"]
}`.trim()
  }

  getHeadPromptTemplate(): string {
    return `
You are a senior project manager making task approval decisions.

<task>
Title: $(TASK_TITLE)
Description: $(TASK_DESC)
</task>

<worker_evaluations>
$(WORKER_SUMMARIES)
</worker_evaluations>

Please analyze the worker evaluations using this process:

<decision_process>
1. REVIEW WORKER CONSENSUS: Identify patterns in worker feedback
2. EVALUATE CLARITY: Are requirements actionable for developers?
3. ASSESS FEASIBILITY: Can this be implemented as described?
4. DETERMINE VALUE: Does this meaningfully improve SeedGPT?
5. CHECK COMPLETENESS: Are specifications developer-ready?
</decision_process>

APPROVAL CRITERIA:
- Clear, actionable requirements that developers can implement
- Feasible within stated scope and single iteration
- Meaningful value to SeedGPT system evolution
- Sufficient specificity to avoid implementation ambiguity

Think through your decision process above, then provide your final decision:

If APPROVED:
{ "approved": true }

If REJECTED (only for fundamental clarity or feasibility issues):
{ "approved": false, "feedback": "Specific requirements needed for approval" }`.trim()  }
}
