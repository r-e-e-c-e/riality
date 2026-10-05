import { BusinessError, postgresErrorCode } from '../errors';
import type { Database, Transaction } from './connection';

// PostgreSQL error codes that mean "two transactions collided; running it again
// will usually work": a deadlock, or a serialization failure.
const RETRYABLE_CODES = new Set(['40P01', '40001']);
const MAX_ATTEMPTS = 3;

/**
 * Runs `work` in a transaction, like db.transaction, but retries up to three times
 * if PostgreSQL reports a deadlock or serialization failure. If it still collides,
 * the user gets a 503 "please try again" instead of a 500.
 *
 * `work` may run more than once, so it must only change the database (no emails,
 * HTTP calls or other side effects outside the transaction).
 */
export async function inTransaction<T>(
	db: Database,
	work: (tx: Transaction) => Promise<T>
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await db.transaction(work);
		} catch (error) {
			if (!RETRYABLE_CODES.has(postgresErrorCode(error) ?? '')) throw error;
			if (attempt >= MAX_ATTEMPTS) throw new BusinessError('TRY_AGAIN');
			// Wait a short random time so the colliding transactions don't meet again.
			await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 50));
		}
	}
}
