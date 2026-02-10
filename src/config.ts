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

// Dev uses haiku for all stages to save cost. Prod uses sonnet for planning and building
// where reasoning quality matters. Reflection always uses haiku since it's a lightweight
// summary task — saving cost without sacrificing iteration quality.
const planModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const patchModel = isProduction ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
const reflectModel = 'claude-haiku-4-5'

export const config = {
	env,
	isProduction,
	anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
	githubToken: requireEnv('GITHUB_TOKEN'),
	githubOwner: requireEnv('GITHUB_OWNER'),
	githubRepo: requireEnv('GITHUB_REPO'),
	planModel,
	patchModel,
	reflectModel,
	maxPlannerRounds: 25,
	maxBuilderRounds: 40,
	workspacePath: isProduction ? '/app/workspace' : './workspace',
	memoryTokenBudget: 10_000,
	db: {
		uri: db
			? `mongodb+srv://${db.user}:${db.password}@${db.host}/${db.name}?retryWrites=true&w=majority&appName=SeedGPT`
			: '',
		maxRetryAttempts: 5,
		retryInterval: 5_000,
	},
} as const
