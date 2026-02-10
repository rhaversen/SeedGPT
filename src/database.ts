import mongoose from 'mongoose'

import { config } from './config.js'
import logger from './logger.js'

let replSet: InstanceType<typeof import('mongodb-memory-server').MongoMemoryReplSet> | null = null

export async function connectToDatabase(): Promise<void> {
	if (config.isProduction) {
		const { uri, maxRetryAttempts, retryInterval } = config.db

		for (let attempt = 0; attempt < maxRetryAttempts; attempt++) {
			logger.info(`Attempting connection to MongoDB (attempt ${attempt + 1}/${maxRetryAttempts})`)
			try {
				await mongoose.connect(uri)
				logger.info('Connected to MongoDB')
				return
			} catch (error) {
				logger.error('Error connecting to MongoDB', { error })
				await new Promise(resolve => setTimeout(resolve, retryInterval))
			}
		}

		throw new Error(`Failed to connect to MongoDB after ${maxRetryAttempts} attempts`)
	}

	// Uses a replica set (not standalone) because Mongoose change streams and transactions
	// require replica sets. Dynamic import avoids bundling mongodb-memory-server in production.
	logger.info('Starting in-memory MongoDB replica set...')
	const { MongoMemoryReplSet } = await import('mongodb-memory-server')
	replSet = new MongoMemoryReplSet()
	await replSet.start()
	await replSet.waitUntilRunning()
	await mongoose.connect(replSet.getUri())
	logger.info('Connected to in-memory MongoDB')
}

export async function disconnectFromDatabase(): Promise<void> {
	await mongoose.disconnect()
	if (replSet) {
		await replSet.stop({ doCleanup: true, force: true })
		replSet = null
	}
	logger.info('Disconnected from MongoDB')
}
