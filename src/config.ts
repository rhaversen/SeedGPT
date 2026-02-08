const env = process.env.NODE_ENV ?? 'production'
const isProduction = env === 'production'

function requireEnv(key: string): string {
	const value = process.env[key]
	if (!value) throw new Error(`Missing required environment variable: ${key}`)
	return value
}

function optionalEnv(key: string): string {
	return process.env[key] ?? ''
}

const ALWAYS_REQUIRED = [
	'ANTHROPIC_API_KEY',
	'GITHUB_TOKEN',
	'GITHUB_OWNER',
	'GITHUB_REPO',
] as const

const PRODUCTION_REQUIRED = [
	'DB_USER',
	'DB_PASSWORD',
	'DB_HOST',
	'DB_NAME',
] as const

for (const key of ALWAYS_REQUIRED) {
	requireEnv(key)
}

if (isProduction) {
	for (const key of PRODUCTION_REQUIRED) {
		requireEnv(key)
	}
}

const dbUri = isProduction
	? `mongodb+srv://${requireEnv('DB_USER')}:${requireEnv('DB_PASSWORD')}@${requireEnv('DB_HOST')}/${requireEnv('DB_NAME')}?retryWrites=true&w=majority&appName=SeedGPT`
	: ''

export const config = {
	env,
	isProduction,
	anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
	githubToken: requireEnv('GITHUB_TOKEN'),
	githubOwner: requireEnv('GITHUB_OWNER'),
	githubRepo: requireEnv('GITHUB_REPO'),
	planModel: process.env.PLAN_MODEL ?? (isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'),
	patchModel: process.env.PATCH_MODEL ?? (isProduction ? 'claude-opus-4-6' : 'claude-haiku-4-5'),
	maxRetries: parseInt(process.env.MAX_RETRIES ?? '3', 10),
	workspacePath: process.env.WORKSPACE_PATH ?? (isProduction ? '/app/workspace' : './workspace'),
	db: {
		uri: dbUri,
		maxRetryAttempts: 5,
		retryInterval: 5000,
	},
	memoryTokenBudget: parseInt(process.env.MEMORY_TOKEN_BUDGET ?? '10000', 10),
} as const
