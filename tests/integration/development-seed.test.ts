import { test, expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { testConfig } from '../config';
import { createServices } from '../../src/server/services';
import { seedDevelopmentDatabase, validateSeedTarget } from '../../src/server/db/development-seed';
import { resetDevelopmentDatabase } from '../../src/server/db/development-reset';
import {
	seedEngagements,
	seedEvents,
	seedIds,
	seedPassword,
	seedTenants,
	seedUsers,
	tenantRow
} from '../../src/server/db/seed-data';
import { createClientsService } from '../../src/server/modules/clients/clients.service';
import { createEngagementsService } from '../../src/server/modules/engagements/engagements.service';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';
import { memberships } from '../../src/server/modules/tenancy/membership.entity';
import { tenants } from '../../src/server/modules/tenancy/tenant.entity';
import { users } from '../../src/server/modules/identity/user.entity';
import { sessions } from '../../src/server/modules/identity/session.entity';
import { invitations } from '../../src/server/modules/tenancy/invitation.entity';
import { mailOutbox } from '../../src/server/modules/notifications/mail.entity';
import { credentialTokens } from '../../src/server/modules/identity/credential-token.entity';
import { mfaCredentials, recoveryCodes } from '../../src/server/modules/identity/mfa.entity';
import { hashPassword, verifyPassword } from '../../src/server/modules/identity/passwords';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';

const environment = {
	nodeEnv: 'development',
	origin: 'http://localhost:5173',
	mailMode: 'preview'
};
const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const config = testConfig({
	encryptionKey: Buffer.alloc(32, 9).toString('base64'),
	origin: environment.origin
});

test('development seed reproduces fixed v7 identities, topology, timestamps and audits after reset', async () => {
	const fixture = await isolatedDatabase();
	try {
		const snapshot = async () => ({
			users: (await fixture.db.select().from(users).orderBy(users.id)).map(
				({ passwordHash, ...user }) => {
					expect(passwordHash).toStartWith('$argon2id$');
					return user;
				}
			),
			tenants: await fixture.db.select().from(tenants).orderBy(tenants.id),
			memberships: await fixture.db
				.select()
				.from(memberships)
				.orderBy(memberships.tenantId, memberships.userId),
			events: await fixture.db.select().from(auditEvents).orderBy(auditEvents.id)
		});
		expect(await seedDevelopmentDatabase(fixture.ownerUrl, environment)).toEqual({
			created: true,
			users: seedUsers.length,
			tenants: seedTenants.length,
			memberships: 9,
			engagements: seedEngagements.length,
			events: seedEvents.length
		});
		const initial = await snapshot();
		const initialHashes = (await fixture.db.select().from(users).orderBy(users.id)).map(
			(user) => user.passwordHash
		);
		for (const id of [...Object.values(seedIds), ...seedEvents.map((event) => event.id)])
			expect(id).toMatch(v7);
		for (const table of [
			sessions,
			invitations,
			mailOutbox,
			credentialTokens,
			mfaCredentials,
			recoveryCodes
		])
			expect(await fixture.db.select().from(table)).toHaveLength(0);
		await resetDevelopmentDatabase(fixture.ownerUrl, environment);
		await seedDevelopmentDatabase(fixture.ownerUrl, environment);
		expect(await snapshot()).toEqual(initial);
		const recreated = await fixture.db.select().from(users).orderBy(users.id);
		for (const [index, user] of recreated.entries()) {
			expect(user.passwordHash).not.toBe(initialHashes[index]);
			expect(await verifyPassword(seedPassword, user.passwordHash)).toBe(true);
		}
	} finally {
		await fixture.close();
	}
}, 20000);

test('concurrent seed reruns preserve edited passwords, disabled accounts, roles and audit history', async () => {
	const fixture = await isolatedDatabase(true);
	try {
		const outcomes = await Promise.all([
			seedDevelopmentDatabase(fixture.url, environment),
			seedDevelopmentDatabase(fixture.url, environment)
		]);
		expect(outcomes.filter((result) => result.created)).toHaveLength(1);
		const tenancy = createTenancyService(fixture.runtimeDb);
		await tenancy.setMembership(
			{ id: seedIds.groupOwner },
			{
				tenantId: seedIds.baldwynFirm,
				userId: seedIds.auditor,
				role: null
			}
		);
		const passwordHash = await hashPassword('edited synthetic account passphrase');
		await fixture.db
			.update(users)
			.set({ passwordHash, disabledAt: new Date(), name: 'Edited Synthetic User' })
			.where(eq(users.id, seedIds.auditor));
		const before = {
			users: await fixture.db.select().from(users).orderBy(users.id),
			memberships: await fixture.db
				.select()
				.from(memberships)
				.orderBy(memberships.tenantId, memberships.userId),
			events: await fixture.db.select().from(auditEvents).orderBy(auditEvents.id)
		};
		expect((await seedDevelopmentDatabase(fixture.url, environment)).created).toBe(false);
		expect(await fixture.db.select().from(users).orderBy(users.id)).toEqual(before.users);
		expect(
			await fixture.db.select().from(memberships).orderBy(memberships.tenantId, memberships.userId)
		).toEqual(before.memberships);
		expect(await fixture.db.select().from(auditEvents).orderBy(auditEvents.id)).toEqual(
			before.events
		);
	} finally {
		await fixture.close();
	}
}, 20000);

test('seeded accounts can sign in and parent owners never implicitly gain subsidiary access', async () => {
	const fixture = await isolatedDatabase(true);
	try {
		await seedDevelopmentDatabase(fixture.url, environment);
		const auth = createServices(fixture.runtimeDb, config).identity;
		const tenancy = createTenancyService(fixture.runtimeDb);
		for (const user of seedUsers) {
			const login = await auth.login({
				email: user.email,
				password: seedPassword,
				address: 'synthetic-seed'
			});
			expect(login.user.id).toBe(user.id);
			expect(login.session.id).toMatch(v7);
			await auth.logout(login.session.tokenHash);
		}
		const morgan = { id: seedIds.groupOwner };
		expect((await tenancy.list(morgan)).map((tenant) => tenant.id).sort()).toEqual(
			[seedIds.group, seedIds.regionalGroup, seedIds.baldwynFirm, seedIds.wilkinsFirm].sort()
		);
		// Owning Azelle Group gives Morgan nothing in Hartley Croft, which sits inside it.
		await expect(tenancy.get(morgan, seedIds.hartleyFirm)).rejects.toMatchObject({ status: 404 });
		expect((await tenancy.get({ id: seedIds.firmOwner }, seedIds.wilkinsFirm)).role).toBe('owner');
		expect((await tenancy.get({ id: seedIds.firmOwner }, seedIds.baldwynFirm)).role).toBe('admin');
		expect((await tenancy.get({ id: seedIds.firmOwner }, seedIds.hartleyFirm)).role).toBe('owner');

		// Morgan has real work in two firms, and sees Wilkins Kenmore's other engagement
		// only as an admin (listed, but not openable without a team assignment).
		const work = createEngagementsService(fixture.runtimeDb);
		const entityNames = (rows: { entityName: string }[]) =>
			rows.map((row) => row.entityName).sort();
		expect(entityNames(await work.listAssigned(morgan, seedIds.baldwynFirm))).toEqual([
			'Harrow Engineering Ltd',
			'Moorland Brewing Ltd',
			'Northgate Bakeries Ltd',
			'Whitcombe Leasing Ltd',
			'Whitcombe Motors Ltd'
		]);
		expect(entityNames(await work.listAssigned(morgan, seedIds.wilkinsFirm))).toEqual([
			'Pennine Logistics Ltd',
			'Thornbury Construction Ltd'
		]);
		const wilkins = await work.listForFirm(morgan, seedIds.wilkinsFirm);
		expect(entityNames(wilkins)).toEqual([
			'Calder Dental Ltd',
			'Castleford Plastics Ltd',
			'Pennine Logistics Ltd',
			'Thornbury Construction Ltd'
		]);
		const calder = wilkins.find((row) => row.entityName === 'Calder Dental Ltd')!;
		await expect(
			work.get(morgan, { firmId: seedIds.wilkinsFirm, engagementId: calder.id })
		).rejects.toMatchObject({ status: 404 });
		expect(
			(
				await createClientsService(fixture.runtimeDb, config, null).listClientDirectory(
					{ id: seedIds.auditor },
					seedIds.baldwynFirm
				)
			).map((client) => client.name)
		).toEqual([
			'Aire Valley Care',
			'Harrow Family Holdings',
			'Moorland Brewing Co',
			'Northgate Bakeries'
		]);
		await expect(
			tenancy.get({ id: seedIds.auditor }, seedIds.standaloneFirm)
		).rejects.toMatchObject({ status: 404 });
	} finally {
		await fixture.close();
	}
}, 20000);

test('fixture email/UUID collisions refuse seeding without changing existing state', async () => {
	const fixture = await isolatedDatabase();
	try {
		const [existing] = await fixture.db
			.insert(users)
			.values({
				name: 'Existing Synthetic User',
				email: seedUsers[0].email,
				passwordHash: await hashPassword('existing synthetic password')
			})
			.returning();
		await expect(seedDevelopmentDatabase(fixture.ownerUrl, environment)).rejects.toThrow(
			'conflict'
		);
		expect(await fixture.db.select().from(users)).toEqual([existing]);
		expect(await fixture.db.select().from(tenants)).toHaveLength(0);
		expect(await fixture.db.select().from(auditEvents)).toHaveLength(0);
		await fixture.db.delete(users).where(eq(users.id, existing.id));
		await fixture.db.insert(tenants).values(tenantRow(seedTenants[0]));
		await expect(seedDevelopmentDatabase(fixture.ownerUrl, environment)).rejects.toThrow(
			'incomplete'
		);
		expect(await fixture.db.select().from(users)).toHaveLength(0);
		expect(await fixture.db.select().from(tenants)).toHaveLength(1);
	} finally {
		await fixture.close();
	}
}, 20000);

test('all database-generated UUID IDs use v7, including direct SQL/Drizzle inserts', async () => {
	const fixture = await isolatedDatabase(true);
	try {
		await seedDevelopmentDatabase(fixture.url, environment);
		const db = fixture.runtimeDb;
		const [user] = await db
			.insert(users)
			.values({
				name: 'Default UUID User',
				email: 'default@example.test',
				passwordHash: await hashPassword(seedPassword)
			})
			.returning();
		const [tenant] = await db
			.insert(tenants)
			.values({ name: 'Default UUID Firm', kind: 'firm', handle: 'default-uuid-firm' })
			.returning();
		const [session] = await db
			.insert(sessions)
			.values({
				tokenHash: 'synthetic-default-session',
				userId: user.id,
				expiresAt: new Date('2100-01-01')
			})
			.returning();
		const [invitation] = await db
			.insert(invitations)
			.values({
				tokenHash: 'synthetic-default-invitation',
				tenantId: tenant.id,
				email: 'invited@example.test',
				role: 'member',
				invitedBy: user.id,
				expiresAt: new Date('2100-01-01')
			})
			.returning();
		const [event] = await db
			.insert(auditEvents)
			.values({ action: 'tenant.created', actorId: user.id, tenantId: tenant.id })
			.returning();
		for (const row of [user, tenant, session, invitation, event]) expect(row.id).toMatch(v7);
	} finally {
		await fixture.close();
	}
}, 20000);

test('refuses public/production/admin targets and real mail before opening a seed connection', async () => {
	const local = 'postgres://synthetic@localhost:6000/local';
	expect(validateSeedTarget(local, environment).name).toBe('local');
	for (const [url, env] of [
		['postgres://synthetic@remote.example:6000/local', environment],
		['postgres://synthetic@localhost:6000/postgres', environment],
		[local, { ...environment, nodeEnv: 'production' }],
		[local, { ...environment, origin: 'https://public.example' }],
		[local, { ...environment, origin: undefined }],
		[local, { ...environment, mailMode: 'resend' }],
		[local, { ...environment, mailMode: undefined }]
	] as const) {
		expect(() => validateSeedTarget(url, env)).toThrow();
		await expect(seedDevelopmentDatabase(url, env)).rejects.toThrow();
	}
});
