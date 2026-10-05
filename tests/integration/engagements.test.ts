import { test, expect } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { testConfig } from '../config';
import { createTenant, testOperator } from '../tenants';
import { createServices } from '../../src/server/services';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';
import { createClientsService } from '../../src/server/modules/clients/clients.service';
import { createEngagementsService } from '../../src/server/modules/engagements/engagements.service';
import { createIdentityAdministrationService } from '../../src/server/modules/identity/identity-administration.service';
import { users } from '../../src/server/modules/identity/user.entity';
import { clients, entities } from '../../src/server/modules/clients/client.entity';
import { reportingPeriods } from '../../src/server/modules/engagements/reporting-period.entity';
import { engagements } from '../../src/server/modules/engagements/engagement.entity';
import { engagementTeam } from '../../src/server/modules/engagements/team.entity';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';

async function setup(restricted = false) {
	const fixture = await isolatedDatabase(restricted);
	try {
		const db = fixture.runtimeDb;
		const [owner, member, admin, outsider] = await db
			.insert(users)
			.values(
				['owner', 'member', 'admin', 'outsider'].map((name) => ({
					name,
					email: `${name}@example.test`,
					passwordHash: 'synthetic-unused-hash',
					emailVerifiedAt: new Date()
				}))
			)
			.returning();
		const tenancy = createTenancyService(db),
			service = createEngagementsService(db),
			clients = createClientsService(db, testConfig(), null);
		const group = await createTenant(db, owner, {
			name: 'Synthetic Group',
			kind: 'group',
			parentId: null
		});
		const firm = await createTenant(db, owner, {
			name: 'Synthetic Firm',
			kind: 'firm',
			parentId: group.id
		});
		const otherFirm = await createTenant(db, owner, {
			name: 'Other Firm',
			kind: 'firm',
			parentId: null
		});
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: member.id, role: 'member' });
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: admin.id, role: 'admin' });
		await tenancy.setMembership(owner, { tenantId: group.id, userId: outsider.id, role: 'owner' });
		await tenancy.setMembership(owner, {
			tenantId: otherFirm.id,
			userId: outsider.id,
			role: 'member'
		});
		const client = await clients.createClient(owner, { firmId: firm.id, name: 'Synthetic Client' });
		const entity = await clients.createEntity(owner, {
			firmId: firm.id,
			clientId: client.id,
			name: 'Synthetic Trading Ltd'
		});
		const engagement = await service.create(owner, {
			firmId: firm.id,
			entityId: entity.id,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
		const scope = { firmId: firm.id, engagementId: engagement.id };
		return {
			...fixture,
			db,
			owner,
			member,
			admin,
			outsider,
			group,
			firm,
			otherFirm,
			client,
			entity,
			engagement,
			scope,
			tenancy,
			service,
			clients
		};
	} catch (cause) {
		await fixture.close();
		throw cause;
	}
}

test('restricted runtime can create the firm graph and attributes every setup/team change', async () => {
	const f = await setup(true);
	try {
		const row = await f.service.get(f.owner, f.scope);
		expect(row).toMatchObject({
			entityName: 'Synthetic Trading Ltd',
			clientName: 'Synthetic Client',
			myRole: 'manager',
			stage: 'setup',
			type: 'statutory_audit',
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
		const events = await f.db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.engagementId, f.engagement.id));
		expect(events).toHaveLength(2);
		expect(events.find((event) => event.action === 'engagement.created')).toMatchObject({
			actorId: f.owner.id,
			tenantId: f.firm.id,
			targetType: 'engagement',
			targetId: f.engagement.id,
			details: { clientId: f.client.id, entityId: f.entity.id, periodId: row.periodId }
		});
		expect(events.find((event) => event.action === 'engagement.team_changed')).toMatchObject({
			subjectUserId: f.owner.id,
			details: { previousRole: null, newRole: 'manager' }
		});
		for (const id of [f.client.id, f.entity.id, row.periodId, f.engagement.id])
			expect(id).toMatch(/^[0-9a-f-]{14}7[0-9a-f-]{21}$/);
		await f.service.setAssignment(f.admin, { ...f.scope, userId: f.member.id, role: 'auditor' });
		expect((await f.service.get(f.member, f.scope)).myRole).toBe('auditor');
		await expect(f.db.execute(sql`delete from audit_event`).execute()).rejects.toThrow();
	} finally {
		await f.close();
	}
}, 20000);

