import { sql } from 'drizzle-orm';
import { check, index, pgEnum, snakeCase, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../../db/columns';

/**
 * group: an ownership group that contains firms or other groups (for example a
 *        roll-up of acquired firms). Groups never own audit work.
 * firm:  an audit firm. All clients and engagements belong to exactly one firm.
 */
export const tenantKind = pgEnum('tenant_kind', ['group', 'firm']);

/**
 * A node in the ownership tree. Moving a firm to a new group changes only its
 * parentId, so its ID, data, memberships and history stay the same.
 * Database triggers (see the security_guards migration) prevent cycles and stop
 * firms from containing other tenants.
 */
export const tenants = snakeCase.table(
	'tenant',
	{
		id: id(),
		name: text().notNull(),
		kind: tenantKind().notNull(),
		/** The firm's address: lines.ws/{handle}. Every firm has one; groups do not. */
		handle: text().unique(),
		parentId: uuid().references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
		createdAt: createdAt()
	},
	(t) => [
		index('tenant_parent_idx').on(t.parentId),
		check('tenant_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
		check('tenant_name_length', sql`length(trim(${t.name})) between 1 and 160`),
		check(
			'tenant_handle_format',
			sql`${t.handle} is null or (${t.handle} ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(${t.handle}) between 3 and 40)`
		),
		check('tenant_firm_has_handle', sql`${t.kind} <> 'firm' or ${t.handle} is not null`)
	]
);
