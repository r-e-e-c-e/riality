import { inArray, or } from 'drizzle-orm';
import { auditEvents } from '../modules/audit/audit-event.entity';
import { hashPassword } from '../modules/identity/passwords';
import { users } from '../modules/identity/user.entity';
import { memberships } from '../modules/tenancy/membership.entity';
import { lockTenancyAdministration } from '../modules/tenancy/tenancy-access';
import { tenants } from '../modules/tenancy/tenant.entity';
import { openDatabase } from './connection';
import { validateResetTarget, type DevelopmentEnvironment } from './development-reset';
import { clients, entities } from '../modules/clients/client.entity';
import { engagements } from '../modules/engagements/engagement.entity';
import { reportingPeriods } from '../modules/engagements/reporting-period.entity';
import { engagementTeam } from '../modules/engagements/team.entity';
import {
	seedClients,
	seedEngagements,
	seedEntities,
	seedEvents,
	seedMemberships,
	seedPassword,
	seedPeriods,
	seedTeam,
	seedTenants,
	seedTimestamp,
	seedUsers,
	tenantRow
} from './seed-data';

type SeedEnvironment = DevelopmentEnvironment & { mailMode?: string };

/** Refuses anything but a local development database, a local APP_ORIGIN and preview mail. */
export function validateSeedTarget(url: string, environment: SeedEnvironment) {
	if (!environment.origin) throw new Error('Development seeding requires a local APP_ORIGIN');
	const target = validateResetTarget(url, environment);
	if (environment.mailMode !== 'preview')
		throw new Error('Development seeding requires MAIL_MODE=preview');
	return target;
}

/**
 * Inserts the synthetic fixtures from seed-data.ts: people, firms, clients and engagements. Running it again does nothing,
 * so later edits (passwords, roles, removed members) are kept. If only some
 * fixtures exist, or IDs/emails clash with other data, it refuses: use db:reset --seed.
 */
export async function seedDevelopmentDatabase(url: string, environment: SeedEnvironment) {
	validateSeedTarget(url, environment);
	const counts = {
		users: seedUsers.length,
		tenants: seedTenants.length,
		memberships: seedMemberships.length,
		engagements: seedEngagements.length,
		events: seedEvents.length
	};
	const { db, close } = openDatabase(url);
	try {
		return await db.transaction(async (tx) => {
			// The same lock as tenancy changes; also stops two seeds running at once.
			await lockTenancyAdministration(tx);

			const existingUsers = await tx
				.select({ id: users.id, email: users.email })
				.from(users)
				.where(
					or(
						inArray(
							users.id,
							seedUsers.map((user) => user.id)
						),
						inArray(
							users.email,
							seedUsers.map((user) => user.email)
						)
					)
				);
			const existingTenants = await tx
				.select({ id: tenants.id })
				.from(tenants)
				.where(
					inArray(
						tenants.id,
						seedTenants.map((tenant) => tenant.id)
					)
				);
			const existingEvents = await tx
				.select({ id: auditEvents.id })
				.from(auditEvents)
				.where(
					inArray(
						auditEvents.id,
						seedEvents.map((event) => event.id)
					)
				);

			const nothingSeeded =
				existingUsers.length === 0 && existingTenants.length === 0 && existingEvents.length === 0;
			if (!nothingSeeded) {
				const usersMatch =
					existingUsers.length === seedUsers.length &&
					seedUsers.every((user) =>
						existingUsers.some((row) => row.id === user.id && row.email === user.email)
					);
				const fullySeeded =
					usersMatch &&
					existingTenants.length === seedTenants.length &&
					existingEvents.length === seedEvents.length;
				if (!fullySeeded)
					throw new Error(
						'Seed fixture IDs/emails conflict or fixtures are incomplete; use db:reset --seed for a clean development database'
					);
				return { created: false, ...counts };
			}

			for (const user of seedUsers) {
				await tx.insert(users).values({
					...user,
					passwordHash: await hashPassword(seedPassword),
					emailVerifiedAt: seedTimestamp,
					createdAt: seedTimestamp
				});
			}
			// Parents first: the tenant-tree trigger checks each parent exists.
			for (const tenant of seedTenants) {
				await tx.insert(tenants).values({ ...tenantRow(tenant), createdAt: seedTimestamp });
			}
			const created = <T extends object>(rows: T[]) =>
				rows.map((row) => ({ ...row, createdAt: seedTimestamp }));
			await tx.insert(memberships).values(created(seedMemberships));
			await tx.insert(clients).values(created(seedClients));
			await tx.insert(entities).values(created(seedEntities));
			await tx.insert(reportingPeriods).values(created(seedPeriods));
			await tx.insert(engagements).values(created(seedEngagements));
			await tx.insert(engagementTeam).values(created(seedTeam));
			await tx.insert(auditEvents).values(seedEvents);
			return { created: true, ...counts };
		});
	} finally {
		await close();
	}
}
