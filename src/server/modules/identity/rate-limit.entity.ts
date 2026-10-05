import { index, integer, snakeCase, text } from 'drizzle-orm/pg-core';
import { timestampTz } from '../../db/columns';

/**
 * Attempt counters for rate limiting, shared by every app server. The key is a rule
 * name plus a keyed hash (HMAC) of the email, address or user ID, never the raw value.
 */
export const rateLimits = snakeCase.table(
	'rate_limit',
	{
		key: text().primaryKey(),
		attempts: integer().notNull(),
		resetsAt: timestampTz().notNull()
	},
	(t) => [index('rate_limit_expiry_idx').on(t.resetsAt)]
);
