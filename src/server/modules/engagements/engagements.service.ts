import { and, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database, Transaction } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError, notFound } from '../../errors';
import {
	createClientSchema,
	createEngagementSchema,
	createEntitySchema,
	engagementScopeSchema,
	teamAssignmentSchema
} from '#lib/schemas/engagements.js';
import { idSchema } from '#lib/schemas/tenancy.js';
import { recordEvent } from '../audit/audit-event.service';
import { isActiveUser, users } from '../identity/user.entity';
import { memberships } from '../tenancy/membership.entity';
import {
	isOwnerOrAdmin,
	lockTenancyAdministration,
	requireFirmAdmin,
	requireFirmMember,
	type Actor
} from '../tenancy/tenancy-access';
import { tenants } from '../tenancy/tenant.entity';
import { clients, entities } from './client.entity';
import { engagements } from './engagement.entity';
import { requireEngagementTeamMember } from './engagement-access';
import { reportingPeriods } from './reporting-period.entity';
import { engagementTeam } from './team.entity';

/**
 * Engagement rows with their client, entity and period, plus the actor's own team
 * role (null if they are not on the team). Callers add the WHERE clause.
 */
function selectEngagements(db: Database | Transaction, actor: Actor) {
	return db
		.select({
			id: engagements.id,
			firmId: engagements.firmId,
			firmName: tenants.name,
			firmHandle: tenants.handle,
			type: engagements.type,
			stage: engagements.stage,
			createdAt: engagements.createdAt,
			clientId: clients.id,
			clientName: clients.name,
			entityId: entities.id,
			entityName: entities.name,
			periodId: reportingPeriods.id,
			periodStart: reportingPeriods.startsOn,
			periodEnd: reportingPeriods.endsOn,
			myRole: engagementTeam.role
		})
		.from(engagements)
		.innerJoin(tenants, eq(tenants.id, engagements.firmId))
		.innerJoin(
			reportingPeriods,
			and(
				eq(reportingPeriods.firmId, engagements.firmId),
				eq(reportingPeriods.id, engagements.periodId)
			)
		)
		.innerJoin(
			entities,
			and(eq(entities.firmId, reportingPeriods.firmId), eq(entities.id, reportingPeriods.entityId))
		)
		.innerJoin(clients, and(eq(clients.firmId, entities.firmId), eq(clients.id, entities.clientId)))
		.leftJoin(
			engagementTeam,
			and(
				eq(engagementTeam.firmId, engagements.firmId),
				eq(engagementTeam.engagementId, engagements.id),
				eq(engagementTeam.userId, actor.id)
			)
		);
}

const newestPeriodFirst = [desc(reportingPeriods.endsOn), entities.name, engagements.id];

/**
 * Removes all of a user's team assignments in a firm, with an audit event for each.
 * Called by the tenancy service inside its membership-removal transaction.
 */
export async function removeFirmAssignments(
	tx: Transaction,
	actor: Actor,
	firmId: string,
	userId: string
) {
	const removed = await tx
		.delete(engagementTeam)
		.where(and(eq(engagementTeam.firmId, firmId), eq(engagementTeam.userId, userId)))
		.returning();
	for (const assignment of removed) {
		await recordEvent(tx, {
			action: 'engagement.team_removed',
			actorId: actor.id,
			tenantId: firmId,
			engagementId: assignment.engagementId,
			subjectUserId: userId,
			details: { previousRole: assignment.role }
		});
	}
}

/**
 * Clients, legal entities, engagements and engagement teams. Every method checks
 * access first (see engagement-access.ts), then filters queries by the firm.
 */