test('firm administration, parent ownership and team responsibilities grant distinct access', async () => {
	const f = await setup();
	try {
		expect(await f.service.listForFirm(f.member, f.firm.id)).toEqual([]);
		expect(await f.service.listAssigned(f.member, f.firm.id)).toEqual([]);
		expect(await f.service.listAssigned(f.admin, f.firm.id)).toEqual([]);
		await expect(f.service.listAssigned(f.outsider, f.firm.id)).rejects.toMatchObject({
			status: 404
		});
		await expect(f.service.get(f.member, f.scope)).rejects.toMatchObject({ status: 404 });
		expect(await f.service.listForFirm(f.admin, f.firm.id)).toHaveLength(1);
		expect((await f.service.getTeamSetup(f.admin, f.scope)).members).toHaveLength(3);
		await expect(f.service.get(f.admin, f.scope)).rejects.toMatchObject({ status: 404 });
		await expect(f.service.get(f.outsider, f.scope)).rejects.toMatchObject({ status: 404 });
		await expect(f.service.listForFirm(f.outsider, f.firm.id)).rejects.toMatchObject({
			status: 404
		});
		await expect(f.clients.listClients(f.member, f.firm.id)).rejects.toMatchObject({ status: 403 });
		await expect(
			f.clients.createClient(f.member, { firmId: f.firm.id, name: 'Denied' })
		).rejects.toMatchObject({ status: 403 });
		// Only a Responsible Individual can be engagement partner, and stays one while partner.
		await expect(
			f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'partner' })
		).rejects.toMatchObject({ code: 'PARTNER_MUST_BE_RI' });
		const tenancy = createTenancyService(f.db);
		const riScope = { tenantId: f.firm.id, userId: f.member.id };
		await tenancy.setResponsibleIndividual(f.owner, {
			...riScope,
			auditRegulator: 'icaew',
			since: '2020-01-01'
		});
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'partner' });
		expect((await f.service.get(f.member, f.scope)).myRole).toBe('partner');
		await expect(tenancy.setResponsibleIndividual(f.owner, riScope)).rejects.toMatchObject({
			code: 'RI_STILL_PARTNER'
		});
		expect((await f.service.listAssigned(f.member, f.firm.id)).map((row) => row.id)).toEqual([
			f.engagement.id
		]);
		const detail = await f.service.get(f.member, f.scope);
		expect(detail.team.map((person) => person.userId).sort()).toEqual(
			[f.member.id, f.owner.id].sort()
		);
		expect(Object.keys(detail.team[0]).sort()).toEqual(['name', 'role', 'userId']);
		await expect(
			f.service.setAssignment(f.member, { ...f.scope, userId: f.admin.id, role: 'partner' })
		).rejects.toMatchObject({ status: 403 });
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.owner.id, role: null });
		await expect(f.service.get(f.owner, f.scope)).rejects.toMatchObject({ status: 404 });
		expect(await f.service.listForFirm(f.owner, f.firm.id)).toHaveLength(1);
	} finally {
		await f.close();
	}
}, 20000);

test('the client directory shows admins every client and members only their clients', async () => {
	const f = await setup();
	try {
		const quiet = await f.clients.createClient(f.owner, {
			firmId: f.firm.id,
			name: 'Quiet Client'
		});
		const names = async (actor: { id: string }) =>
			(await f.clients.listClientDirectory(actor, f.firm.id)).map((client) => client.name);
		expect(await names(f.admin)).toEqual(['Quiet Client', 'Synthetic Client']);
		expect(await names(f.member)).toEqual([]);
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'auditor' });
		const directory = await f.clients.listClientDirectory(f.member, f.firm.id);
		expect(directory).toHaveLength(1);
		expect(directory[0]).toMatchObject({
			id: f.client.id,
			name: 'Synthetic Client',
			entities: [
				{
					id: f.entity.id,
					name: 'Synthetic Trading Ltd',
					engagement: { id: f.scope.engagementId, onTeam: true }
				}
			]
		});
		expect(directory.some((client) => client.id === quiet.id)).toBe(false);
		await expect(f.clients.listClientDirectory(f.outsider, f.firm.id)).rejects.toMatchObject({
			status: 404
		});
	} finally {
		await f.close();
	}
}, 20000);

