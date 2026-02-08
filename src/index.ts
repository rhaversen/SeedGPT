import { run } from './loop.js'
import logger from './logger.js'

run().catch(error => {
	logger.error('Fatal error in SeedGPT loop', {
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	})
	process.exit(1)
})
