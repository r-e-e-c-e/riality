import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/connection';
import { engagements } from '../engagements/engagement.entity';
import { reportingPeriods } from '../engagements/reporting-period.entity';
import { engagementTeam } from '../engagements/team.entity';
import { users } from '../identity/user.entity';
import type { Actor } from '../tenancy/tenancy-access';
import { clients, entities, entityRoles, people } from './client.entity';
import { onMyEngagementTeam } from './entity-access';

// Reading clients for the Clients list and a client's page. Owners and admins see
// every client; members see clients with an engagement they are on, and only those
// entities. Callers check firm membership first and say whether the actor manages.

const partners = alias(users, 'partner');
const managers = alias(users, 'manager');

/**
 * Clients (all of them, or just `clientId`), each with its responsible partner and
 * manager, key contact, entities, and each entity's latest engagement.
 */
export async function loadClients(
	db: Database,
	actor: Actor,
	scope: { firmId: string; clientId?: string; seesAll: boolean }
) {
	const { firmId, clientId, seesAll } = scope;
	const visibleEntity = seesAll ? undefined : onMyEngagementTeam(actor);

	const clientRows = await db
		.select({
			id: clients.id,
			name: clients.name,
			status: clients.status,
			riskRating: clients.riskRating,
			lastReviewedOn: clients.lastReviewedOn,
			partnerId: partners.id,
			partnerName: partners.name,
			managerId: managers.id,
			managerName: managers.name,
			keyContactId: people.id,
			keyContactName: people.name,
			keyContactEmail: people.email,
			keyContactPhone: people.phone
		})
		.from(clients)
		.leftJoin(partners, eq(partners.id, clients.partnerId))
		.leftJoin(managers, eq(managers.id, clients.managerId))
		.leftJoin(people, and(eq(people.firmId, clients.firmId), eq(people.id, clients.keyContactId)))
		.where(
			and(
				eq(clients.firmId, firmId),
				clientId ? eq(clients.id, clientId) : undefined,
				seesAll
					? undefined
					: sql`exists (select 1 from ${entities} where ${entities.firmId} = ${clients.firmId}
						and ${entities.clientId} = ${clients.id} and ${visibleEntity})`
			)
		)
		.orderBy(asc(clients.name), asc(clients.id));
	if (clientRows.length === 0) return [];

	const entityRows = await db
		.select({
			id: entities.id,
			clientId: entities.clientId,
			name: entities.name,
			entityType: entities.entityType,
			companyNumber: entities.companyNumber,
			companyStatus: entities.companyStatus,
			yearEndDay: entities.yearEndDay,
			yearEndMonth: entities.yearEndMonth,
			accountsNextDueOn: entities.accountsNextDueOn
		})
		.from(entities)
		.where(
			and(
				eq(entities.firmId, firmId),
				inArray(
					entities.clientId,
					clientRows.map((client) => client.id)
				),
				visibleEntity
			)
		)
		.orderBy(asc(entities.name), asc(entities.id));

	// Each entity's latest engagement, and whether the actor is on its team.
	const engagementRows =
		entityRows.length === 0
			? []
			: await db
					.select({
						id: engagements.id,
						entityId: reportingPeriods.entityId,
						periodEnd: reportingPeriods.endsOn,
						myRole: engagementTeam.role
					})
					.from(engagements)
					.innerJoin(
						reportingPeriods,
						and(
							eq(reportingPeriods.firmId, engagements.firmId),
							eq(reportingPeriods.id, engagements.periodId)
						)
					)
					.leftJoin(
						engagementTeam,
						and(
							eq(engagementTeam.firmId, engagements.firmId),
							eq(engagementTeam.engagementId, engagements.id),
							eq(engagementTeam.userId, actor.id)
						)
					)
					.where(
						and(
							eq(engagements.firmId, firmId),
							inArray(
								reportingPeriods.entityId,
								entityRows.map((entity) => entity.id)
							)
						)
					)
					.orderBy(desc(reportingPeriods.endsOn));
	const latestEngagement = new Map<string, (typeof engagementRows)[number]>();
	for (const row of engagementRows) {
		if (!latestEngagement.has(row.entityId)) latestEngagement.set(row.entityId, row);
	}

	return clientRows.map((client) => {
		const clientEntities = entityRows
			.filter((entity) => entity.clientId === client.id)
			.map((entity) => {
				const engagement = latestEngagement.get(entity.id);
				return {
					...entity,
					engagement: engagement
						? {
								id: engagement.id,
								periodEnd: engagement.periodEnd,
								onTeam: engagement.myRole !== null
							}
						: null
				};
			});
		const dueDates = clientEntities.flatMap((entity) => entity.accountsNextDueOn ?? []).sort();
		return {
			id: client.id,
			name: client.name,
			status: client.status,
			riskRating: client.riskRating,
			lastReviewedOn: client.lastReviewedOn,
			partner: client.partnerId ? { id: client.partnerId, name: client.partnerName! } : null,
			manager: client.managerId ? { id: client.managerId, name: client.managerName! } : null,
			keyContact: client.keyContactId
				? {
						id: client.keyContactId,
						name: client.keyContactName!,
						email: client.keyContactEmail,
						phone: client.keyContactPhone
					}
				: null,
			/** The earliest accounts filing deadline across the client's entities. */
			nextAccountsDue: dueDates[0] ?? null,
			entities: clientEntities
		};
	});
}

/**
 * The people with roles at the given entities, each with all their roles there:
 * one row per person, for the client page's people grid.
 */
export async function loadPeopleOf(db: Database, firmId: string, entityIds: string[]) {
	if (entityIds.length === 0) return [];
	const rows = await db
		.select({
			personId: people.id,
			name: people.name,
			kind: people.kind,
			email: people.email,
			phone: people.phone,
			entityId: entityRoles.entityId,
			role: entityRoles.role,
			startedOn: entityRoles.startedOn,
			endedOn: entityRoles.endedOn,
			shareholdingPercent: entityRoles.shareholdingPercent
		})
		.from(entityRoles)
		.innerJoin(
			people,
			and(eq(people.firmId, entityRoles.firmId), eq(people.id, entityRoles.personId))
		)
		.where(and(eq(entityRoles.firmId, firmId), inArray(entityRoles.entityId, entityIds)))
		.orderBy(asc(people.name), asc(people.id), asc(entityRoles.startedOn));

	type Role = Pick<
		(typeof rows)[number],
		'entityId' | 'role' | 'startedOn' | 'endedOn' | 'shareholdingPercent'
	>;
	const list: (Pick<(typeof rows)[number], 'personId' | 'name' | 'kind' | 'email' | 'phone'> & {
		roles: Role[];
	})[] = [];
	for (const { entityId, role, startedOn, endedOn, shareholdingPercent, ...person } of rows) {
		let entry = list.at(-1);
		if (entry?.personId !== person.personId) {
			entry = { ...person, roles: [] };
			list.push(entry);
		}
		entry.roles.push({ entityId, role, startedOn, endedOn, shareholdingPercent });
	}
	return list;
}
