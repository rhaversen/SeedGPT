import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import logger from '../src/utils/logger.js'

let replSet: MongoMemoryReplSet

export default async function connectToInMemoryMongoDB(): Promise<void> {
	logger.info('Attempting connection to in-memory MongoDB')

	replSet = new MongoMemoryReplSet()

	await replSet.start()
	await replSet.waitUntilRunning()
	const mongoUri = replSet.getUri()
	await mongoose.connect(mongoUri)
	logger.info('Connected to in-memory MongoDB')
}

export async function disconnectFromInMemoryMongoDB(): Promise<void> {
	logger.info('Closing connection to in-memory MongoDB...')
	await mongoose.disconnect()
	logger.info('Mongoose disconnected')

	logger.info('Stopping memory database replica set...')
	await replSet.stop({ doCleanup: true, force: true })
	logger.info('Memory database replica set stopped')
}
