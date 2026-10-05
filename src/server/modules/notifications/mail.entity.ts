import { index, integer, snakeCase, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestampTz } from '../../db/columns';

/**
 * Emails waiting to be sent (the "outbox"). An email is queued in the same
 * transaction as the change that needs it, so it is only sent if that change was
 * saved. The background mail job sends it and then deletes the row.
 * Messages contain sign-in links, so they are stored encrypted.
 */
export const mailOutbox = snakeCase.table(
	'mail_outbox',
	{
		/** Created by the app before insert because it is part of the encryption context. */
		id: uuid().primaryKey(),
		encryptedMessage: text().notNull(),
		attempts: integer().notNull().default(0),
		/** Do not try again before this time (used for retry back-off). */
		availableAt: timestampTz().notNull().defaultNow(),
		/** Never send after this time; the link inside would have expired. */
		expiresAt: timestampTz().notNull(),
		createdAt: createdAt()
	},
	(t) => [index('mail_available_idx').on(t.availableAt)]
);
