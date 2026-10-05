import { index, pgEnum, snakeCase, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestampTz } from '../../db/columns';
import { users } from './user.entity';

export const credentialPurpose = pgEnum('credential_purpose', ['signup', 'reset']);

/**
 * A one-use code sent by email: to verify a new account (signup) or reset a
 * password (reset). Only the SHA-256 hash of the code is stored.
 */
export const credentialTokens = snakeCase.table(
	'credential_token',
	{
		tokenHash: text().primaryKey(),
		purpose: credentialPurpose().notNull(),
		/** The existing account (reset only). */
		userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
		email: text().notNull(),
		/** The name entered at signup, used to create the account. */
		name: text(),
		expiresAt: timestampTz().notNull(),
		createdAt: createdAt()
	},
	(t) => [index('credential_expiry_idx').on(t.expiresAt), index('credential_user_idx').on(t.userId)]
);
