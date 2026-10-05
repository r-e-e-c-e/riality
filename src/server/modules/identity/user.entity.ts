import { and, isNotNull, isNull, sql } from 'drizzle-orm';
import { check, snakeCase, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AvatarColor } from '#lib/avatar.js';
import { createdAt, id, timestampTz } from '../../db/columns';
import { tenants } from '../tenancy/tenant.entity';

/** A person who can sign in. Accounts are global; firm access comes from memberships. */
export const users = snakeCase.table(
	'app_user',
	{
		id: id(),
		email: text().notNull().unique(),
		name: text().notNull(),
		passwordHash: text().notNull(),
		/** Background colour for the initials avatar (see src/lib/avatar.ts). */
		avatarColor: text().$type<AvatarColor>().notNull().default('teal'),
		/** The firm opened most recently; lines.ws/ goes straight to it. */
		lastFirmId: uuid().references((): AnyPgColumn => tenants.id, { onDelete: 'set null' }),
		/** Set once the person proves they control the email address. */
		emailVerifiedAt: timestampTz(),
		/** Set by an operator to block all access. Disabled accounts are never deleted. */
		disabledAt: timestampTz(),
		createdAt: createdAt()
	},
	(t) => [check('user_normalized_email', sql`${t.email} = lower(trim(${t.email}))`)]
);

/** SQL condition: the account is verified and not disabled. */
export function isActiveUser() {
	return and(isNull(users.disabledAt), isNotNull(users.emailVerifiedAt));
}
