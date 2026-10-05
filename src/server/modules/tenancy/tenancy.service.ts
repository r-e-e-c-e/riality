import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database, Transaction } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError, notFound, postgresErrorCode } from '../../errors';
import { suggestHandle } from '#lib/handles.js';
import {
	createFirmSchema,
	handleSchema,
	idSchema,
	membershipSchema,
	responsibleIndividualSchema,
	updateFirmSchema
} from '#lib/schemas/tenancy.js';
import { changedFields, recordEvent } from '../audit/audit-event.service';
import { removeClientResponsibilities } from '../clients/clients.service';
import { isEngagementPartner, removeFirmAssignments } from '../engagements/engagements.service';
import { isActiveUser, users } from '../identity/user.entity';
import { memberships, type MembershipRole } from './membership.entity';
import {
	OWNER_OR_ADMIN,
	activeOwnerIds,
	lockTenancyAdministration,
	requireFirmAdmin,
	requireFirmMember,
	requireFirmOwner,
	requireTenantRole,
	type Actor
} from './tenancy-access';
import { tenants } from './tenant.entity';

/** The first free handle: `base`, then `base-2`, `base-3`, ... */
async function firstFreeHandle(tx: Transaction, base: string) {
	for (let n = 1; n < 100; n++) {
		const candidate = n === 1 ? base : `${base.slice(0, 36).replace(/-+$/, '')}-${n}`;
		const [taken] = await tx
			.select({ id: tenants.id })
			.from(tenants)
			.where(eq(tenants.handle, candidate));
		if (!taken) return candidate;
	}
	throw new BusinessError('HANDLE_TAKEN');
}

/** Turns a unique-handle violation (two firms claiming a handle at once) into HANDLE_TAKEN. */
async function withHandleConflictCheck<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (postgresErrorCode(error) === '23505') throw new BusinessError('HANDLE_TAKEN');
		throw error;
	}
}

/**
 * Firms, the groups above them, and who belongs to each. Users create standalone
 * firms; creating groups and moving firms between them are operator actions (see
 * tenancy-administration.service.ts). Membership changes take the tenancy
 * administration lock first, then check permissions.
 */
