import { and, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/connection';
import { notFound } from '../../errors';
import { isActiveUser, users } from '../identity/user.entity';
import { memberships } from '../tenancy/membership.entity';
import type { Actor } from '../tenancy/tenancy-access';
import { tenants } from '../tenancy/tenant.entity';
import { engagements } from './engagement.entity';
import { engagementTeam } from './team.entity';

/**
 * Engagement content needs an active firm member who is assigned to the engagement's
 * team, even for firm owners and admins (see tenancy-access.ts for firm-level checks).
 * Returns their team role. Throws 404 otherwise, so we never reveal the engagement exists.
 */
export async function requireEngagementTeamMember(
	db: Database | Transaction,
	actor: Actor,
	scope: { firmId: string; engagementId: string }
) {
	const [assignment] = await db
		.select({ role: engagementTeam.role })
		.from(engagementTeam)
		.innerJoin(
			engagements,
			and(
				eq(engagements.firmId, engagementTeam.firmId),
				eq(engagements.id, engagementTeam.engagementId)
			)
		)
		.innerJoin(
			memberships,
			and(
				eq(memberships.tenantId, engagementTeam.firmId),
				eq(memberships.userId, engagementTeam.userId)
			)
		)
		.innerJoin(tenants, eq(tenants.id, engagementTeam.firmId))
		.innerJoin(users, eq(users.id, engagementTeam.userId))
		.where(
			and(
				eq(engagementTeam.firmId, scope.firmId),
				eq(engagementTeam.engagementId, scope.engagementId),
				eq(engagementTeam.userId, actor.id),
				eq(tenants.kind, 'firm'),
				isActiveUser()
			)
		);
	if (!assignment) throw notFound('Engagement');
	return assignment;
}
