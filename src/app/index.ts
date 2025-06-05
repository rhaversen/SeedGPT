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

// Verify that all environment secrets are set
import './utils/verifyEnvironmentSecrets.js'

import { TaskValidator } from './services/taskValidator.js'
import logger from './utils/logger.js'
import databaseConnector from './utils/databaseConnector.js'
import connectToInMemoryMongoDB from '../tests/mongoMemoryReplSetConnector.js'

const { NODE_ENV } = process.env as Record<string, string>

// Logging environment
logger.info(`Node environment: ${NODE_ENV}`)

// Connect to MongoDB in production, or use in-memory MongoDB for testing
if (NODE_ENV === 'production') {
  await databaseConnector.connectToMongoDB()
} else {
  connectToInMemoryMongoDB()
}

class SeedGPTOrchestrator {
  private taskValidator: TaskValidator

  constructor() {
    this.taskValidator = new TaskValidator()
  }  async run(): Promise<void> {
    logger.info('🚀 SeedGPT Orchestrator starting...')

    try {
      logger.info('Starting task validator tick...')
      this.taskValidator.validateTasks()
      logger.info('✅ All prompts processed successfully. Orchestrator run completed.')
    } catch (error) {
      logger.error('Error in orchestrator:', { error })
    }
  }
}

const orchestrator = new SeedGPTOrchestrator()
orchestrator.run().catch(logger.error)
