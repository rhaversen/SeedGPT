// file deepcode ignore NoHardcodedPasswords/test: Hardcoded credentials are only used for testing purposes
// file deepcode ignore NoHardcodedCredentials/test: Hardcoded credentials are only used for testing purposes
// file deepcode ignore HardcodedNonCryptoSecret/test: Hardcoded credentials are only used for testing purposes

import { Theme } from '../app/models/theme.schema.js'
import { Epic } from '../app/models/epic.schema.js'
import { Story } from '../app/models/story.schema.js'
import { Task } from '../app/models/task.schema.js'

import logger from '../app/utils/logger.js'

logger.info('Seeding database')

async function seedDatabase(): Promise<void> {
	// Clear existing data
	await Theme.deleteMany({})
	await Epic.deleteMany({})
	await Story.deleteMany({})
	await Task.deleteMany({})

	const themes = await Theme.insertMany([
		{ name: 'Department Enhancement', description: 'Improving the three-department task validation system (evaluation, code-quality, safety)', priority: 'high' },
		{ name: 'Batch Processing Optimization', description: 'Enhancing AnthropicBatchClient efficiency and reliability', priority: 'high' },
		{ name: 'Database Layer Improvements', description: 'Optimizing MongoDB operations and schema design', priority: 'medium' },
		{ name: 'Task Orchestration', description: 'Improving the SeedGPT orchestrator workflow and error handling', priority: 'high' },
		{ name: 'Development Infrastructure', description: 'CI/CD, testing, and deployment pipeline enhancements', priority: 'medium' },
		{ name: 'Code Quality Systems', description: 'Static analysis, linting, and automated code improvements', priority: 'medium' }
	])
	logger.info(`Seeded ${themes.length} themes`)

	const epics = await Epic.insertMany([
		{ title: 'Enhanced Department Worker System', description: 'Improve the worker-head department architecture with better prompt templates and response parsing', priority: 'high' },
		{ title: 'Robust Batch Processing Pipeline', description: 'Build resilient batch processing with retry logic, monitoring, and error recovery', priority: 'high' },
		{ title: 'Advanced Task Management', description: 'Implement sophisticated task dependencies, splitting, and approval workflows', priority: 'medium' },
		{ title: 'Comprehensive Testing Framework', description: 'Create end-to-end testing for the entire SeedGPT pipeline using in-memory MongoDB', priority: 'high' },
		{ title: 'Production-Ready Deployment', description: 'Enhance Docker, Kubernetes, and CI/CD pipeline for reliable production deployment', priority: 'medium' },
		{ title: 'Monitoring & Observability', description: 'Implement comprehensive logging, metrics, and performance monitoring', priority: 'medium' }
	])
	logger.info(`Seeded ${epics.length} epics`)

	const stories = await Story.insertMany([
		{ title: 'Department Prompt Optimization', description: 'Improve worker and head prompt templates for better AI responses', priority: 'high' },
		{ title: 'Response Parser Enhancement', description: 'Make JSON parsing more robust and handle edge cases', priority: 'high' },
		{ title: 'Batch Status Monitoring', description: 'Add real-time monitoring for Anthropic batch processing', priority: 'medium' },
		{ title: 'Task Context Enrichment', description: 'Enhance task context with file references and dependency information', priority: 'medium' },
		{ title: 'Database Connection Resilience', description: 'Improve MongoDB connection handling and retry logic', priority: 'high' },
		{ title: 'Schema Migration System', description: 'Implement database schema versioning and migration tools', priority: 'low' },
		{ title: 'Integration Test Suite', description: 'Create comprehensive tests for the TaskValidator and department workflows', priority: 'high' },
		{ title: 'Performance Benchmarking', description: 'Add performance metrics and benchmarking for key operations', priority: 'low' },
		{ title: 'Container Optimization', description: 'Optimize Docker image size and startup performance', priority: 'medium' },
		{ title: 'Environment Configuration', description: 'Improve environment variable management and validation', priority: 'medium' }
	])
	logger.info(`Seeded ${stories.length} stories`)

	const tasks = await Task.insertMany([
		{
			title: 'Enhance EvaluationDepartment Response Parsing',
			description: 'Improve the parseWorkerResponses method in EvaluationDepartment to handle malformed JSON and partial responses more gracefully',
			priority: 'high',
			context: 'Located in src/app/departments/taskApprovers/evaluation.ts. The current implementation logs warnings but could be more robust. Review the parseJSON method in BaseDepartment and add fallback mechanisms for common JSON parsing failures.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Add Batch Processing Retry Logic',
			description: 'Implement retry mechanisms in AnthropicBatchClient for failed batch operations and network timeouts',
			priority: 'high',
			context: 'Enhance src/app/services/anthropicBatchClient.ts with exponential backoff retry logic for processBatch, getBatchStatus, and result fetching operations. Consider rate limiting and API error codes.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Implement Task Dependency Tracking',
			description: 'Add dependency relationships between tasks in the Task schema and update the TaskValidator to respect dependencies',
			priority: 'medium',
			context: 'Modify src/app/models/task.schema.ts to include a dependencies field (array of task IDs). Update src/app/services/taskValidator.ts to process tasks in dependency order and handle circular dependencies.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Optimize MongoDB Connection Pooling',
			description: 'Enhance database connection management in databaseConnector.ts with proper connection pooling and health checks',
			priority: 'medium',
			context: 'Update src/app/utils/databaseConnector.ts to configure mongoose connection pooling options, add connection health monitoring, and implement graceful shutdown handling.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Add Department Worker Count Configuration',
			description: 'Make the worker count configurable per department instead of hardcoded to 10',
			priority: 'low',
			context: 'Modify src/app/departments/base/baseDepartment.ts to accept worker count in constructor or through configuration. Consider different worker counts for different department types based on complexity.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Create TaskValidator Integration Tests',
			description: 'Build comprehensive integration tests for the TaskValidator using the in-memory MongoDB setup',
			priority: 'high',
			context: 'Create test file in src/tests/ that uses mongoMemoryReplSetConnector.ts to test complete TaskValidator workflows. Test worker batch processing, head batch processing, and approval updates.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Implement Structured Logging Context',
			description: 'Enhance the logger utility to include structured context like request IDs, batch IDs, and task IDs',
			priority: 'medium',
			context: 'Update src/app/utils/logger.ts to support request correlation IDs and structured logging context. Ensure batch processing operations can be traced across the entire pipeline.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Add Batch Processing Metrics',
			description: 'Implement metrics collection for batch processing performance, success rates, and response times',
			priority: 'medium',
			context: 'Enhance AnthropicBatchClient to collect and log performance metrics. Track batch creation time, processing duration, success/failure rates, and response quality metrics.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Improve Department Prompt Templates',
			description: 'Enhance the prompt templates in all three departments to produce more consistent and parseable responses',
			priority: 'high',
			context: 'Review and update prompt templates in src/app/departments/taskApprovers/ (evaluation.ts, codeQuality.ts, safety.ts) to improve JSON response consistency and provide clearer evaluation criteria.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Add Environment Variable Validation',
			description: 'Enhance verifyEnvironmentSecrets.ts to validate not just presence but also format and validity of environment variables',
			priority: 'medium',
			context: 'Update src/app/utils/verifyEnvironmentSecrets.ts to validate API key formats, database connection strings, and other environment variables beyond just checking existence.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Implement Task Context File References',
			description: 'Enhance task context to include specific file paths and code references for better department evaluation',
			priority: 'medium',
			context: 'Modify task schema and TaskValidator to include file references in task context. This will help departments make more informed decisions about code changes and dependencies.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Add Graceful Error Recovery',
			description: 'Implement graceful error recovery in the main orchestrator for partial batch failures and department unavailability',
			priority: 'high',
			context: 'Enhance src/app/index.ts orchestrator to handle partial failures gracefully, allowing some tasks to proceed even if others fail, and implement proper cleanup on errors.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		}
	])
	logger.info(`Seeded ${tasks.length} tasks`)
	logger.info('Database seeded successfully')
}

await seedDatabase()