export function createEngagementsService(db: Database) {
	return {
		/** Engagements the user is assigned to in one firm (their dashboard). */
		async listAssigned(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			await requireFirmMember(db, actor, id);
			return selectEngagements(db, actor)
				.where(and(eq(engagements.firmId, id), eq(engagementTeam.userId, actor.id)))
				.orderBy(...newestPeriodFirst);
		},

		/**
		 * The firm's clients and their legal entities. Owners and admins see all of them;
		 * members see only clients with an engagement they are assigned to.
		 */
		async listClientDirectory(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			const { role } = await requireFirmMember(db, actor, id);
			const isAdmin = isOwnerOrAdmin(role);
			const onMyTeam = sql`exists (
				select 1 from ${reportingPeriods}
				join ${engagements} on ${engagements.firmId} = ${reportingPeriods.firmId}
					and ${engagements.periodId} = ${reportingPeriods.id}
				join ${engagementTeam} on ${engagementTeam.firmId} = ${engagements.firmId}
					and ${engagementTeam.engagementId} = ${engagements.id}
				where ${reportingPeriods.firmId} = ${entities.firmId}
					and ${reportingPeriods.entityId} = ${entities.id}
					and ${engagementTeam.userId} = ${actor.id}
			)`;
			const rows = await db
				.select({
					clientId: clients.id,
					clientName: clients.name,
					entityId: entities.id,
					entityName: entities.name
				})
				.from(clients)
				.leftJoin(
					entities,
					and(eq(entities.firmId, clients.firmId), eq(entities.clientId, clients.id))
				)
				.where(and(eq(clients.firmId, id), isAdmin ? undefined : onMyTeam))
				.orderBy(clients.name, clients.id, entities.name);

			// Group the rows into clients, each with its entities.
			const directory: { id: string; name: string; entities: { id: string; name: string }[] }[] =
				[];
			for (const row of rows) {
				let client = directory.at(-1);
				if (client?.id !== row.clientId) {
					client = { id: row.clientId, name: row.clientName, entities: [] };
					directory.push(client);
				}
				if (row.entityId && row.entityName)
					client.entities.push({ id: row.entityId, name: row.entityName });
			}
			return directory;
		},

		/**
		 * A firm's engagements. Owners and admins see every engagement's setup details;
		 * members see only the engagements they are assigned to.
		 */
		async listForFirm(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			const { role } = await requireFirmMember(db, actor, id);
			const isAdmin = isOwnerOrAdmin(role);
			return selectEngagements(db, actor)
				.where(
					and(eq(engagements.firmId, id), isAdmin ? undefined : eq(engagementTeam.userId, actor.id))
				)
				.orderBy(...newestPeriodFirst);
		},

		/** One engagement with its team (names and roles only). Team members only. */
		async get(actor: Actor, input: z.infer<typeof engagementScopeSchema>) {
			const scope = engagementScopeSchema.parse(input);
			await requireEngagementTeamMember(db, actor, scope);
			const [engagement] = await selectEngagements(db, actor).where(
				and(eq(engagements.firmId, scope.firmId), eq(engagements.id, scope.engagementId))
			);
			if (!engagement) throw notFound('Engagement');

			const team = await db
				.select({ userId: users.id, name: users.name, role: engagementTeam.role })
				.from(engagementTeam)
				.innerJoin(users, eq(users.id, engagementTeam.userId))
				.where(
					and(
						eq(engagementTeam.firmId, scope.firmId),
						eq(engagementTeam.engagementId, scope.engagementId),
						isActiveUser()
					)
				)
				.orderBy(users.name, users.id);
			return { ...engagement, team };
		},

		async listClients(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			await requireFirmAdmin(db, actor, id);
			return db
				.select({ id: clients.id, name: clients.name })
				.from(clients)
				.where(eq(clients.firmId, id))
				.orderBy(clients.name, clients.id);
		},

		async listEntities(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			await requireFirmAdmin(db, actor, id);
			return db
				.select({
					id: entities.id,
					name: entities.name,
					clientId: clients.id,
					clientName: clients.name
				})
				.from(entities)
				.innerJoin(
					clients,
					and(eq(clients.firmId, entities.firmId), eq(clients.id, entities.clientId))
				)
				.where(eq(entities.firmId, id))
				.orderBy(clients.name, entities.name, entities.id);
		},

		async createClient(actor: Actor, input: z.infer<typeof createClientSchema>) {
			const values = createClientSchema.parse(input);
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, values.firmId);
				const [client] = await tx.insert(clients).values(values).returning();
				await recordEvent(tx, {
					action: 'client.created',
					actorId: actor.id,
					tenantId: values.firmId,
					target: { type: 'client', id: client.id }
				});
				return client;
			});
		},

		async createEntity(actor: Actor, input: z.infer<typeof createEntitySchema>) {
			const values = createEntitySchema.parse(input);
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, values.firmId);
				const [client] = await tx
					.select({ id: clients.id })
					.from(clients)
					.where(and(eq(clients.firmId, values.firmId), eq(clients.id, values.clientId)));
				if (!client) throw notFound('Client');

				const [entity] = await tx.insert(entities).values(values).returning();
				await recordEvent(tx, {
					action: 'entity.created',
					actorId: actor.id,
					tenantId: values.firmId,
					target: { type: 'entity', id: entity.id },
					details: { clientId: values.clientId }
				});
				return entity;
			});
		},

		/**
		 * Creates an engagement for an entity's reporting period. The creator is added to
		 * the team as manager. One engagement per entity and exact period.
		 */
		async create(actor: Actor, input: z.infer<typeof createEngagementSchema>) {
			const { firmId, entityId, periodStart, periodEnd } = createEngagementSchema.parse(input);
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, firmId);
				const [entity] = await tx
					.select()
					.from(entities)
					.where(and(eq(entities.firmId, firmId), eq(entities.id, entityId)));
				if (!entity) throw notFound('Entity');

				const [period] = await tx
					.insert(reportingPeriods)
					.values({ firmId, entityId, startsOn: periodStart, endsOn: periodEnd })
					.onConflictDoNothing()
					.returning();
				if (!period) throw new BusinessError('ENGAGEMENT_EXISTS');

				const [engagement] = await tx
					.insert(engagements)
					.values({ firmId, periodId: period.id })
					.returning();
				await tx
					.insert(engagementTeam)
					.values({ firmId, engagementId: engagement.id, userId: actor.id, role: 'manager' });

				await recordEvent(tx, {
					action: 'engagement.created',
					actorId: actor.id,
					tenantId: firmId,
					engagementId: engagement.id,
					target: { type: 'engagement', id: engagement.id },
					details: {
						clientId: entity.clientId,
						entityId,
						periodId: period.id,
						periodStart,
						periodEnd
					}
				});
				await recordEvent(tx, {
					action: 'engagement.team_changed',
					actorId: actor.id,
					tenantId: firmId,
					engagementId: engagement.id,
					subjectUserId: actor.id,
					details: { previousRole: null, newRole: 'manager' }
				});
				return engagement;
			});
		},

		/** The engagement plus every active firm member and their team role, for the team page. Admins only. */
		async getTeamSetup(actor: Actor, input: z.infer<typeof engagementScopeSchema>) {
			const { firmId, engagementId } = engagementScopeSchema.parse(input);
			await requireFirmAdmin(db, actor, firmId);
			const [engagement] = await selectEngagements(db, actor).where(
				and(eq(engagements.firmId, firmId), eq(engagements.id, engagementId))
			);
			if (!engagement) throw notFound('Engagement');

			const members = await db
				.select({
					userId: users.id,
					name: users.name,
					email: users.email,
					role: engagementTeam.role
				})
				.from(memberships)
				.innerJoin(users, eq(users.id, memberships.userId))
				.leftJoin(
					engagementTeam,
					and(
						eq(engagementTeam.firmId, firmId),
						eq(engagementTeam.engagementId, engagementId),
						eq(engagementTeam.userId, users.id)
					)
				)
				.where(and(eq(memberships.tenantId, firmId), isActiveUser()))
				.orderBy(users.name, users.id);
			return { engagement, members };
		},

		/**
		 * Adds, changes or (with role null) removes a team member. Admins only.
		 * Team access is an access grant, so this takes the tenancy administration lock,
		 * like membership changes. That stops a concurrent firm removal from leaving
		 * the person assigned.
		 */
		async setAssignment(actor: Actor, input: z.infer<typeof teamAssignmentSchema>) {
			const { firmId, engagementId, userId, role } = teamAssignmentSchema.parse(input);
			await inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				await requireFirmAdmin(tx, actor, firmId);
				const [engagement] = await tx
					.select({ id: engagements.id })
					.from(engagements)
					.where(and(eq(engagements.firmId, firmId), eq(engagements.id, engagementId)));
				if (!engagement) throw notFound('Engagement');

				if (role) {
					const [member] = await tx
						.select({ id: users.id })
						.from(memberships)
						.innerJoin(users, eq(users.id, memberships.userId))
						.where(
							and(eq(memberships.tenantId, firmId), eq(memberships.userId, userId), isActiveUser())
						);
					if (!member) throw notFound('Active firm member');
				}

				const thisAssignment = and(
					eq(engagementTeam.firmId, firmId),
					eq(engagementTeam.engagementId, engagementId),
					eq(engagementTeam.userId, userId)
				);
				const [previous] = await tx.select().from(engagementTeam).where(thisAssignment);
				const previousRole = previous?.role ?? null;
				if (previousRole === role) return;

				if (role) {
					await tx
						.insert(engagementTeam)
						.values({ firmId, engagementId, userId, role })
						.onConflictDoUpdate({
							target: [engagementTeam.firmId, engagementTeam.engagementId, engagementTeam.userId],
							set: { role }
						});
					await recordEvent(tx, {
						action: 'engagement.team_changed',
						actorId: actor.id,
						tenantId: firmId,
						engagementId,
						subjectUserId: userId,
						details: { previousRole, newRole: role }
					});
				} else if (previousRole) {
					await tx.delete(engagementTeam).where(thisAssignment);
					await recordEvent(tx, {
						action: 'engagement.team_removed',
						actorId: actor.id,
						tenantId: firmId,
						engagementId,
						subjectUserId: userId,
						details: { previousRole }
					});
				}
			});
		}
	};
}
