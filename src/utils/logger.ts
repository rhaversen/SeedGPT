import { createLogger, format as _format, transports as _transports } from 'winston'
import { Logtail } from '@logtail/node'

const { BETTERSTACK_LOG_TOKEN } = process.env as Record<string, string>

const winstonLogger = createLogger({
	levels: {
		error: 0,
		warn: 1,
		info: 2,
		http: 3,
		verbose: 4,
		debug: 5,
		silly: 6
	},
	format: _format.combine(
		_format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
		_format.json()
	),
	defaultMeta: { service: 'seedGPT' },
	transports: [
		new _transports.Console({
			format: _format.combine(
				_format.colorize(),
				_format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
				_format.printf((logObject) => {
					let message = `${logObject.timestamp} ${logObject.level}: ${logObject.message}`
					
					// If there's additional context beyond service, timestamp, level, and message, show it
					const contextKeys = Object.keys(logObject).filter(key => 
						!['timestamp', 'level', 'message', 'service'].includes(key)
					)
					
					if (contextKeys.length > 0) {
						const context: Record<string, any> = {}
						contextKeys.forEach(key => {
							context[key] = logObject[key]
						})
						message += `\n    Context: ${JSON.stringify(context, null, 2).replace(/\n/g, '\n    ')}`
					}
					
					return message
				})
			),
			level: 'debug' // Console transport logs everything from debug level and above
		})
	]
})

let betterStackLogger: Logtail | null = null

// Helper to handle BetterStack logging
const logToBetterStack = (
	level: 'error' | 'warn' | 'info' | 'debug',
	message: string,
	context?: Record<string, any>
): void => {
	if (process.env.NODE_ENV !== 'production') {
		return
	}

	if (!betterStackLogger) {
		betterStackLogger = new Logtail(BETTERSTACK_LOG_TOKEN)
	}

	// Sanitize context, especially Error objects
	let sanitizedContext = context
	if (context?.error instanceof Error) {
		sanitizedContext = { ...context }
		const err = context.error
		sanitizedContext.error = {
			message: err.message,
			stack: err.stack,
			name: err.name
		}
	}

	// Use a non-blocking approach with .catch()
	betterStackLogger[level](message, sanitizedContext).catch((error) => {
		// Log BetterStack errors to Winston to avoid infinite loops
		winstonLogger.error('Error logging to BetterStack', { error })
	})
}

const logger = {
	error: (message: string, context?: Record<string, any>) => {
		winstonLogger.error(message, context)
		logToBetterStack('error', message, context)
	},
	warn: (message: string, context?: Record<string, any>) => {
		winstonLogger.warn(message, context)
		logToBetterStack('warn', message, context)
	},
	info: (message: string, context?: Record<string, any>) => {
		winstonLogger.info(message, context)
		logToBetterStack('info', message, context)
	},
	debug: (message: string, context?: Record<string, any>) => {
		winstonLogger.debug(message, context)
		logToBetterStack('debug', message, context)
	}
}

export default logger