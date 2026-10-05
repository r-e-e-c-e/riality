import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/connection';
import { notFound } from '../../errors';
import { engagements } from '../engagements/engagement.entity';
import { reportingPeriods } from '../engagements/reporting-period.entity';
import { engagementTeam } from '../engagements/team.entity';
import { isOwnerOrAdmin, requireFirmMember, type Actor } from '../tenancy/tenancy-access';
import { entities } from './client.entity';

/** SQL condition: the actor is on the team of an engagement for the entity. */
export function onMyEngagementTeam(actor: Actor) {
	return sql`exists (
		select 1 from ${reportingPeriods}
		join ${engagements} on ${engagements.firmId} = ${reportingPeriods.firmId}
			and ${engagements.periodId} = ${reportingPeriods.id}
		join ${engagementTeam} on ${engagementTeam.firmId} = ${engagements.firmId}
			and ${engagementTeam.engagementId} = ${engagements.id}
		where ${reportingPeriods.firmId} = ${entities.firmId}
			and ${reportingPeriods.entityId} = ${entities.id}
			and ${engagementTeam.userId} = ${actor.id}
	)`;
}

/**
 * Checks the actor may see the entity: firm owners and admins, or members on the team
 * of one of its engagements. Throws 404 otherwise, so we never reveal it exists.
 */
export async function requireEntityViewer(
	db: Database | Transaction,
	actor: Actor,
	scope: { firmId: string; entityId: string }
) {
	const { role } = await requireFirmMember(db, actor, scope.firmId);
	const [entity] = await db
		.select({ id: entities.id })
		.from(entities)
		.where(
			and(
				eq(entities.firmId, scope.firmId),
				eq(entities.id, scope.entityId),
				isOwnerOrAdmin(role) ? undefined : onMyEngagementTeam(actor)
			)
		);
	if (!entity) throw notFound('Entity');
}