test('mixed firm/resource IDs and non-firm resources fail at services and composite database constraints', async () => {
	const f = await setup();
	try {
		const other = await f.clients.createClient(f.owner, {
			firmId: f.otherFirm.id,
			name: 'Other client'
		});
		await expect(
			f.clients.createClient(f.owner, { firmId: f.group.id, name: 'Denied' })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			f.clients.createEntity(f.owner, { firmId: f.firm.id, clientId: other.id, name: 'Denied' })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			f.service.create(f.owner, {
				firmId: f.otherFirm.id,
				entityId: f.entity.id,
				periodStart: '2026-01-01',
				periodEnd: '2026-12-31'
			})
		).rejects.toMatchObject({ status: 404 });
		await expect(
			f.service.get(f.owner, { firmId: f.otherFirm.id, engagementId: f.engagement.id })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			f.service.getTeamSetup(f.owner, { firmId: f.otherFirm.id, engagementId: f.engagement.id })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			f.service.setAssignment(f.owner, { ...f.scope, userId: f.outsider.id, role: 'auditor' })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			f.db.insert(clients).values({ firmId: f.group.id, name: 'Invalid group client' }).execute()
		).rejects.toThrow();
		await expect(
			f.db
				.insert(entities)
				.values({ firmId: f.firm.id, clientId: other.id, name: 'Mixed entity' })
				.execute()
		).rejects.toThrow();
		await expect(
			f.db
				.insert(reportingPeriods)
				.values({
					firmId: f.otherFirm.id,
					entityId: f.entity.id,
					startsOn: '2026-01-01',
					endsOn: '2026-12-31'
				})
				.execute()
		).rejects.toThrow();
		const row = await f.service.get(f.owner, f.scope);
		await expect(
			f.db.insert(engagements).values({ firmId: f.otherFirm.id, periodId: row.periodId }).execute()
		).rejects.toThrow();
		await expect(
			f.db
				.insert(engagementTeam)
				.values({
					firmId: f.otherFirm.id,
					engagementId: f.engagement.id,
					userId: f.outsider.id,
					role: 'auditor'
				})
				.execute()
		).rejects.toThrow();
		await expect(
			f.db.execute(sql`update tenant set kind = 'group' where id = ${f.firm.id}`).execute()
		).rejects.toThrow();
		expect(await f.db.select().from(entities)).toHaveLength(1);
	} finally {
		await f.close();
	}
}, 20000);

test('assignment changes, firm removal/rejoin, disablement and acquisitions use current permissions', async () => {
	const f = await setup();
	try {
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'auditor' });
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'manager' });
		expect((await f.service.get(f.member, f.scope)).myRole).toBe('manager');
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: null });
		await expect(f.service.get(f.member, f.scope)).rejects.toMatchObject({ status: 404 });
		expect(await f.service.listAssigned(f.member, f.firm.id)).toEqual([]);
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'auditor' });
		await f.tenancy.setMembership(f.owner, {
			tenantId: f.firm.id,
			userId: f.member.id,
			role: null
		});
		expect(
			await f.db.select().from(engagementTeam).where(eq(engagementTeam.userId, f.member.id))
		).toHaveLength(0);
		await f.tenancy.setMembership(f.owner, {
			tenantId: f.firm.id,
			userId: f.member.id,
			role: 'member'
		});
		await expect(f.service.get(f.member, f.scope)).rejects.toMatchObject({ status: 404 });
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'auditor' });
		await createServices(f.db, testConfig()).tenancyAdministration.moveTenant(
			{ tenant: f.firm.id, parent: null },
			testOperator
		);
		expect((await f.service.get(f.member, f.scope)).id).toBe(f.engagement.id);
		expect((await f.service.listAssigned(f.member, f.firm.id))[0]).toMatchObject({
			id: f.engagement.id,
			firmId: f.firm.id,
			firmName: f.firm.name,
			firmHandle: f.firm.handle
		});
		await createIdentityAdministrationService(f.db).disableUser(
			f.member.id,
			{ name: 'Synthetic Operator' },
			'offboarding'
		);
		await expect(f.service.get(f.member, f.scope)).rejects.toMatchObject({ status: 404 });
		await expect(f.service.listAssigned(f.member, f.firm.id)).rejects.toMatchObject({
			status: 404
		});
		expect(
			(await f.service.getTeamSetup(f.owner, f.scope)).members.some(
				(member) => member.userId === f.member.id
			)
		).toBe(false);
		const events = await f.db
			.select()
			.from(auditEvents)
			.where(
				and(
					eq(auditEvents.engagementId, f.engagement.id),
					eq(auditEvents.subjectUserId, f.member.id)
				)
			);
		expect(events.filter((event) => event.action === 'engagement.team_removed')).toHaveLength(2);
		expect(events.find((event) => event.details.newRole === 'manager')).toMatchObject({
			details: { previousRole: 'auditor' }
		});
	} finally {
		await f.close();
	}
}, 20000);

