const nodeEnv = process.env.NODE_ENV ?? 'production'

function requireEnv(key: string): string {
	const value = process.env[key]
	if (!value) throw new Error(`Missing required environment variable: ${key}`)
	return value
}

const ALWAYS_REQUIRED = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'] as const
const PRODUCTION_REQUIRED = ['DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_NAME'] as const

for (const key of ALWAYS_REQUIRED) requireEnv(key)
if (nodeEnv === 'production') for (const key of PRODUCTION_REQUIRED) requireEnv(key)

const db = nodeEnv === 'production' ? {
	user: requireEnv('DB_USER'),
	password: requireEnv('DB_PASSWORD'),
	host: requireEnv('DB_HOST'),
	name: requireEnv('DB_NAME'),
} : null

export const env = {
	nodeEnv,
	isProduction: nodeEnv === 'production',
	anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
	githubToken: requireEnv('GITHUB_TOKEN'),
	githubOwner: requireEnv('GITHUB_OWNER'),
	githubRepo: requireEnv('GITHUB_REPO'),
	db: {
		uri: db
			? `mongodb+srv://${db.user}:${db.password}@${db.host}/${db.name}?retryWrites=true&w=majority&appName=SeedGPT`
			: '',
	},
	workspacePath: nodeEnv === 'production' ? '/app/workspace' : './workspace',
} as const
