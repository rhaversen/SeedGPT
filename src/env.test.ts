import { describe, it, expect } from '@jest/globals'

process.env.ANTHROPIC_API_KEY ??= 'test-api-key'
process.env.GITHUB_TOKEN ??= 'test-token'
process.env.GITHUB_OWNER ??= 'test-owner'
process.env.GITHUB_REPO ??= 'test-repo'

const { env } = await import('./env.js')

describe('env', () => {
	it('exports required GitHub and Anthropic values', () => {
		expect(env.anthropicApiKey).toBeTruthy()
		expect(env.githubToken).toBeTruthy()
		expect(env.githubOwner).toBeTruthy()
		expect(env.githubRepo).toBeTruthy()
	})

	it('determines production status from NODE_ENV', () => {
		expect(typeof env.isProduction).toBe('boolean')
		expect(env.nodeEnv).toBeDefined()
	})

	it('sets workspace path based on environment', () => {
		if (env.isProduction) {
			expect(env.workspacePath).toBe('/app/workspace')
		} else {
			expect(env.workspacePath).toBe('./workspace')
		}
	})

	it('has a db.uri string', () => {
		expect(typeof env.db.uri).toBe('string')
	})
})
