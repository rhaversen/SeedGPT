import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockConnect = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
const mockDisconnect = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('mongoose', () => ({
	default: { connect: mockConnect, disconnect: mockDisconnect },
}))

jest.unstable_mockModule('./config.js', () => ({
	config: {
		db: { maxRetryAttempts: 3, retryInterval: 10 },
	},
}))

jest.unstable_mockModule('./logger.js', () => ({
	default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockGetUri = jest.fn<() => string>().mockReturnValue('mongodb://localhost:27017/test')
const mockStart = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockWaitUntilRunning = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockStop = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('mongodb-memory-server', () => ({
	MongoMemoryReplSet: class {
		getUri = mockGetUri
		start = mockStart
		waitUntilRunning = mockWaitUntilRunning
		stop = mockStop
	},
}))

let db: typeof import('./database.js')

beforeEach(async () => {
	jest.clearAllMocks()
	jest.resetModules()
	mockConnect.mockResolvedValue(undefined)
})

describe('connectToDatabase', () => {
	it('connects via in-memory replica set in non-production', async () => {
		jest.unstable_mockModule('./env.js', () => ({
			env: { isProduction: false, db: { uri: '' } },
		}))
		db = await import('./database.js')

		await db.connectToDatabase()

		expect(mockStart).toHaveBeenCalled()
		expect(mockWaitUntilRunning).toHaveBeenCalled()
		expect(mockConnect).toHaveBeenCalledWith('mongodb://localhost:27017/test')
	})

	it('connects to real MongoDB in production', async () => {
		jest.unstable_mockModule('./env.js', () => ({
			env: { isProduction: true, db: { uri: 'mongodb://prod:27017/db' } },
		}))
		db = await import('./database.js')

		await db.connectToDatabase()

		expect(mockConnect).toHaveBeenCalledWith('mongodb://prod:27017/db')
		expect(mockStart).not.toHaveBeenCalled()
	})

	it('retries on production connection failure', async () => {
		jest.unstable_mockModule('./env.js', () => ({
			env: { isProduction: true, db: { uri: 'mongodb://prod:27017/db' } },
		}))
		db = await import('./database.js')

		mockConnect
			.mockRejectedValueOnce(new Error('Connection refused'))
			.mockResolvedValueOnce(undefined)

		await db.connectToDatabase()

		expect(mockConnect).toHaveBeenCalledTimes(2)
	})

	it('throws after exhausting retry attempts in production', async () => {
		jest.unstable_mockModule('./env.js', () => ({
			env: { isProduction: true, db: { uri: 'mongodb://prod:27017/db' } },
		}))
		db = await import('./database.js')

		mockConnect.mockRejectedValue(new Error('Connection refused'))

		await expect(db.connectToDatabase()).rejects.toThrow('Failed to connect to MongoDB after 3 attempts')
		expect(mockConnect).toHaveBeenCalledTimes(3)
	})
})

describe('disconnectFromDatabase', () => {
	it('disconnects mongoose', async () => {
		jest.unstable_mockModule('./env.js', () => ({
			env: { isProduction: true, db: { uri: 'mongodb://prod:27017/db' } },
		}))
		db = await import('./database.js')

		await db.disconnectFromDatabase()

		expect(mockDisconnect).toHaveBeenCalled()
	})

	it('stops replica set if one was started', async () => {
		jest.unstable_mockModule('./env.js', () => ({
			env: { isProduction: false, db: { uri: '' } },
		}))
		db = await import('./database.js')

		await db.connectToDatabase()
		await db.disconnectFromDatabase()

		expect(mockStop).toHaveBeenCalledWith({ doCleanup: true, force: true })
		expect(mockDisconnect).toHaveBeenCalled()
	})
})
