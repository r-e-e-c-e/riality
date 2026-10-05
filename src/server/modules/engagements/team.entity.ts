import { foreignKey, index, pgEnum, primaryKey, snakeCase, uuid } from 'drizzle-orm/pg-core';
import { createdAt } from '../../db/columns';
import { memberships } from '../tenancy/membership.entity';
import { engagements } from './engagement.entity';

/**
 * A person's responsibility on an engagement team. This records who does the work;
 * it is not sign-off authority, which will need its own rules.
 */
export const engagementRole = pgEnum('engagement_role', ['auditor', 'manager', 'partner']);
export type EngagementRole = (typeof engagementRole.enumValues)[number];

/**
 * Who is assigned to an engagement. Only assigned people can open an engagement,
 * including firm owners and admins.
 *
 * The (firmId, userId) foreign key to tenant_membership means every assignee must be
 * a member of the same firm, and removing the membership removes the assignment.
 */
export const engagementTeam = snakeCase.table(
	'engagement_team',
	{
		firmId: uuid().notNull(),
		engagementId: uuid().notNull(),
		userId: uuid().notNull(),
		role: engagementRole().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.firmId, t.engagementId, t.userId] }),
		index('engagement_team_user_idx').on(t.firmId, t.userId),
		foreignKey({
			name: 'team_engagement_fk',
			columns: [t.firmId, t.engagementId],
			foreignColumns: [engagements.firmId, engagements.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'team_membership_fk',
			columns: [t.firmId, t.userId],
			foreignColumns: [memberships.tenantId, memberships.userId]
		}).onDelete('cascade')
	]
);
