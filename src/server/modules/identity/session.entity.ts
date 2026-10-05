import { sql } from 'drizzle-orm';
import { index, snakeCase, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestampTz } from '../../db/columns';
import { users } from './user.entity';

/**
 * A signed-in browser. The cookie holds a random token; only its SHA-256 hash is
 * stored, so a database leak does not reveal usable session tokens.
 */
export const sessions = snakeCase.table(
	'auth_session',
	{
		tokenHash: text().primaryKey(),
		/** A public ID for listing and revoking sessions. Never accepted as a credential. */
		id: uuid()
			.notNull()
			.unique()
			.default(sql`uuidv7()`),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** Absolute expiry. Inactivity expiry is checked against lastSeenAt. */
		expiresAt: timestampTz().notNull(),
		/** When the second factor was checked for this session (null if MFA was not used). */
		mfaVerifiedAt: timestampTz(),
		/** When the password was last entered. Sensitive actions need this to be recent. */
		authenticatedAt: timestampTz().notNull().defaultNow(),
		lastSeenAt: timestampTz().notNull().defaultNow(),
		createdAt: createdAt()
	},
	(t) => [index('session_user_idx').on(t.userId), index('session_expiry_idx').on(t.expiresAt)]
);
