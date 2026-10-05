import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { testConfig } from '../config';
import { createTenant } from '../tenants';
import type { CompaniesHouse, CompanyProfile } from '../../src/server/integrations/companies-house';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';
import { createClientsService } from '../../src/server/modules/clients/clients.service';
import { createEngagementsService } from '../../src/server/modules/engagements/engagements.service';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';
import { users } from '../../src/server/modules/identity/user.entity';

const company: CompanyProfile = {
	companyNumber: '00012345',
	name: 'SYNTHETIC TRADING LIMITED',
	entityType: 'private_limited',
	status: 'active',
	incorporatedOn: '2004-03-15',
	registeredOffice: 'Mill Lane\nLeeds',
	sicCodes: ['25620'],
	yearEnd: { day: 31, month: 3 },
	accountsNextDueOn: '2026-12-31',
	lastAccountsMadeUpTo: '2025-03-31'
};

/** A pretend Companies House holding the given companies. */
function fakeCompaniesHouse(companies: CompanyProfile[]): CompaniesHouse {
	return {
		getCompany: async (number) => companies.find((c) => c.companyNumber === number) ?? null,
		searchCompanies: async (query) =>
			companies
				.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
				.map((c) => ({
					companyNumber: c.companyNumber,
					name: c.name,
					status: c.status,
					incorporatedOn: c.incorporatedOn,
					address: c.registeredOffice
				}))
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
	const clients = createClientsService(db, testConfig(), companiesHouse);
	const client = await clients.createClient(owner, { firmId: firm.id, name: 'Synthetic Client' });
	return { ...fixture, owner, member, firm, clients, client };
}

test('entities can be added from Companies House by number and refreshed later', async () => {
	const register = [{ ...company }];
	const f = await setup(fakeCompaniesHouse(register));
	try {
		const entity = await f.clients.createEntity(f.owner, {
			firmId: f.firm.id,
			clientId: f.client.id,
			companyNumber: '12345'
		});
		expect(entity).toMatchObject({
			name: 'SYNTHETIC TRADING LIMITED',
			companyNumber: '00012345',
			entityType: 'private_limited',
			companyStatus: 'active',
			yearEndDay: 31,
			yearEndMonth: 3,
			sicCodes: ['25620']
		});
		await expect(
			f.clients.createEntity(f.owner, {
				firmId: f.firm.id,
				clientId: f.client.id,
				companyNumber: '00012345'
			})
		).rejects.toMatchObject({ code: 'ENTITY_EXISTS' });
		await expect(
			f.clients.createEntity(f.owner, {
				firmId: f.firm.id,
				clientId: f.client.id,
				companyNumber: '99999999'
			})
		).rejects.toMatchObject({ code: 'COMPANY_NOT_FOUND' });
		expect(
			await f.clients.searchCompanies(f.owner, { firmId: f.firm.id, query: 'synthetic' })
		).toHaveLength(1);

		// The company goes into liquidation and changes its name.
		register[0] = { ...company, name: 'SYNTHETIC TRADING 2004 LIMITED', status: 'liquidation' };
		const scope = { firmId: f.firm.id, entityId: entity.id };
		const refreshed = await f.clients.refreshFromCompaniesHouse(f.owner, scope);
		expect(refreshed).toMatchObject({
			name: 'SYNTHETIC TRADING 2004 LIMITED',
			companyStatus: 'liquidation'
		});

		const events = await f.db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.targetId, entity.id))
			.orderBy(auditEvents.id);
		expect(events.map((event) => [event.action, event.details])).toEqual([
			['entity.created', { clientId: f.client.id, source: 'companies_house' }],
			['entity.updated', { changed: ['name', 'companyStatus'], source: 'companies_house' }]
		]);
	} finally {
		await f.close();
	}
}, 20000);

test('without Companies House, entities are entered and edited by hand', async () => {
	const f = await setup(null);
	try {
		await expect(
			f.clients.createEntity(f.owner, {
				firmId: f.firm.id,
				clientId: f.client.id,
				companyNumber: '00012345'
			})
		).rejects.toMatchObject({ code: 'COMPANIES_HOUSE_NOT_CONFIGURED' });
		await expect(
			f.clients.createEntity(f.owner, { firmId: f.firm.id, clientId: f.client.id })
		).rejects.toThrow('Enter a company number or a name');

		const entity = await f.clients.createEntity(f.owner, {
			firmId: f.firm.id,
			clientId: f.client.id,
			name: 'Synthetic Partners LLP',
			entityType: 'llp',
			companyNumber: 'oc301234'
		});
		expect(entity).toMatchObject({ entityType: 'llp', companyNumber: 'OC301234' });

		const scope = { firmId: f.firm.id, entityId: entity.id };
		const updated = await f.clients.updateEntity(f.owner, {
			...scope,
			name: 'Synthetic Partners LLP',
			entityType: 'llp',
			companyNumber: '',
			accountingFramework: 'frs102_1a',
			sizeClass: 'small',
			yearEndDay: '30',
			yearEndMonth: '6'
		});
		expect(updated).toMatchObject({
			companyNumber: null,
			accountingFramework: 'frs102_1a',
			sizeClass: 'small',
			yearEndDay: 30,
			yearEndMonth: 6
		});
		const base = { ...scope, name: 'Synthetic Partners LLP', entityType: 'llp' as const };
		await expect(
			f.clients.updateEntity(f.owner, { ...base, yearEndDay: '31', yearEndMonth: '2' })
		).rejects.toThrow('does not have that many days');
		await expect(f.clients.updateEntity(f.owner, { ...base, yearEndDay: '31' })).rejects.toThrow(
			'both the day and month'
		);

		const [event] = await f.db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.action, 'entity.updated'));
		expect(event.details).toEqual({
			changed: ['companyNumber', 'accountingFramework', 'sizeClass', 'yearEndDay', 'yearEndMonth'],
			source: 'manual'
		});
	} finally {
		await f.close();
	}
}, 20000);

test('owners and admins manage entities; members only see entities they work on', async () => {
	const f = await setup(fakeCompaniesHouse([company]));
	try {
		await expect(
			f.clients.createEntity(f.member, {
				firmId: f.firm.id,
				clientId: f.client.id,
				name: 'Denied Ltd'
			})
		).rejects.toMatchObject({ status: 403 });
		await expect(
			f.clients.searchCompanies(f.member, { firmId: f.firm.id, query: 'synthetic' })
		).rejects.toMatchObject({ status: 403 });

		const entity = await f.clients.createEntity(f.owner, {
			firmId: f.firm.id,
			clientId: f.client.id,
			name: 'Synthetic Trading Ltd'
		});
		const scope = { firmId: f.firm.id, entityId: entity.id };
		await expect(f.clients.getEntity(f.member, scope)).rejects.toMatchObject({ status: 404 });

		const engagements = createEngagementsService(f.db);
		const engagement = await engagements.create(f.owner, {
			firmId: f.firm.id,
			entityId: entity.id,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
		await engagements.setAssignment(f.owner, {
			firmId: f.firm.id,
			engagementId: engagement.id,
			userId: f.member.id,
			role: 'auditor'
		});
		expect((await f.clients.getEntity(f.member, scope)).name).toBe('Synthetic Trading Ltd');
		await expect(
			f.clients.updateEntity(f.member, { ...scope, name: 'Renamed', entityType: 'other' })
		).rejects.toMatchObject({ status: 403 });
	} finally {
		await f.close();
	}
}, 20000);
