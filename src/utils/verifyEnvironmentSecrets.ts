import 'process'

import logger from './logger.js'

const envSecrets = [
	// Database
	'DB_NAME',
	'DB_USER',
	'DB_PASSWORD',
	'DB_HOST',
	// Anthropic
	'ANTHROPIC_API_KEY',
	// GitHub
	'GITHUB_TOKEN',
	// BetterStack
	'BETTERSTACK_LOG_TOKEN',
	// Environment
	'NODE_ENV',
]

// Verify that all environment secrets are set
const missingSecrets = [] as string[]

envSecrets.forEach((secret) => {
	if (process.env[secret] === undefined) {
		missingSecrets.push(secret)
	}
})

if (missingSecrets.length > 0) {
	const errorMessage = `Missing environment secrets: ${missingSecrets.join(', ')}`
	logger.error('Exiting due to missing environment secrets', { missingSecrets })
	throw new Error(errorMessage)
}

logger.info('All environment secrets are set')

// Export an empty object to ensure this file is treated as a module
export { }
