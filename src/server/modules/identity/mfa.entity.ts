import { bigint, primaryKey, snakeCase, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, timestampTz } from '../../db/columns';
import { users } from './user.entity';

/** A user's authenticator app (TOTP). The shared secret is encrypted with AUTH_ENCRYPTION_KEY. */
export const mfaCredentials = snakeCase.table('mfa_credential', {
	userId: uuid()
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	encryptedSecret: text().notNull(),
	/** Null while setup is in progress; set once the user confirms a first code. */
	enabledAt: timestampTz(),
	/** The last accepted 30-second time step. Codes from this step or earlier are refused (no replay). */
	lastStep: bigint({ mode: 'number' }).notNull().default(-1),
	createdAt: createdAt()
});

/** One-use backup codes for when the authenticator is unavailable. Only hashes are stored. */
export const recoveryCodes = snakeCase.table(
	'mfa_recovery_code',
	{
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		codeHash: text().notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.codeHash] })]
);
