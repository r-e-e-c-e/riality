import { expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { testConfig } from '../config';
import { createTenant } from '../tenants';
import type {
	CompaniesHouse,
	CompanyOfficer,
	SignificantControl
} from '../../src/server/integrations/companies-house';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';
import { createClientsService } from '../../src/server/modules/clients/clients.service';
import { createPeopleService } from '../../src/server/modules/clients/people.service';
import { createEngagementsService } from '../../src/server/modules/engagements/engagements.service';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';
import { users } from '../../src/server/modules/identity/user.entity';

const ada: CompanyOfficer = {
	name: 'Ada Synthetic',
	kind: 'individual',
	role: 'director',
	appointedOn: '2010-05-01',
	resignedOn: null,
	birth: { month: 4, year: 1971 },
	officerId: 'SyntheticA1'
};
const adaInControl: SignificantControl = {
	name: 'Ada Synthetic',
	kind: 'individual',
	notifiedOn: '2016-04-06',
	ceasedOn: null,
	birth: { month: 4, year: 1971 },
	controls: ['shares_75_to_100']
};

/** A pretend Companies House where every company has the same officers and controllers. */
function fakeRegister(
	officers: CompanyOfficer[],
	controllers: SignificantControl[]
): CompaniesHouse {
	return {
		getCompany: async () => null,
		searchCompanies: async () => [],
		getOfficers: async () => officers.map((officer) => ({ ...officer })),
		getSignificantControl: async () => controllers.map((controller) => ({ ...controller }))
	};
}

async function setup(companiesHouse: CompaniesHouse | null) {
	const fixture = await isolatedDatabase();
	const db = fixture.db;
	const [owner, member] = await db
		.insert(users)
		.values(
			['owner', 'member'].map((name) => ({
				name,
				email: `${name}@example.test`,
				passwordHash: 'synthetic-unused-hash',
				emailVerifiedAt: new Date()
			}))
		)
		.returning();
	const firm = await createTenant(db, owner, {
		name: 'Synthetic Firm',
		kind: 'firm',
		parentId: null
	});
	await createTenancyService(db).setMembership(owner, {
		tenantId: firm.id,
		userId: member.id,
		role: 'member'
	});
	const clients = createClientsService(db, testConfig(), null);
	const people = createPeopleService(db, testConfig(), companiesHouse);
	const client = await clients.createClient(owner, { firmId: firm.id, name: 'Synthetic Client' });
	const [trading, property] = await Promise.all(
		['00012345', '00067890'].map((companyNumber, n) =>
			clients.createEntity(owner, {
				firmId: firm.id,
				clientId: client.id,
				companyNumber,
				name: `Synthetic Company ${n + 1} Ltd`
			})
		)
	);
	return { ...fixture, db, owner, member, firm, clients, people, client, trading, property };
}

test('Companies House officers and controllers become one person across entities, and re-importing is safe', async () => {
	const officers = [ada];
	const controllers = [adaInControl];
	const f = await setup(fakeRegister(officers, controllers));
	try {
		const trading = { firmId: f.firm.id, entityId: f.trading.id };
		const property = { firmId: f.firm.id, entityId: f.property.id };

		// Ada is a director and the person with significant control: one person, two roles.
		expect(await f.people.importFromCompaniesHouse(f.owner, trading)).toEqual({
			peopleAdded: 1,
			rolesAdded: 2,
			rolesUpdated: 0
		});
		// At the sister company she is recognised, not added again.
		expect(await f.people.importFromCompaniesHouse(f.owner, property)).toEqual({
			peopleAdded: 0,
			rolesAdded: 2,
			rolesUpdated: 0
		});
		const everyone = await f.people.listPeople(f.owner, f.firm.id);
		expect(everyone).toHaveLength(1);
		expect(everyone[0]!.roles.map((role) => role.role).sort()).toEqual([
			'director',
			'director',
			'psc',
			'psc'
		]);

		// Importing again changes nothing; a resignation updates the end date.
		expect(await f.people.importFromCompaniesHouse(f.owner, trading)).toEqual({
			peopleAdded: 0,
			rolesAdded: 0,
			rolesUpdated: 0
		});
		officers[0] = { ...ada, resignedOn: '2026-01-31' };
		expect(await f.people.importFromCompaniesHouse(f.owner, trading)).toMatchObject({
			rolesUpdated: 1
		});
		const roles = await f.people.listEntityPeople(f.owner, trading);
		expect(roles.find((role) => role.role === 'director')?.endedOn).toBe('2026-01-31');

		// Every change is audited, with IDs and field names only.
		const events = await f.db
			.select({ action: auditEvents.action, details: auditEvents.details })
			.from(auditEvents)
			.where(eq(auditEvents.tenantId, f.firm.id));
		const actions = events.map((event) => event.action);
		expect(actions.filter((action) => action === 'person.created')).toHaveLength(1);
		expect(actions.filter((action) => action === 'entity_role.added')).toHaveLength(4);
		expect(events.find((event) => event.action === 'entity_role.updated')?.details).toMatchObject({
			changed: ['endedOn'],
			source: 'companies_house'
		});
	} finally {
		await f.close();
	}
});

test('roles are added, edited and removed by hand by owners and admins only', async () => {
	const f = await setup(null);
	try {
		const scope = { firmId: f.firm.id, entityId: f.trading.id };
		const { person, role } = await f.people.addRole(f.owner, {
			...scope,
			name: 'Bea Synthetic',
			kind: 'individual',
			role: 'shareholder',
			shareholdingPercent: '60.5'
		});
		expect(role.shareholdingPercent).toBe(60.5);

		// The same person, role and start date can't be recorded twice.
		await expect(
			f.people.addRole(f.owner, { ...scope, personId: person.id, role: 'shareholder' })
		).rejects.toMatchObject({ code: 'ROLE_EXISTS' });
		// Only shareholders have a shareholding.
		await expect(
			f.people.addRole(f.owner, {
				...scope,
				personId: person.id,
				role: 'contact',
				shareholdingPercent: '10'
			})
		).rejects.toThrow();

		const ended = await f.people.updateRole(f.owner, {
			firmId: f.firm.id,
			roleId: role.id,
			startedOn: '2020-01-01',
			endedOn: '2025-12-31',
			shareholdingPercent: '60.5'
		});
		expect(ended).toMatchObject({ startedOn: '2020-01-01', endedOn: '2025-12-31' });
		await expect(
			f.people.updateRole(f.owner, {
				firmId: f.firm.id,
				roleId: role.id,
				startedOn: '2026-01-01',
				endedOn: '2025-12-31'
			})
		).rejects.toThrow();

		const updated = await f.people.updatePerson(f.owner, {
			firmId: f.firm.id,
			personId: person.id,
			name: 'Bea Synthetic-Jones',
			email: 'bea@example.test',
			phone: ''
		});
		expect(updated).toMatchObject({ name: 'Bea Synthetic-Jones', email: 'bea@example.test' });

		// Members can't change people, or see an entity they have no engagement for.
		await expect(
			f.people.addRole(f.member, { ...scope, personId: person.id, role: 'contact' })
		).rejects.toMatchObject({ status: 403 });
		await expect(f.people.listEntityPeople(f.member, scope)).rejects.toMatchObject({ status: 404 });
		await expect(f.people.listPeople(f.member, f.firm.id)).rejects.toMatchObject({ status: 403 });

		// Once on an engagement team, the member sees the entity's people.
		const engagements = createEngagementsService(f.db);
		const engagement = await engagements.create(f.owner, {
			firmId: f.firm.id,
			entityId: f.trading.id,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
		await engagements.setAssignment(f.owner, {
			firmId: f.firm.id,
			engagementId: engagement.id,
			userId: f.member.id,
			role: 'auditor'
		});
		expect(await f.people.listEntityPeople(f.member, scope)).toHaveLength(1);

		await f.people.removeRole(f.owner, { firmId: f.firm.id, roleId: role.id });
		expect(await f.people.listEntityPeople(f.owner, scope)).toHaveLength(0);
		const [removed] = await f.db
			.select({ details: auditEvents.details })
			.from(auditEvents)
			.where(
				and(eq(auditEvents.tenantId, f.firm.id), eq(auditEvents.action, 'entity_role.removed'))
			);
		expect(removed?.details).toEqual({ roleId: role.id, personId: person.id, role: 'shareholder' });
	} finally {
		await f.close();
	}
});

test('importing needs Companies House and a company number', async () => {
	const f = await setup(null);
	try {
		await expect(
			f.people.importFromCompaniesHouse(f.owner, { firmId: f.firm.id, entityId: f.trading.id })
		).rejects.toMatchObject({ code: 'COMPANIES_HOUSE_NOT_CONFIGURED' });
	} finally {
		await f.close();
	}
});
