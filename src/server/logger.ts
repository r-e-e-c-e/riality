import { postgresErrorCode } from './errors';
import { getRequestContext } from './request-context';

type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

/**
 * Writes one JSON line per log entry, with the current request ID when there is one.
 * In production, send stdout/stderr to your log service; the request ID links log
 * lines, error references and audit events for the same request.
 *
 * Never log passwords, tokens, codes, email addresses, request bodies or financial data.
 */
export const logger = {
	info: (message: string, fields?: Fields) => write('info', message, fields),
	warn: (message: string, fields?: Fields) => write('warn', message, fields),
	error: (message: string, fields?: Fields) => write('error', message, fields)
};

function write(level: Level, message: string, fields: Fields = {}) {
	const context = getRequestContext();
	const line = JSON.stringify({
		time: new Date().toISOString(),
		level,
		message,
		requestId: context?.requestId,
		userId: context?.userId,
		...fields
	});
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);
}

/**
 * A safe summary of an unexpected error. Error messages can contain personal data
 * (Drizzle's query errors include the query parameters), so only the type, database
 * error code and stack frames are kept.
 */
export function describeError(error: unknown): Fields {
	if (!(error instanceof Error)) return { errorType: typeof error };
	const code = postgresErrorCode(error);
	const frames = error.stack?.split('\n').filter((line) => line.trim().startsWith('at '));
	return { errorType: error.name, errorCode: code, stack: frames?.slice(0, 15).join('\n') };
}
