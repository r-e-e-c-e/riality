import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/connection';
import { BusinessError, notFound } from '../../errors';
import { isActiveUser, users } from '../identity/user.entity';
import { memberships, type MembershipRole } from './membership.entity';
import { tenants } from './tenant.entity';

/**
 * How to protect firm data:
 *
 * 1. Call one of these checks at the start of every service method (engagement
 *    content uses requireEngagementTeamMember in engagement-access.ts). Inside a
 *    write transaction, pass the transaction so the check and the change see the
 *    same data.
 * 2. Then filter every query by the checked firmId (and engagementId). Never load a
 *    record by its ID alone.
 *
 * Non-members get 404, so we never reveal that a tenant exists; members without the
 * required role get 403.
 */

/** The signed-in user performing an action. Always comes from the session, never from form input. */
export type Actor = { id: string };

export const OWNER: MembershipRole[] = ['owner'];
export const OWNER_OR_ADMIN: MembershipRole[] = ['owner', 'admin'];

/** Owners and admins manage clients, engagements and the team. */
export function isOwnerOrAdmin(role: MembershipRole) {
	return role === 'owner' || role === 'admin';
}

/**
 * Makes tenant-tree, membership and invitation changes run one at a time across
 * all app servers, so permission checks and changes cannot interleave. These changes
 * are rare, so one global lock is simple and cheap. Do not use it for audit work.
 * The database tenant-tree trigger takes the same lock (key 8147, 1).
 */
export async function lockTenancyAdministration(tx: Transaction) {
	await tx.execute(sql`select pg_advisory_xact_lock(8147, 1)`);
}

/**
 * Checks that the actor is an active member of the tenant (group or firm) and, if
 * `roles` is given, has one of those roles. Returns the tenant and the actor's role.
 */
export async function requireTenantRole(
	db: Database | Transaction,
	actor: Actor,
	tenantId: string,
	roles?: MembershipRole[]
) {
	const [access] = await db
		.select({ tenant: tenants, role: memberships.role })
		.from(tenants)
		.innerJoin(memberships, eq(memberships.tenantId, tenants.id))
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(and(eq(tenants.id, tenantId), eq(memberships.userId, actor.id), isActiveUser()));

	if (!access) throw notFound('Tenant');
	if (roles && !roles.includes(access.role)) {
		throw new BusinessError(roles.includes('admin') ? 'ADMIN_REQUIRED' : 'OWNER_REQUIRED');
	}
	return access;
}

async function requireFirmRole(
	db: Database | Transaction,
	actor: Actor,
	firmId: string,
	roles?: MembershipRole[]
) {
	const access = await requireTenantRole(db, actor, firmId, roles);
	if (access.tenant.kind !== 'firm') throw notFound('Firm');
	return access;
}

/** Any active member of the firm. */
export function requireFirmMember(db: Database | Transaction, actor: Actor, firmId: string) {
	return requireFirmRole(db, actor, firmId);
}

/** A firm owner or admin: manages clients, engagements, teams and members. */
export function requireFirmAdmin(db: Database | Transaction, actor: Actor, firmId: string) {
	return requireFirmRole(db, actor, firmId, OWNER_OR_ADMIN);
}

/** A firm owner: manages ownership and the firm's name and handle. */
export function requireFirmOwner(db: Database | Transaction, actor: Actor, firmId: string) {
	return requireFirmRole(db, actor, firmId, OWNER);
}

/** IDs of a tenant's active owners. Used to make sure a tenant always keeps one. */
export async function activeOwnerIds(db: Database | Transaction, tenantId: string) {
	const owners = await db
		.select({ id: users.id })
		.from(memberships)
		.innerJoin(users, eq(users.id, memberships.userId))
		.where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner'), isActiveUser()));
	return owners.map((owner) => owner.id);
}
