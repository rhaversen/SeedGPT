const env = process.env.NODE_ENV ?? 'production'
const isProduction = env === 'production'

function requireEnv(key: string): string {
	const value = process.env[key]
	if (!value) throw new Error(`Missing required environment variable: ${key}`)
	return value
}

// --- Environment variables: secrets and deployment-specific values ---
// Everything else in this file is a hardcoded constant that the agent can change in code.

const ALWAYS_REQUIRED = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'] as const
// DB credentials are only required in production — dev/test uses an in-memory MongoDB replica set
const PRODUCTION_REQUIRED = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_NAME'] as const

for (const key of ALWAYS_REQUIRED) requireEnv(key)
if (isProduction) for (const key of PRODUCTION_REQUIRED) requireEnv(key)

const db = isProduction ? {
	user: requireEnv('DB_USER'),
	password: requireEnv('DB_PASSWORD'),
	host: requireEnv('DB_HOST'),
	name: requireEnv('DB_NAME'),
} : null

// --- Configuration constants ---

// Model selection: Production uses Sonnet for planning/building (reasoning quality),
// dev uses Haiku to minimize cost. Reflection always uses Haiku (lightweight summary).
const planModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const patchModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const reflectModel = isProduction ? 'claude-haiku-4-5' : 'claude-haiku-3'
const memoryModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const summarizerModel = isProduction ? 'claude-haiku-4-5' : 'claude-haiku-3'

export const config = {
	env,
	isProduction,
	anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
	githubToken: requireEnv('GITHUB_TOKEN'),
	githubOwner: requireEnv('GITHUB_OWNER'),
	githubRepo: requireEnv('GITHUB_REPO'),

	// LLM phase configuration: model selection and output token budgets
	phases: {
		planner: { model: planModel, maxTokens: 4096 },
		builder: { model: patchModel, maxTokens: 16384 },
		reflect: { model: reflectModel, maxTokens: 512 },
		memory: { model: memoryModel, maxTokens: 64 },
		summarizer: { model: summarizerModel, maxTokens: 2048 },
	},

	// Turn limits: max tool-use rounds per phase before giving up
	turns: {
		maxPlanner: 25,
		maxBuilder: 40,
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

	// Coverage reporting limits
	coverage: {
		maxLowCoverageFiles: 10, // Max low-coverage files listed in summary
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
	},

	// Database connection configuration
	db: {
		uri: db
			? `mongodb+srv://${db.user}:${db.password}@${db.host}/${db.name}?retryWrites=true&w=majority&appName=SeedGPT`
			: '',
		maxRetryAttempts: 5,
		retryInterval: 5_000, // 5 seconds
	},

	workspacePath: isProduction ? '/app/workspace' : './workspace',
} as const
