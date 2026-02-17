const isProduction = (process.env.NODE_ENV ?? 'production') === 'production'

const planModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const patchModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const fixerModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const reflectModel = isProduction ? 'claude-haiku-4-5' : 'claude-haiku-3'
const memoryModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
export const config = {
	phases: {
		planner: { model: planModel, maxTokens: 4096 },
		builder: { model: patchModel, maxTokens: 16384 },
		fixer: { model: fixerModel, maxTokens: 16384 },
		reflect: { model: reflectModel, maxTokens: 512 },
		memory: { model: memoryModel, maxTokens: 64 },
	},

	// Turn limits: max tool-use rounds per phase before giving up
	turns: {
		maxPlanner: 25,
		maxBuilder: 40,
		maxFixer: 20,
	},

	// Anthropic API retry strategy for rate limits
	api: {
		maxRetries: 5,
		initialRetryDelay: 30_000, // 30 seconds
		maxRetryDelay: 120_000, // 2 minutes
	},

	// Batch API polling configuration
	batch: {
		pollInterval: 10_000, // 10 seconds
		maxPollInterval: 60_000, // 1 minute
		pollBackoff: 1.5,
	},

	// CI check polling and timeout configuration
	ci: {
		pollInterval: 30_000, // 30 seconds
		timeout: 20 * 60_000, // 20 minutes
		noChecksTimeout: 2 * 60_000, // 2 minutes
	},

	// Git log and error formatting limits
	git: {
		recentLogCount: 10, // Number of commits shown in planner context
	},

	// Error detail truncation to prevent context overflow
	errors: {
		maxCheckOutputChars: 2000, // Max chars from CI check output in error details
		maxLoopErrorChars: 10000, // Max chars from CI failure in loop outcomes
	},

	// Memory system configuration
	memory: {
		tokenBudget: 10_000, // Soft limit for memory context size
		fullReflections: 5, // Most recent reflections shown in full
		summarizedReflections: 20, // Additional reflections shown as summaries
		estimationRatio: 4, // chars/token approximation for budget estimates
	},

	context: {
		protectedTurns: 1, // Last N turns keep full tool results inline; older results are stubbed
		minResultChars: 200, // Tool results shorter than this are never stubbed
		maxActiveLines: 2000, // Budget for working context in system prompt; oldest regions evicted first
		contextPadding: 5, // Extra lines shown above/below each tracked region
		defaultReadWindow: 300, // Default line count when read_file has no endLine
		thinkingBudget: 10_000, // Extended thinking budget for planner/builder/fixer/reflect
	},

	db: {
		maxRetryAttempts: 5,
		retryInterval: 5_000, // 5 seconds
	},
} as const
