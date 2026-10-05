import { sql } from 'drizzle-orm';
import { check, date, index, pgEnum, primaryKey, snakeCase, text, uuid } from 'drizzle-orm/pg-core';
import type { AuditRegulator } from '#lib/staff.js';
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
 *
 * At a firm, a member may also be a Responsible Individual (RI): approved by an audit
 * regulator to sign audit reports for this firm. Only RIs can be engagement partner.
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
		/** When they became a Responsible Individual at this firm; null if they are not one. */
		responsibleIndividualSince: date(),
		/** The regulator that approved them as a Responsible Individual. */
		auditRegulator: text().$type<AuditRegulator>(),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.tenantId, t.userId] }),
		index('membership_user_idx').on(t.userId),
		check(
			'membership_ri_complete',
			sql`(${t.responsibleIndividualSince} is null) = (${t.auditRegulator} is null)`
		)
	]
);
