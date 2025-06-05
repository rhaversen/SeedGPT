// file deepcode ignore NoHardcodedPasswords/test: Hardcoded credentials are only used for testing purposes
// file deepcode ignore NoHardcodedCredentials/test: Hardcoded credentials are only used for testing purposes
// file deepcode ignore HardcodedNonCryptoSecret/test: Hardcoded credentials are only used for testing purposes

// Process environment variables

async function start(): Promise<void> {
	const connectToMongoDB = await import('../tests/mongoMemoryReplSetConnector.js')
	// Connect to the MongoDB
	await connectToMongoDB.default()

	// Seed the database
	await import('./seedDatabase.js')

	// Start the application
	await import('../app/index.js')
}

// Execute the startup sequence
await start()

export { }
