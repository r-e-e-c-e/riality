import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError, notFound } from '../../errors';
import { emailSchema, nameSchema } from '#lib/schemas/identity.js';
import { idSchema } from '#lib/schemas/tenancy.js';
import { recordEvent } from '../audit/audit-event.service';
import { isActiveUser, users } from '../identity/user.entity';
import { memberships } from './membership.entity';
import { lockTenancyAdministration } from './tenancy-access';
import { tenants } from './tenant.entity';

type Operator = { name: string };

/** Finds a tenant by ID, or a firm by handle. */
async function findTenant(tx: Transaction, idOrHandle: string) {
	const byId = idSchema.safeParse(idOrHandle).success;
	const [tenant] = await tx
		.select()
		.from(tenants)
		.where(byId ? eq(tenants.id, idOrHandle) : eq(tenants.handle, idOrHandle.toLowerCase()));
	if (!tenant) throw notFound('Tenant');
	return tenant;
}

/** True if `possibleDescendantId` is `tenantId` itself or anywhere below it. */
async function isSameOrBelow(tx: Transaction, possibleDescendantId: string, tenantId: string) {
	const rows = await tx.execute<{ id: string }>(sql`
		with recursive ancestors as (
			select id, parent_id from tenant where id = ${possibleDescendantId}
			union all
			select t.id, t.parent_id from tenant t join ancestors a on t.id = a.parent_id
		)
		select id from ancestors where id = ${tenantId}`);
	return rows.length > 0;
}

/**
 * Ownership groups, managed by operators from the command line (see scripts/).
 * Groups roll up firms for an owner (for example after an acquisition); they never
 * give access to the firms' work. Each action is audited with the operator's name.
 */
export function createTenancyAdministrationService(db: Database) {
	return {
		/** Creates a top-level group, owned by an existing active user. */
		async createGroup(input: { name: string; ownerEmail: string }, operator: Operator) {
			const name = nameSchema.parse(input.name);
			const ownerEmail = emailSchema.parse(input.ownerEmail);
			const operatorName = nameSchema.parse(operator.name);
			return inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				const [owner] = await tx
					.select({ id: users.id })
					.from(users)
					.where(and(eq(users.email, ownerEmail), isActiveUser()));
				if (!owner) throw notFound('Active account');

				const [group] = await tx.insert(tenants).values({ name, kind: 'group' }).returning();
				await tx
					.insert(memberships)
					.values({ tenantId: group.id, userId: owner.id, role: 'owner' });
				await recordEvent(tx, {
					action: 'tenant.created',
					operatorName,
					tenantId: group.id,
					target: { type: 'tenant', id: group.id },
					details: { kind: 'group', parentId: null }
				});
				await recordEvent(tx, {
					action: 'membership.changed',
					operatorName,
					tenantId: group.id,
					subjectUserId: owner.id,
					details: { previousRole: null, newRole: 'owner' }
				});
				return group;
			});
		},

		/**
		 * Moves a firm or group under a group, or to the top level (parent null), for
		 * example when a firm is acquired. Nobody gains access by this move. Confirm the
		 * owners of both sides agreed before running it.
		 */
		async moveTenant(input: { tenant: string; parent: string | null }, operator: Operator) {
			const operatorName = nameSchema.parse(operator.name);
			return inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				const tenant = await findTenant(tx, input.tenant);
				const parent = input.parent ? await findTenant(tx, input.parent) : null;
				if (parent && parent.kind !== 'group')
					throw new BusinessError('ONLY_GROUPS_CONTAIN_TENANTS');
				if (parent && (await isSameOrBelow(tx, parent.id, tenant.id)))
					throw new BusinessError('TENANT_CYCLE');
				const newParentId = parent?.id ?? null;
				if (tenant.parentId === newParentId) return tenant;

				const [moved] = await tx
					.update(tenants)
					.set({ parentId: newParentId })
					.where(eq(tenants.id, tenant.id))
					.returning();
				await recordEvent(tx, {
					action: 'tenant.moved',
					operatorName,
					tenantId: tenant.id,
					target: { type: 'tenant', id: tenant.id },
					details: { previousParentId: tenant.parentId, newParentId }
				});
				return moved;
			});
		}
	};
}
