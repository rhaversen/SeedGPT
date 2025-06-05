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

	// Seed themes relevant to autonomous AI development
	const themeData = [
		{ name: 'AI Reasoning', description: 'Enhancing decision-making and problem-solving capabilities', priority: 'high' },
		{ name: 'Code Generation', description: 'Improving automated code creation and refactoring', priority: 'high' },
		{ name: 'Self-Monitoring', description: 'Building systems for autonomous performance tracking', priority: 'medium' },
		{ name: 'Tool Integration', description: 'Expanding available tools and APIs for development tasks', priority: 'medium' },
		{ name: 'Safety Systems', description: 'Implementing safeguards for autonomous operations', priority: 'high' },
		{ name: 'Learning & Adaptation', description: 'Developing capabilities for continuous improvement', priority: 'medium' },
		{ name: 'Task Management', description: 'Optimizing workflow and task orchestration', priority: 'medium' },
		{ name: 'Quality Assurance', description: 'Automated testing and validation systems', priority: 'high' }
	]
	const themes = await Theme.insertMany(themeData)
	logger.info(`Seeded ${themes.length} themes`)
	// Seed epics for autonomous AI development
	const epicData = [
		{ title: 'Enhanced Code Analysis', description: 'Develop advanced code understanding and generation capabilities', priority: 'high' },
		{ title: 'Autonomous Testing Framework', description: 'Build comprehensive automated testing and validation systems', priority: 'high' },
		{ title: 'Self-Improvement Pipeline', description: 'Create systems for continuous learning and capability enhancement', priority: 'medium' },
		{ title: 'Advanced Tool Integration', description: 'Expand available development tools and API integrations', priority: 'medium' },
		{ title: 'Safety & Governance System', description: 'Implement robust safety checks and operational governance', priority: 'high' },
		{ title: 'Intelligent Task Orchestration', description: 'Optimize task scheduling and dependency management', priority: 'medium' },
		{ title: 'Context-Aware Development', description: 'Build systems for better project understanding and context retention', priority: 'medium' },
		{ title: 'Performance Optimization Engine', description: 'Develop automated performance monitoring and optimization', priority: 'low' }
	]
	const epics = await Epic.insertMany(epicData)
	logger.info(`Seeded ${epics.length} epics`)
	// Seed stories for AI development features
	const storyData = [
		{ title: 'AST Code Parser', description: 'Implement abstract syntax tree parsing for better code understanding', priority: 'high' },
		{ title: 'Pattern Recognition Engine', description: 'Build system to identify code patterns and anti-patterns', priority: 'medium' },
		{ title: 'Automated Unit Test Generator', description: 'Create intelligent unit test generation for new functions', priority: 'high' },
		{ title: 'Integration Test Framework', description: 'Build comprehensive integration testing capabilities', priority: 'medium' },
		{ title: 'Capability Assessment Module', description: 'Develop self-assessment of current AI capabilities', priority: 'medium' },
		{ title: 'Learning Progress Tracker', description: 'Track and analyze learning progress over iterations', priority: 'low' },
		{ title: 'GitHub API Enhancement', description: 'Expand GitHub integration for better repository management', priority: 'medium' },
		{ title: 'VS Code Extension Creator', description: 'Build tool to automatically create VS Code extensions', priority: 'low' },
		{ title: 'Code Safety Validator', description: 'Implement static analysis for security vulnerabilities', priority: 'high' },
		{ title: 'Deployment Safety Checks', description: 'Add pre-deployment validation and rollback mechanisms', priority: 'high' },
		{ title: 'Dependency Manager', description: 'Intelligent dependency resolution and conflict detection', priority: 'medium' },
		{ title: 'Task Priority Engine', description: 'Optimize task scheduling based on complexity and dependencies', priority: 'low' },
		{ title: 'Project Context Manager', description: 'Maintain and utilize project history and context', priority: 'medium' },
		{ title: 'Code Documentation Generator', description: 'Automatically generate comprehensive code documentation', priority: 'low' },
		{ title: 'Performance Profiler', description: 'Monitor and analyze system performance metrics', priority: 'low' },
		{ title: 'Resource Usage Optimizer', description: 'Optimize CPU, memory, and API usage patterns', priority: 'low' }
	]
	const stories = await Story.insertMany(storyData)
	logger.info(`Seeded ${stories.length} stories`)
	// Seed tasks with proper department approvals for AI development
	const taskData = [
		{
			title: 'Implement TypeScript AST Parser',
			description: 'Create a TypeScript Abstract Syntax Tree parser to analyze code structure and identify improvement opportunities',
			priority: 'high',
			context: 'Requires understanding of TypeScript compiler API, AST node types, and the existing codebase structure in src/app/models/ and src/app/services/. Review typescript package documentation and existing file parsing utilities.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Build Code Pattern Detector',
			description: 'Develop a system to identify common code patterns, anti-patterns, and potential improvements',
			priority: 'medium',
			context: 'Study existing code quality tools, ESLint rules configuration, and analyze patterns in src/app/ directories. Review code-quality service implementations and static analysis libraries.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Create Function Test Generator',
			description: 'Build an intelligent system that generates comprehensive unit tests for TypeScript functions',
			priority: 'high',
			context: 'Study testing frameworks (Jest, Vitest), examine existing test files in src/tests/, understand function signatures parsing, and review test generation libraries. Analyze src/app/ structure for test patterns.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Implement End-to-End Test Suite',
			description: 'Create comprehensive integration tests for the entire SeedGPT orchestration pipeline',
			priority: 'medium',
			context: 'Review src/app/orchestrator/ files, understand workflow dependencies, examine database models in src/app/models/, and study integration testing frameworks like Playwright or Cypress.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Build Capability Self-Assessment',
			description: 'Develop a system for SeedGPT to evaluate its own capabilities and identify improvement areas',
			priority: 'medium',
			context: 'Analyze src/app/services/ implementations, understand capability tracking systems, review performance metrics collection, and study self-assessment algorithms in AI systems.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Create Learning Metrics Dashboard',
			description: 'Build a monitoring system to track learning progress and capability improvements over time',
			priority: 'low',
			context: 'Study dashboard frameworks (React, Vue), examine data visualization libraries (Chart.js, D3), review src/app/utils/logger.js for metrics collection patterns, and understand time-series data storage.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Enhance GitHub Repository Management',
			description: 'Expand GitHub API integration for better branch management, PR creation, and repository operations',
			priority: 'medium',
			context: 'Review GitHub API documentation, examine existing Git integration in src/app/services/, understand authentication patterns, and study repository management workflows in the codebase.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Build VS Code Extension Generator',
			description: 'Create a tool that automatically generates VS Code extensions based on development needs',
			priority: 'low',
			context: 'Study VS Code Extension API, examine extension manifest structure, review yeoman generators, understand TypeScript compilation for extensions, and analyze existing extension templates.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Implement Static Security Analysis',
			description: 'Build automated security vulnerability detection for code changes and new features',
			priority: 'high',
			context: 'Review security scanning tools (ESLint security plugins, Snyk, OWASP), examine src/app/ for security patterns, understand vulnerability databases, and study static analysis techniques.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Create Deployment Rollback System',
			description: 'Implement automated rollback mechanisms for failed deployments or problematic changes',
			priority: 'high',
			context: 'Study deployment pipelines, examine Docker configurations, understand Git operations for rollbacks, review health check implementations, and analyze deployment scripts in the project.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Build Dependency Conflict Resolver',
			description: 'Create intelligent dependency management with automatic conflict resolution',
			priority: 'medium',
			context: 'Examine package.json and package-lock.json, study npm/yarn dependency resolution algorithms, understand semantic versioning, and review dependency management tools like npm-check-updates.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Implement Smart Task Prioritization',
			description: 'Build an AI-driven task prioritization system based on dependencies, complexity, and impact',
			priority: 'low',
			context: 'Study task scheduling algorithms, examine src/app/models/task.schema.js, understand dependency graphs, review priority calculation systems, and analyze workflow optimization techniques.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Create Project Context Memory',
			description: 'Develop a system to maintain and utilize project history, decisions, and context across iterations',
			priority: 'medium',
			context: 'Study context management systems, examine database schemas in src/app/models/, understand memory storage patterns, review decision tracking systems, and analyze project history formats.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Build Automated Documentation Generator',
			description: 'Create a system that automatically generates and maintains comprehensive code documentation',
			priority: 'low',
			context: 'Study documentation generators (JSDoc, TypeDoc), examine existing documentation patterns, understand comment parsing, review markdown generation libraries, and analyze code structure in src/app/.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Implement Performance Monitoring',
			description: 'Build real-time performance monitoring for system resources and operation efficiency',
			priority: 'low',
			context: 'Study Node.js performance APIs, examine monitoring libraries (prom-client, node-clinic), understand metrics collection patterns, review src/app/utils/ for existing monitoring, and analyze system resource tracking.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		},
		{
			title: 'Create Resource Usage Optimizer',
			description: 'Develop intelligent optimization for CPU, memory, and API usage to minimize costs',
			priority: 'low',
			context: 'Study resource optimization techniques, examine Node.js profiling tools, understand memory management patterns, review API rate limiting implementations, and analyze performance bottlenecks in existing services.',
			approvals: [
				{ department: 'evaluation', approved: false },
				{ department: 'code-quality', approved: false },
				{ department: 'safety', approved: false }
			]
		}
	]
	const tasks = await Task.insertMany(taskData)
	logger.info(`Seeded ${tasks.length} tasks`)
	logger.info('Database seeded successfully')
}

await seedDatabase()
