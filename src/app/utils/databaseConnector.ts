import mongoose from 'mongoose'
import logger from './logger.js'

const {
	DB_NAME,
	DB_USER,
	DB_PASSWORD,
	DB_HOST
} = process.env as Record<string, string>

const mongooseOptions = {
	retryWrites: true,
	appName: 'main',
	autoIndex: true,
} as const

const maxRetryAttempts = 5
const retryInterval = 5000 // 5 seconds

// Destructuring and global variables
const mongoUri = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@${DB_HOST}/${DB_NAME}`

function isMemoryDatabase(): boolean {
	return mongoose.connection.host.toString() === '127.0.0.1'
}

async function connectToMongoDB(): Promise<void> {
	if (process.env.NODE_ENV !== 'production') { return }

	for (let currentRetryAttempt = 0; currentRetryAttempt < maxRetryAttempts; currentRetryAttempt++) {
		logger.info('Attempting connection to MongoDB')

		try {
			await mongoose.connect(mongoUri, mongooseOptions)
			logger.info('Connected to MongoDB')
			return // Successfully connected
		} catch (error) {
			logger.error('Error connecting to MongoDB', { error })
			await new Promise(resolve => setTimeout(resolve, retryInterval))
		}
	}

	// Exhausted retries
	throw new Error(`Failed to connect to MongoDB after ${maxRetryAttempts} attempts.`)
}

const databaseConnector = {
	isMemoryDatabase,
	connectToMongoDB
}

export default databaseConnector
