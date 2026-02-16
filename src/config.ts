const isProduction = (process.env.NODE_ENV ?? 'production') === 'production'

const planModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const patchModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const fixerModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const reflectModel = isProduction ? 'claude-haiku-4-5' : 'claude-haiku-3'
const memoryModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const summarizerModel = isProduction ? 'claude-haiku-4-5' : 'claude-haiku-3'

export const config = {
	phases: {
		planner: { model: planModel, maxTokens: 4096 },
		builder: { model: patchModel, maxTokens: 16384 },
		fixer: { model: fixerModel, maxTokens: 16384 },
		reflect: { model: reflectModel, maxTokens: 512 },
		memory: { model: memoryModel, maxTokens: 64 },
		summarizer: { model: summarizerModel, maxTokens: 2048 },
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

	// Conversation compression thresholds
	summarization: {
		charThreshold: 20_000, // Tool results larger than this get summarized
		minResultChars: 300, // Minimum chars to keep in summarized results
		protectedTurns: 2, // Most recent turns never compressed
		gapMarker: '[Lines omitted from context. Re-read file if required context is missing.]', // Message shown where lines are omitted
	},

	db: {
		maxRetryAttempts: 5,
		retryInterval: 5_000, // 5 seconds
	},
} as const
