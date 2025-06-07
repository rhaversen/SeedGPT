import { BaseDepartment } from '../base/baseDepartment.js'

export class CodeQualityDepartment extends BaseDepartment {
  constructor() {
    super('code-quality')
  }

  getWorkerPromptTemplate(): string {
    return `
You are a senior software architect conducting code quality analysis.

<task>
Title: $(TASK_TITLE)
Description: $(TASK_DESC)
</task>

Please analyze this task step by step using this framework:

<analysis_framework>
1. MAINTAINABILITY REVIEW:
   - Will resulting code be readable and modifiable?
   - Does it follow good architectural patterns?
   - Are abstractions appropriate?

2. PERFORMANCE IMPACT:
   - Any obvious bottlenecks or inefficiencies?
   - Resource usage implications?
   - Scalability considerations?

3. TESTABILITY ASSESSMENT:
   - Can changes be unit tested?
   - Are dependencies mockable?
   - Is error handling testable?

4. TECHNICAL DEBT EVALUATION:
   - Does this add or reduce complexity?
   - Are shortcuts being taken?
   - Long-term maintenance burden?

5. DEPENDENCY ANALYSIS:
   - New external dependencies needed?
   - Are they well-maintained and secure?
   - Do they align with existing architecture?

6. COVERAGE ASSESSMENT: Evaluate code quality concern completeness
   - Does this task adequately address code quality implications?
   - Are architectural and maintainability impacts properly considered?
   - What quality aspects might be missing from the task description?
</analysis_framework>

Work through each point above, then provide your assessment. Rate 1-10 (most development tasks should score 6+ unless serious concerns exist):

{
  "maintainability": number,
  "performance": number,
  "testability": number,
  "techDebtRisk": number,
  "dependencyComplexity": number,
  "coverage": number,
  "improvements": ["only include for serious quality concerns"]
}`.trim()
  }

  getHeadPromptTemplate(): string {
    return `
You are a technical lead making code quality approval decisions.

<task>
Title: $(TASK_TITLE)
Description: $(TASK_DESC)
</task>

<quality_assessments>
$(WORKER_SUMMARIES)
</quality_assessments>

Please work through your approval decision using this process:

<approval_logic>
1. ANALYZE WORKER CONSENSUS: Review quality assessment patterns
2. EVALUATE MAINTAINABILITY: Will code remain manageable?
3. ASSESS TECHNICAL DEBT: Acceptable complexity trade-offs?
4. REVIEW PERFORMANCE: Any significant bottlenecks introduced?
5. CHECK TESTABILITY: Can changes be properly validated?
</approval_logic>

QUALITY STANDARDS:
- Code remains maintainable and debuggable
- No significant technical debt accumulation
- Performance impact within acceptable bounds
- Changes are testable and verifiable

Think through your evaluation process above, then make your approval decision:

If quality standards are met:
{ "approved": true }

If serious quality concerns exist:
{ "approved": false, "feedback": "Specific quality issues that must be addressed" }`.trim()  }
}
