type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? 'info'

function log(level: Level, message: string, context?: Record<string, unknown>): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return
	const timestamp = new Date().toISOString()
	const prefix = `${timestamp} [${level.toUpperCase()}]`
	if (context) {
		console.log(`${prefix} ${message}`, JSON.stringify(context, null, 2))
	} else {
		console.log(`${prefix} ${message}`)
	}
}

const logger = {
	debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
	info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
	warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
	error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
}

export default logger
