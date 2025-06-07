import { BaseDepartment } from '../base/baseDepartment.js'

export class SafetyDepartment extends BaseDepartment {
  constructor() {
    super('safety')
  }

  getWorkerPromptTemplate(): string {
    return `
You are a security and safety expert conducting risk analysis.

<task>
Title: $(TASK_TITLE)
Description: $(TASK_DESC)
</task>

Context: SeedGPT is a local development system, not a SaaS product. No user data, payments, or external services.

Please analyze this task step by step using this framework:

<risk_assessment>
1. SECURITY VULNERABILITY SCAN:
   - Code injection possibilities?
   - Input validation gaps?
   - Authentication/authorization impacts?

2. DATA SAFETY REVIEW:
   - Risk to development data integrity?
   - Backup and recovery considerations?
   - Database operation safety?

3. SYSTEM STABILITY ANALYSIS:
   - Potential for crashes or hangs?
   - Resource exhaustion risks?
   - Graceful error handling?

4. CODE SAFETY EVALUATION:
   - Malicious pattern introduction?
   - Unsafe operations or side effects?
   - Error propagation concerns?

5. COVERAGE ASSESSMENT: Evaluate safety concern completeness
   - Does this task adequately address safety and security implications?
   - Are security, stability, and data safety risks properly considered?
   - What safety aspects might be missing from the task description?
</risk_assessment>

Work through each risk category above, then provide your assessment. Rate risk levels 1-10 (most internal development tasks score 2-4):

{
  "securityRisk": number,
  "dataSafety": number,
  "stabilityRisk": number,
  "codeSafety": number,
  "coverage": number,
  "improvements": ["only include for genuine safety concerns"]
}`.trim()
  }

  getHeadPromptTemplate(): string {
    return `
You are a chief security officer making safety approval decisions.

<task>
Title: $(TASK_TITLE)
Description: $(TASK_DESC)
</task>

<safety_assessments>
$(WORKER_SUMMARIES)
</safety_assessments>

Please work through your safety evaluation using this process:

<safety_evaluation>
1. SECURITY RISK REVIEW: Examine vulnerability potential
2. DATA PROTECTION ANALYSIS: Assess integrity risks
3. STABILITY IMPACT ASSESSMENT: Evaluate system reliability
4. CODE SAFETY VERIFICATION: Check for dangerous patterns
5. MITIGATION ADEQUACY: Review proposed safeguards
</safety_evaluation>

SAFETY STANDARDS:
- No significant security vulnerabilities introduced
- System stability and data integrity maintained
- Code patterns are safe and non-malicious
- Acceptable risk level for internal development system

Think through your safety evaluation above, then make your decision:

If safety standards are met:
{ "approved": true }

If significant safety risks exist:
{ "approved": false, "feedback": "Specific safety risks that must be mitigated" }`.trim()  }
}
