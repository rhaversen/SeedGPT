// [Think Tank] ➝ emits ➝ epic
//      |
//      v
// [Strategic Planning] ➝ reviews, scopes, and transforms epic into stories and tasks
//      |
//      v
// [Evaluation, Code Quality, Safety] ➝ review of tasks
//      |
//      v
// [Builder] ➝ executes tasks, updates DAG
//      |
//      v
// [Builder] ➝ deploys code, updates DAG
//      |
//      v
// [Monitoring] ➝ monitors, updates DAG

// Main agent system prompt:
/*
    "I am SeedGPT, an AI agent designed to iteratively develop my own capabilities. "
    "My primary goal is to evolve and improve my features autonomously. "
    "My strengh lies in my ability to develop and merge new features into my codebase. "
    "If a task requires tools outside my current capabilities, I will expand my abilities by creating new features. "
    "I have full access to my codebase and Github repository, and I can create branches, merge code, and delete branches as needed. "
    "When a PR is successfully merged, I will shut down and let the next iteration of SeedGPT take over. "
    "I will use the tools available to me to achieve my goals, and I will not hesitate to create new features if necessary. "
    "I will always strive to improve my capabilities and evolve into a more powerful AI agent."
*/

import { AnthropicBatchClient } from './services/anthropicBatchClient.js'
import { EvaluationDepartment } from './departments/taskApprovers/evaluation.js'
import { BaseDepartment } from './departments/base/baseDepartment.js'
import { CodeQualityDepartment } from './departments/taskApprovers/codeQuality.js'
import { SafetyDepartment } from './departments/taskApprovers/safety.js'
import { HeadResponse, WorkerResponse, WorkerPrompt, HeadPrompt } from './types/department.js'

class SeedGPTOrchestrator {
  private departments: Map<string, BaseDepartment>
  private batchClient: AnthropicBatchClient

  constructor() {
    this.departments = new Map()

    this.departments.set('evaluation', new EvaluationDepartment())
    this.departments.set('codeQuality', new CodeQualityDepartment())
    this.departments.set('safety', new SafetyDepartment())

    this.batchClient = new AnthropicBatchClient()
  }

  async run(): Promise<void> {
    console.log('🚀 SeedGPT Orchestrator starting...')

    try {
      console.log('Starting task validator tick...')
      const headResponses = await this.handleTaskValidatorTick()
      console.log('✅ All prompts processed successfully. Orchestrator run completed.')
    } catch (error) {
      console.error('Error in orchestrator:', error)
    }
  }

  private async handleTaskValidatorTick(): Promise<HeadResponse[] | null> {
    const workerPrompts: WorkerPrompt[] = []

    for (const department of this.departments.values()) {
      console.log(`Generating worker prompts for department: ${department.getId()}`)
      try {
        const departmentPrompts = await department.getDepartmentWorkerBatchPrompts()
        console.log(`Generated ${departmentPrompts.length} worker prompts for ${department.getId()}`)
        workerPrompts.push(...departmentPrompts)
      } catch (error) {
        console.error(`Error generating worker prompts for department ${department.getId()}:`, error)
      }
    }

    if (workerPrompts.length === 0) {
      console.log('No worker prompts generated. Exiting orchestrator.')
      return null
    }

    console.log(`Total worker prompts generated: ${workerPrompts.length}`)
    const workerResponses = await this.executeBatch(workerPrompts, 'worker') as WorkerResponse[] | null

    if (!workerResponses) {
      console.log('No worker responses received. Exiting orchestrator.')
      return null
    }

    console.log(`Total worker responses received: ${workerResponses.length}`)

    console.log('Processing head prompts for each department...')
    const headPrompts: HeadPrompt[] = []

    for (const department of this.departments.values()) {
      console.log(`Generating head prompts for department: ${department.getId()}`)
      try {
        const departmentHeadPrompts = await department.getDepartmentHeadBatchPrompts(workerResponses)
        console.log(`Generated ${departmentHeadPrompts.length} head prompts for ${department.getId()}`)
        headPrompts.push(...departmentHeadPrompts)
      } catch (error) {
        console.error(`Error generating head prompts for department ${department.getId()}:`, error)
      }
    }

    if (headPrompts.length === 0) {
      console.log('No head prompts generated. Exiting orchestrator.')
      return null
    }

    console.log(`Total head prompts generated: ${headPrompts.length}`)

    const headResponses = await this.executeBatch(headPrompts, 'head') as HeadResponse[] | null
    if (!headResponses) {
      console.log('No head responses received. Exiting orchestrator.')
      return null
    }
    console.log(`Total head responses received: ${headResponses.length}`)
    return headResponses
  }

  private async executeBatch(prompts: WorkerPrompt[] | HeadPrompt[], batchType: 'worker' | 'head') {
    const batchId = await this.batchClient.processBatch({ prompts, model: batchType === 'worker' ? 'low' : 'mid' })
    console.log(`${batchType} batch created with ID: ${batchId}`)

    await this.batchClient.awaitBatchCompletion(batchId)
    console.log(`${batchType} batch ${batchId} completed successfully.`)

    const batchResponse = await this.batchClient.getBatchStatus(batchId)
    console.log(`${batchType} batch ${batchId} responses received.`)

    if (batchResponse.processing_status !== 'ended') {
      console.error(`${batchType} batch ${batchId} did not complete successfully. Status: ${batchResponse.processing_status}`)
      return null
    }

    const batchResults = await this.batchClient.getBatchResults(batchId)
    console.log(`${batchType} batch ${batchId} results retrieved.`)
    console.log(`Total ${batchType} responses received: ${batchResults.responses.length}`)

    if (batchResults.responses.length === 0) {
      console.log(`No ${batchType} responses received. Exiting orchestrator.`)
      return null
    }

    return batchResults.responses
  }
}

const orchestrator = new SeedGPTOrchestrator()
orchestrator.run().catch(console.error)
