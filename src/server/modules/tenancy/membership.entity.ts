import { index, pgEnum, primaryKey, snakeCase, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from '../../db/columns';
import { users } from '../identity/user.entity';
import { tenants } from './tenant.entity';

/**
 * Administration roles within one tenant. These are not audit roles: they do not
 * grant engagement access or sign-off authority.
 * - member: can see the firm and engagements they are assigned to
 * - admin:  can also manage clients, engagements and team assignments
 * - owner:  can also manage memberships, invitations and the ownership tree
 */
export const membershipRole = pgEnum('membership_role', ['owner', 'admin', 'member']);
export type MembershipRole = (typeof membershipRole.enumValues)[number];

/**
 * A user's direct access to one tenant. Membership of a parent group never gives
 * access to the firms inside it; every tenant needs its own membership.
 */
export const memberships = snakeCase.table(
	'tenant_membership',
	{
		tenantId: uuid()
			.notNull()
			.references(() => tenants.id, { onDelete: 'restrict' }),
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		role: membershipRole().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.tenantId, t.userId] }),
		index('membership_user_idx').on(t.userId)
	]
);
