import IterationLogModel from './models/IterationLog.js'

type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
	timestamp: string
	level: Level
	message: string
	context?: Record<string, unknown>
}

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? 'info'

// All log entries are buffered in-memory across the entire iteration, then flushed
// to MongoDB at the end. This serves double duty: the reflection step reads the buffer
// to understand what happened, and writeIterationLog persists it for debugging.
const logBuffer: LogEntry[] = []

function log(level: Level, message: string, context?: Record<string, unknown>): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return
	const timestamp = new Date().toISOString()
	logBuffer.push({ timestamp, level, message, context })
	const prefix = `${timestamp} [${level.toUpperCase()}]`
	if (context) {
		console.log(`${prefix} ${message}`, JSON.stringify(context, null, 2))
	} else {
		console.log(`${prefix} ${message}`)
	}
}

export async function writeIterationLog(): Promise<void> {
	try {
		await IterationLogModel.create({
			entries: logBuffer.map(e => ({
				timestamp: e.timestamp,
				level: e.level,
				message: e.message,
				context: e.context,
			})),
		})
		log('info', 'Iteration log saved to database')
	} catch (err) {
		log('error', 'Failed to save iteration log', { error: err })
	}
	logBuffer.length = 0
}

export function getLogBuffer(): readonly LogEntry[] {
	return logBuffer
}

const logger = {
	debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
	info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
	warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
	error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
}

export default logger