export function createTenancyService(db: Database) {
	return {
		/** Tenants the user is a direct member of, with their role. */
		list(actor: Actor) {
			return db
				.select({
					id: tenants.id,
					name: tenants.name,
					kind: tenants.kind,
					handle: tenants.handle,
					parentId: tenants.parentId,
					role: memberships.role
				})
				.from(tenants)
				.innerJoin(memberships, eq(memberships.tenantId, tenants.id))
				.innerJoin(users, eq(users.id, memberships.userId))
				.where(and(eq(memberships.userId, actor.id), isActiveUser()))
				.orderBy(tenants.name, tenants.id);
		},

		get(actor: Actor, tenantId: string) {
			return requireTenantRole(db, actor, idSchema.parse(tenantId));
		},

		/** A firm by its handle, and the user's role in it. 404 if they are not a member. */
		async getFirmByHandle(actor: Actor, handle: string) {
			const parsed = handleSchema.safeParse(handle);
			if (!parsed.success) throw notFound('Firm');
			const [firm] = await db
				.select({ id: tenants.id })
				.from(tenants)
				.where(and(eq(tenants.handle, parsed.data), eq(tenants.kind, 'firm')));
			if (!firm) throw notFound('Firm');
			const { tenant, role } = await requireFirmMember(db, actor, firm.id);
			return { firm: { id: tenant.id, name: tenant.name, handle: tenant.handle! }, role };
		},

		/**
		 * The handle lines.ws/ should open for this user: their last-used firm if they
		 * are still a member, otherwise their first firm by name. Null if they have none.
		 */
		async findHomeFirmHandle(actor: Actor) {
			const [home] = await db
				.select({ handle: tenants.handle })
				.from(memberships)
				.innerJoin(tenants, eq(tenants.id, memberships.tenantId))
				.innerJoin(users, eq(users.id, memberships.userId))
				.where(and(eq(memberships.userId, actor.id), eq(tenants.kind, 'firm'), isActiveUser()))
				.orderBy(sql`(${tenants.id} = ${users.lastFirmId}) desc nulls last`, asc(tenants.name))
				.limit(1);
			return home?.handle ?? null;
		},

		/**
		 * Creates a standalone firm; the creator becomes its owner. Without a handle,
		 * one is suggested from the name (adding -2, -3, ... if it is taken).
		 */
		async createFirm(actor: Actor, input: { name: string; handle?: string }) {
			const { name, handle: requested } = createFirmSchema.parse(input);
			return withHandleConflictCheck(() =>
				inTransaction(db, async (tx) => {
					const [activeUser] = await tx
						.select({ id: users.id })
						.from(users)
						.where(and(eq(users.id, actor.id), isActiveUser()));
					if (!activeUser) throw new BusinessError('SIGN_IN_REQUIRED');

					const handle = requested || (await firstFreeHandle(tx, suggestHandle(name)));
					const [firm] = await tx
						.insert(tenants)
						.values({ name, kind: 'firm', handle })
						.returning();
					await tx
						.insert(memberships)
						.values({ tenantId: firm.id, userId: actor.id, role: 'owner' });
					await recordEvent(tx, {
						action: 'tenant.created',
						actorId: actor.id,
						tenantId: firm.id,
						target: { type: 'tenant', id: firm.id },
						details: { kind: 'firm', parentId: null }
					});
					return firm;
				})
			);
		},

		/** Renames a firm or changes its handle. Owners only. The old handle stops working. */
		async updateFirm(actor: Actor, input: { firmId: string; name: string; handle: string }) {
			const { firmId, name, handle } = updateFirmSchema.parse(input);
			return withHandleConflictCheck(() =>
				inTransaction(db, async (tx) => {
					const { tenant } = await requireFirmOwner(tx, actor, firmId);
					if (tenant.name === name && tenant.handle === handle) return tenant;
					const [updated] = await tx
						.update(tenants)
						.set({ name, handle })
						.where(eq(tenants.id, firmId))
						.returning();
					await recordEvent(tx, {
						action: 'tenant.updated',
						actorId: actor.id,
						tenantId: firmId,
						target: { type: 'tenant', id: firmId },
						details: { previousName: tenant.name, name, previousHandle: tenant.handle, handle }
					});
					return updated;
				})
			);
		},

		/** Members of a tenant with their emails. Owners and admins only. */
		async listMembers(actor: Actor, tenantId: string) {
			const id = idSchema.parse(tenantId);
			await requireTenantRole(db, actor, id, OWNER_OR_ADMIN);
			return db
				.select({
					userId: users.id,
					name: users.name,
					email: users.email,
					avatarColor: users.avatarColor,
					role: memberships.role,
					responsibleIndividualSince: memberships.responsibleIndividualSince,
					auditRegulator: memberships.auditRegulator
				})
				.from(memberships)
				.innerJoin(users, eq(users.id, memberships.userId))
				.where(eq(memberships.tenantId, id))
				.orderBy(users.name, users.id);
		},

		/**
		 * Makes a firm member a Responsible Individual (with the approving regulator and
		 * date), or not one (no regulator). Owners and admins. Someone who is partner on
		 * an engagement stays an RI until the engagement has another partner.
		 */
		async setResponsibleIndividual(
			actor: Actor,
			input: z.input<typeof responsibleIndividualSchema>
		) {
			const { tenantId, userId, auditRegulator, since } = responsibleIndividualSchema.parse(input);
			const changes = {
				auditRegulator: auditRegulator ?? null,
				responsibleIndividualSince: since ?? null
			};
			await inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				await requireFirmAdmin(tx, actor, tenantId);
				const thisMembership = and(
					eq(memberships.tenantId, tenantId),
					eq(memberships.userId, userId)
				);
				const [before] = await tx.select().from(memberships).where(thisMembership);
				if (!before) throw notFound('Firm member');
				if (changedFields(before, changes).length === 0) return;

				if (!changes.auditRegulator && (await isEngagementPartner(tx, tenantId, userId)))
					throw new BusinessError('RI_STILL_PARTNER');
				await tx.update(memberships).set(changes).where(thisMembership);
				await recordEvent(tx, {
					action: 'membership.responsible_individual_changed',
					actorId: actor.id,
					tenantId,
					subjectUserId: userId,
					details: {
						auditRegulator: changes.auditRegulator,
						since: changes.responsibleIndividualSince
					}
				});
			});
		},

		/**
		 * Adds, changes or (with role null) removes a membership. Owners and admins manage
		 * members and admins; only owners can grant ownership or change an owner. A tenant
		 * always keeps at least one active owner. Removing someone from a firm also
		 * removes their engagement team assignments and clears them as a client's
		 * partner or manager.
		 */
		async setMembership(
			actor: Actor,
			input: { tenantId: string; userId: string; role: MembershipRole | null }
		) {
			const { tenantId, userId, role: newRole } = membershipSchema.parse(input);
			await inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				const { role: actorRole } = await requireTenantRole(tx, actor, tenantId, OWNER_OR_ADMIN);

				const [subject] = await tx
					.select({ id: users.id })
					.from(users)
					.where(and(eq(users.id, userId), isActiveUser()));
				if (!subject && newRole) throw notFound('Active account');

				const thisMembership = and(
					eq(memberships.tenantId, tenantId),
					eq(memberships.userId, userId)
				);
				const [previous] = await tx.select().from(memberships).where(thisMembership);
				const previousRole = previous?.role ?? null;
				if (previousRole === newRole) return;

				const touchesOwnership = newRole === 'owner' || previousRole === 'owner';
				if (touchesOwnership && actorRole !== 'owner') throw new BusinessError('OWNER_REQUIRED');

				const losingOwnership = previousRole === 'owner' && newRole !== 'owner';
				if (losingOwnership && (await activeOwnerIds(tx, tenantId)).length <= 1)
					throw new BusinessError('LAST_OWNER');

				if (newRole) {
					await tx
						.insert(memberships)
						.values({ tenantId, userId, role: newRole })
						.onConflictDoUpdate({
							target: [memberships.tenantId, memberships.userId],
							set: { role: newRole }
						});
					await recordEvent(tx, {
						action: 'membership.changed',
						actorId: actor.id,
						tenantId,
						subjectUserId: userId,
						details: { previousRole, newRole }
					});
				} else if (previousRole) {
					await removeFirmAssignments(tx, actor, tenantId, userId);
					await removeClientResponsibilities(tx, actor, tenantId, userId);
					await tx.delete(memberships).where(thisMembership);
					await recordEvent(tx, {
						action: 'membership.removed',
						actorId: actor.id,
						tenantId,
						subjectUserId: userId,
						details: { previousRole }
					});
				}
			});
		}
	};
}