test('concurrent assignment/removal cannot leave a revoked member assigned', async () => {
	const f = await setup();
	try {
		const [assignment, removal] = await Promise.allSettled([
			f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'auditor' }),
			createTenancyService(f.db).setMembership(f.owner, {
				tenantId: f.firm.id,
				userId: f.member.id,
				role: null
			})
		]);
		expect(removal.status).toBe('fulfilled');
		if (assignment.status === 'rejected') expect(assignment.reason).toMatchObject({ status: 404 });
		expect(
			await f.db.select().from(engagementTeam).where(eq(engagementTeam.userId, f.member.id))
		).toHaveLength(0);
		await expect(f.service.get(f.member, f.scope)).rejects.toMatchObject({ status: 404 });
	} finally {
		await f.close();
	}
}, 20000);

test('assigned work across firms authorizes each row without inherited or sibling access', async () => {
	const f = await setup();
	try {
		const client = await f.clients.createClient(f.owner, {
			firmId: f.otherFirm.id,
			name: 'Other client'
		});
		const entity = await f.clients.createEntity(f.owner, {
			firmId: f.otherFirm.id,
			clientId: client.id,
			name: 'Other Trading Ltd'
		});
		const engagement = await f.service.create(f.owner, {
			firmId: f.otherFirm.id,
			entityId: entity.id,
			periodStart: '2026-01-01',
			periodEnd: '2026-12-31'
		});
		await f.service.setAssignment(f.owner, { ...f.scope, userId: f.member.id, role: 'auditor' });
		await f.service.setAssignment(f.owner, {
			firmId: f.otherFirm.id,
			engagementId: engagement.id,
			userId: f.outsider.id,
			role: 'auditor'
		});
		const assigned = async (actor: { id: string }, firmId: string) =>
			(await f.service.listAssigned(actor, firmId)).map((row) => row.id);
		expect(await assigned(f.member, f.firm.id)).toEqual([f.engagement.id]);
		expect(await assigned(f.outsider, f.otherFirm.id)).toEqual([engagement.id]);
		expect(await assigned(f.owner, f.firm.id)).toEqual([f.engagement.id]);
		expect(await assigned(f.owner, f.otherFirm.id)).toEqual([engagement.id]);
		await expect(
			f.service.get(f.member, { firmId: f.otherFirm.id, engagementId: engagement.id })
		).rejects.toMatchObject({ status: 404 });
		await f.tenancy.setMembership(f.owner, {
			tenantId: f.firm.id,
			userId: f.member.id,
			role: null
		});
		await expect(f.service.listAssigned(f.member, f.firm.id)).rejects.toMatchObject({
			status: 404
		});
		expect(await assigned(f.outsider, f.otherFirm.id)).toEqual([engagement.id]);
	} finally {
		await f.close();
	}
}, 20000);

test('invalid/duplicate periods and failed audit writes leave no partial engagements', async () => {
	const f = await setup(true);
	try {
		const input = {
			firmId: f.firm.id,
			entityId: f.entity.id,
			periodStart: '2026-01-01',
			periodEnd: '2026-12-31'
		};
		await expect(
			f.service.create(f.owner, { ...input, periodEnd: '2025-12-31' })
		).rejects.toThrow();
		await expect(
			f.service.create(f.owner, { ...input, periodStart: '2026-02-30' })
		).rejects.toThrow();
		const results = await Promise.allSettled([
			f.service.create(f.owner, input),
			createEngagementsService(f.db).create(f.owner, input)
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		await expect(
			f.db
				.insert(reportingPeriods)
				.values({
					firmId: f.firm.id,
					entityId: f.entity.id,
					startsOn: '2027-12-31',
					endsOn: '2027-01-01'
				})
				.execute()
		).rejects.toThrow();
		// Owner connection changes grants; application transaction must roll back its entire graph.
		const ownerDb = (await import('../../src/server/db/connection')).openDatabase(f.ownerUrl);
		try {
			await ownerDb.db.execute(sql`revoke insert on audit_event from ${sql.identifier(f.role)}`);
		} finally {
			await ownerDb.close();
		}
		await expect(
			f.service.create(f.owner, { ...input, periodStart: '2027-01-01', periodEnd: '2027-12-31' })
		).rejects.toThrow();
		expect(await f.db.select().from(reportingPeriods)).toHaveLength(2);
		expect(await f.db.select().from(engagements)).toHaveLength(2);
		expect(await f.db.select().from(engagementTeam)).toHaveLength(2);
	} finally {
		await f.close();
	}
}, 20000);
