import type { auditEvents } from '../modules/audit/audit-event.entity';
import type { AccountingFramework, CompanyStatus, EntityType, SizeClass } from '#lib/companies.js';
import type { ControlKind, EntityRoleKind, PersonKind } from '#lib/people.js';
import type { entities } from '../modules/clients/client.entity';
import type { entityRoles, people } from '../modules/clients/person.entity';
import type { reportingPeriods } from '../modules/engagements/reporting-period.entity';
import type { EngagementRole } from '../modules/engagements/team.entity';
import type { users } from '../modules/identity/user.entity';
import type { MembershipRole } from '../modules/tenancy/membership.entity';

// Synthetic development identities only. This password is public and works only on
// local development databases; it deliberately skips the production password policy.
export const seedPassword = 'Pass123!';
export const seedTimestamp = new Date('2026-10-01T00:00:00.000Z');
export const seedOperator = 'development-seed:v1';

/**
 * A fixed UUID v7 for fixtures. All encode seedTimestamp; `range` keeps kinds apart:
 * 1 users, 2 tenants, 3 audit events, 4 clients, 5 entities, 6 periods, 7 engagements,
 * 8 people, 9 entity roles. Keep IDs stable: tests and bookmarks may use them.
 */
function fixtureId(range: number, n: number) {
	if (n >= 1000) throw new Error(`Too many seed fixtures in range ${range}`);
	return `01a0f4c2-c400-7000-8000-${String(range * 1000 + n).padStart(12, '0')}`;
}

export const seedIds = {
	groupOwner: fixtureId(1, 1),
	firmOwner: fixtureId(1, 2),
	auditor: fixtureId(1, 3),
	standaloneOwner: fixtureId(1, 4),
	group: fixtureId(2, 1),
	regionalGroup: fixtureId(2, 2),
	baldwynFirm: fixtureId(2, 3),
	wilkinsFirm: fixtureId(2, 4),
	standaloneFirm: fixtureId(2, 5),
	hartleyFirm: fixtureId(2, 6)
} as const;

export const seedUsers = [
	{ id: seedIds.groupOwner, name: 'Morgan Ellis', email: 'group.owner@example.test' },
	{ id: seedIds.firmOwner, name: 'Lucy Smith', email: 'firm.owner@example.test' },
	{ id: seedIds.auditor, name: 'Jamie Reed', email: 'auditor@example.test' },
	{ id: seedIds.standaloneOwner, name: 'Alex Taylor', email: 'standalone.owner@example.test' }
] as const satisfies Pick<typeof users.$inferInsert, 'id' | 'name' | 'email'>[];

type SeedTenant = {
	id: string;
	name: string;
	kind: 'group' | 'firm';
	handle: string | null;
	parentId: string | null;
	/** Who created it: a user for firms; groups are created by an operator. */
	createdBy: string | null;
};

/**
 * Shaped like a real private-equity roll-up, with fictional names: a PE-backed group
 * with a regional sub-group, acquired firms keeping their own names, and an
 * independent firm. Owning a group still gives no access to its firms: Morgan owns
 * Azelle Group but is not a member of Hartley Croft, so cannot see it.
 * Parent-first order is required by the database's tenancy guards.
 */
export const seedTenants: SeedTenant[] = [
	{
		id: seedIds.group,
		name: 'Azelle Group',
		kind: 'group',
		handle: null,
		parentId: null,
		createdBy: null
	},
	{
		id: seedIds.regionalGroup,
		name: 'Azelle North',
		kind: 'group',
		handle: null,
		parentId: seedIds.group,
		createdBy: null
	},
	{
		id: seedIds.baldwynFirm,
		name: 'Baldwyn & Co',
		kind: 'firm',
		handle: 'baldwyn-co',
		parentId: seedIds.regionalGroup,
		createdBy: seedIds.groupOwner
	},
	{
		id: seedIds.wilkinsFirm,
		name: 'Wilkins Kenmore',
		kind: 'firm',
		handle: 'wilkins-kenmore',
		parentId: seedIds.group,
		createdBy: seedIds.firmOwner
	},
	{
		id: seedIds.standaloneFirm,
		name: 'Meadowcroft Audit',
		kind: 'firm',
		handle: 'meadowcroft-audit',
		parentId: null,
		createdBy: seedIds.standaloneOwner
	},
	{
		id: seedIds.hartleyFirm,
		name: 'Hartley Croft',
		kind: 'firm',
		handle: 'hartley-croft',
		parentId: seedIds.regionalGroup,
		createdBy: seedIds.firmOwner
	}
];

/** The columns of the tenant table (seed tenants also record who created them). */
export function tenantRow({ id, name, kind, handle, parentId }: SeedTenant) {
	return { id, name, kind, handle, parentId };
}

/** Morgan works across two group firms; Lucy runs two and helps at a third. */
export const seedMemberships: { tenantId: string; userId: string; role: MembershipRole }[] = [
	{ tenantId: seedIds.group, userId: seedIds.groupOwner, role: 'owner' },
	{ tenantId: seedIds.regionalGroup, userId: seedIds.groupOwner, role: 'owner' },
	{ tenantId: seedIds.baldwynFirm, userId: seedIds.groupOwner, role: 'owner' },
	{ tenantId: seedIds.baldwynFirm, userId: seedIds.firmOwner, role: 'admin' },
	{ tenantId: seedIds.baldwynFirm, userId: seedIds.auditor, role: 'member' },
	{ tenantId: seedIds.wilkinsFirm, userId: seedIds.firmOwner, role: 'owner' },
	{ tenantId: seedIds.wilkinsFirm, userId: seedIds.groupOwner, role: 'admin' },
	{ tenantId: seedIds.hartleyFirm, userId: seedIds.firmOwner, role: 'owner' },
	{ tenantId: seedIds.standaloneFirm, userId: seedIds.standaloneOwner, role: 'owner' }
];

type Audit = { start: string; end: string; team: [userId: string, role: EngagementRole][] };

/** A legal entity as the firm records it, with its audits (none if not audited). */
type SeedCompany = {
	name: string;
	type: EntityType;
	status: CompanyStatus;
	incorporatedOn: string;
	sicCodes: string[];
	registeredOffice: string;
	framework: AccountingFramework;
	size: SizeClass;
	/** Only needed for entities with no audits; otherwise it comes from the audits. */
	yearEnd?: { day: number; month: number };
	audits: Audit[];
};

/** A role, naming the entity it is at (within the same client). */
type SeedRole = {
	entity: string;
	role: EntityRoleKind;
	from: string;
	to?: string;
	percent?: number;
	controls?: ControlKind[];
};

type SeedPerson = {
	name: string;
	kind: PersonKind;
	born?: [month: number, year: number];
	email?: string;
	phone?: string;
	roles: SeedRole[];
};

type SeedClient = { name: string; entities: SeedCompany[]; people: SeedPerson[] };

// Firm staff, by first name, to keep the portfolio below easy to read.
const morgan = seedIds.groupOwner;
const lucy = seedIds.firmOwner;
const jamie = seedIds.auditor;
const alex = seedIds.standaloneOwner;

/** One statutory audit of a reporting period, with its team. */
const audit = (start: string, end: string, ...team: Audit['team']): Audit => ({ start, end, team });

type CompanyDetails = Omit<SeedCompany, 'name' | 'type' | 'status' | 'audits'> &
	Partial<Pick<SeedCompany, 'status'>>;
/** A private limited company and its audits. */
const ltd = (name: string, details: CompanyDetails, ...audits: Audit[]): SeedCompany => ({
	name,
	type: 'private_limited',
	status: 'active',
	...details,
	audits
});
/** A limited liability partnership and its audits. */
const llp = (name: string, details: CompanyDetails, ...audits: Audit[]): SeedCompany => ({
	...ltd(name, details, ...audits),
	type: 'llp'
});

const individual = (
	name: string,
	contact: Omit<SeedPerson, 'name' | 'kind' | 'roles'>,
	...roles: SeedRole[][]
): SeedPerson => ({ name, kind: 'individual', ...contact, roles: roles.flat() });
const organisation = (name: string, ...roles: SeedRole[][]): SeedPerson => ({
	name,
	kind: 'organisation',
	roles: roles.flat()
});

const director = (entity: string, from: string, to?: string): SeedRole[] => [
	{ entity, role: 'director', from, to }
];
const secretary = (entity: string, from: string, to?: string): SeedRole[] => [
	{ entity, role: 'secretary', from, to }
];
const contact = (entity: string, from: string): SeedRole[] => [{ entity, role: 'contact', from }];
const designatedMember = (entity: string, from: string, controls: ControlKind[]): SeedRole[] => [
	{ entity, role: 'llp_designated_member', from },
	{ entity, role: 'psc', from: laterOf(from, PSC_REGISTER_STARTED), controls }
];

/** The PSC register started on 6 April 2016; earlier holdings were notified then. */
const PSC_REGISTER_STARTED = '2016-04-06';
const laterOf = (a: string, b: string) => (a > b ? a : b);

/**
 * A shareholding, plus the person-with-significant-control entry it implies (more
 * than 25%), using the register's bands. More than half also controls the board.
 */
function owns(entity: string, percent: number, from: string, to?: string): SeedRole[] {
	const roles: SeedRole[] = [{ entity, role: 'shareholder', from, to, percent }];
	const stillHeldWhenRegisterStarted = !to || to > PSC_REGISTER_STARTED;
	if (percent <= 25 || !stillHeldWhenRegisterStarted) return roles;
	const band = percent >= 75 ? '75_to_100' : percent > 50 ? '50_to_75' : '25_to_50';
	const controls: ControlKind[] = [`shares_${band}`, `votes_${band}`];
	if (percent > 50) controls.push('appoints_directors');
	roles.push({ entity, role: 'psc', from: laterOf(from, PSC_REGISTER_STARTED), to, controls });
	return roles;
}

/**
 * Each firm's client book, as an accounting firm would set it up: family groups with a
 * holding company, trading and property companies, an LLP, a dissolved former
 * subsidiary, directors past and present, shareholders (people and companies), outside
 * investors and the client's finance contacts. Teams vary so each person's Dashboard
 * shows different work, and some engagements deliberately leave the firm owner off.
 *
 * Everything is fictional. Phone numbers are in Ofcom's ranges for drama (01632 960xxx,
 * 07700 900xxx), emails use the reserved .example domain, and addresses have no postcode.
 */
const portfolio: { firmId: string; clients: SeedClient[] }[] = [
	{
		firmId: seedIds.baldwynFirm,
		clients: [
			{
				name: 'Harrow Family Holdings',
				entities: [
					ltd(
						'Harrow Holdings Ltd',
						{
							incorporatedOn: '2009-03-12',
							sicCodes: ['70100'],
							registeredOffice: 'Harrow House\nCanal Wharf\nLeeds\nWest Yorkshire',
							framework: 'frs102',
							size: 'medium'
						},
						audit('2026-01-01', '2026-12-31', [morgan, 'partner'], [lucy, 'manager'])
					),
					ltd(
						'Harrow Engineering Ltd',
						{
							incorporatedOn: '1987-06-01',
							sicCodes: ['25620', '28490'],
							registeredOffice: 'Harrow House\nCanal Wharf\nLeeds\nWest Yorkshire',
							framework: 'frs102',
							size: 'medium'
						},
						audit(
							'2026-01-01',
							'2026-12-31',
							[morgan, 'partner'],
							[lucy, 'manager'],
							[jamie, 'auditor']
						)
					),
					// A subsidiary exempt from audit: the group guarantees it (s479A).
					ltd('Harrow Property Ltd', {
						incorporatedOn: '2011-08-22',
						sicCodes: ['68209'],
						registeredOffice: 'Harrow House\nCanal Wharf\nLeeds\nWest Yorkshire',
						framework: 'frs102_1a',
						size: 'small',
						yearEnd: { day: 31, month: 12 }
					})
				],
				people: [
					individual(
						'Richard Harrow',
						{ born: [3, 1961], email: 'richard@harrow.example', phone: '07700 900101' },
						director('Harrow Holdings Ltd', '2009-03-12'),
						director('Harrow Engineering Ltd', '1994-02-01'),
						director('Harrow Property Ltd', '2011-08-22'),
						owns('Harrow Holdings Ltd', 70, '2009-03-12')
					),
					individual(
						'Susan Harrow',
						{ born: [11, 1963], email: 'susan@harrow.example' },
						director('Harrow Holdings Ltd', '2009-03-12'),
						director('Harrow Property Ltd', '2011-08-22'),
						secretary('Harrow Holdings Ltd', '2009-03-12'),
						owns('Harrow Holdings Ltd', 30, '2009-03-12')
					),
					individual(
						'Daniel Harrow',
						{ born: [6, 1990], email: 'daniel@harrow.example' },
						director('Harrow Engineering Ltd', '2019-05-01')
					),
					// The founder: retired, and sold his shares to the new holding company in 2009.
					individual(
						'Geoffrey Harrow',
						{ born: [1, 1934] },
						director('Harrow Engineering Ltd', '1987-06-01', '2021-03-31'),
						owns('Harrow Engineering Ltd', 100, '1987-06-01', '2009-03-12')
					),
					individual(
						'Karen Whitley',
						{
							born: [9, 1978],
							email: 'karen.whitley@harrow.example',
							phone: '01632 960101'
						},
						contact('Harrow Holdings Ltd', '2017-02-01'),
						contact('Harrow Engineering Ltd', '2017-02-01'),
						contact('Harrow Property Ltd', '2017-02-01')
					),
					organisation(
						'Harrow Holdings Ltd',
						owns('Harrow Engineering Ltd', 100, '2009-03-12'),
						owns('Harrow Property Ltd', 100, '2011-08-22')
					)
				]
			},
			{
				name: 'Northgate Bakeries',
				entities: [
					// Small, but audited: the bank's facility letter requires it.
					ltd(
						'Northgate Bakeries Ltd',
						{
							incorporatedOn: '1998-02-16',
							sicCodes: ['10710'],
							registeredOffice: 'Unit 3, Northgate Trading Estate\nWakefield\nWest Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2025-04-01', '2026-03-31', [morgan, 'partner'], [jamie, 'auditor'])
					)
				],
				people: [
					individual(
						'Paul Brennan',
						{ born: [4, 1966], email: 'paul@northgatebakeries.example', phone: '07700 900111' },
						director('Northgate Bakeries Ltd', '1998-02-16'),
						owns('Northgate Bakeries Ltd', 60, '1998-02-16')
					),
					individual(
						'Amira Brennan',
						{ born: [7, 1969], email: 'amira@northgatebakeries.example' },
						director('Northgate Bakeries Ltd', '2003-09-01'),
						secretary('Northgate Bakeries Ltd', '1998-02-16'),
						owns('Northgate Bakeries Ltd', 40, '1998-02-16')
					),
					individual(
						'Sam Okafor',
						{
							born: [2, 1985],
							email: 'sam.okafor@northgatebakeries.example',
							phone: '01632 960111'
						},
						contact('Northgate Bakeries Ltd', '2021-06-14')
					)
				]
			},
			{
				name: 'Whitcombe Motors',
				entities: [
					ltd(
						'Whitcombe Motors Ltd',
						{
							incorporatedOn: '1972-05-10',
							sicCodes: ['45111', '45200'],
							registeredOffice: 'Whitcombe House\nYork Road\nHarrogate\nNorth Yorkshire',
							framework: 'frs102',
							size: 'medium'
						},
						audit('2026-01-01', '2026-12-31', [morgan, 'partner'], [lucy, 'manager'])
					),
					ltd(
						'Whitcombe Leasing Ltd',
						{
							incorporatedOn: '2004-11-03',
							sicCodes: ['77110'],
							registeredOffice: 'Whitcombe House\nYork Road\nHarrogate\nNorth Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2026-01-01', '2026-12-31', [morgan, 'partner'], [lucy, 'manager'])
					)
				],
				people: [
					individual(
						'Martin Whitcombe',
						{ born: [10, 1958], email: 'martin@whitcombe.example', phone: '07700 900121' },
						director('Whitcombe Motors Ltd', '1984-04-01'),
						director('Whitcombe Leasing Ltd', '2004-11-03'),
						owns('Whitcombe Motors Ltd', 55, '1999-04-01')
					),
					individual(
						'Helen Whitcombe-Price',
						{ born: [5, 1962], email: 'helen@whitcombe.example' },
						director('Whitcombe Motors Ltd', '1991-01-01'),
						owns('Whitcombe Motors Ltd', 45, '1999-04-01')
					),
					individual(
						'Ian Moss',
						{ born: [12, 1974], email: 'ian.moss@whitcombe.example', phone: '01632 960121' },
						director('Whitcombe Motors Ltd', '2018-07-01'),
						director('Whitcombe Leasing Ltd', '2018-07-01'),
						contact('Whitcombe Motors Ltd', '2018-07-01'),
						contact('Whitcombe Leasing Ltd', '2018-07-01')
					),
					// The founder: passed the business to her children in 1999.
					individual(
						'Jean Whitcombe',
						{ born: [8, 1931] },
						director('Whitcombe Motors Ltd', '1972-05-10', '2016-09-30'),
						owns('Whitcombe Motors Ltd', 100, '1972-05-10', '1999-04-01')
					),
					organisation('Whitcombe Motors Ltd', owns('Whitcombe Leasing Ltd', 100, '2004-11-03'))
				]
			},
			{
				// Lucy leads this one; Morgan owns the firm but is not on the team.
				name: 'Aire Valley Care',
				entities: [
					ltd(
						'Aire Valley Care Homes Ltd',
						{
							incorporatedOn: '2006-01-19',
							sicCodes: ['87100', '87300'],
							registeredOffice: 'Riverside Lodge\nApperley Lane\nBradford\nWest Yorkshire',
							framework: 'frs102',
							size: 'medium'
						},
						audit('2025-04-01', '2026-03-31', [lucy, 'partner'], [jamie, 'auditor'])
					)
				],
				people: [
					individual(
						'Priya Nair',
						{ born: [2, 1971], email: 'priya@airevalleycare.example', phone: '07700 900131' },
						director('Aire Valley Care Homes Ltd', '2006-01-19'),
						owns('Aire Valley Care Homes Ltd', 50, '2006-01-19')
					),
					individual(
						'Rajesh Nair',
						{ born: [9, 1968], email: 'rajesh@airevalleycare.example' },
						director('Aire Valley Care Homes Ltd', '2006-01-19'),
						secretary('Aire Valley Care Homes Ltd', '2006-01-19'),
						owns('Aire Valley Care Homes Ltd', 50, '2006-01-19')
					),
					individual(
						'Joanne Pickering',
						{
							born: [4, 1980],
							email: 'joanne.pickering@airevalleycare.example',
							phone: '01632 960131'
						},
						contact('Aire Valley Care Homes Ltd', '2019-10-01')
					)
				]
			},
			{
				name: 'Moorland Brewing Co',
				entities: [
					ltd(
						'Moorland Brewing Ltd',
						{
							incorporatedOn: '2013-07-08',
							sicCodes: ['11050'],
							registeredOffice: 'The Old Mill\nMill Lane\nHebden Bridge\nWest Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2025-10-01', '2026-09-30', [morgan, 'partner'], [jamie, 'auditor'])
					)
				],
				people: [
					individual(
						'Oliver Brandt',
						{ born: [3, 1984], email: 'ollie@moorlandbrewing.example', phone: '07700 900141' },
						director('Moorland Brewing Ltd', '2013-07-08'),
						owns('Moorland Brewing Ltd', 45, '2013-07-08')
					),
					individual(
						'Fiona Kaye',
						{ born: [1, 1986], email: 'fiona@moorlandbrewing.example', phone: '01632 960141' },
						director('Moorland Brewing Ltd', '2013-07-08'),
						contact('Moorland Brewing Ltd', '2013-07-08'),
						owns('Moorland Brewing Ltd', 35, '2013-07-08')
					),
					// An outside investor, with a seat on the board.
					organisation(
						'Northern Craft Ventures LLP',
						owns('Moorland Brewing Ltd', 20, '2019-02-01')
					),
					individual(
						'Ben Ashworth',
						{ born: [6, 1975], email: 'ben@northerncraft.example' },
						director('Moorland Brewing Ltd', '2019-02-01')
					)
				]
			},
			{
				// A new client: entities and people set up, no engagement yet.
				name: 'Sterling Print Group',
				entities: [
					ltd('Sterling Print Ltd', {
						incorporatedOn: '1995-03-27',
						sicCodes: ['18129'],
						registeredOffice: 'Sterling Works\nKirkstall Road\nLeeds\nWest Yorkshire',
						framework: 'frs102_1a',
						size: 'small',
						yearEnd: { day: 31, month: 3 }
					}),
					ltd('Sterling Packaging Ltd', {
						incorporatedOn: '2008-06-02',
						sicCodes: ['17211'],
						registeredOffice: 'Sterling Works\nKirkstall Road\nLeeds\nWest Yorkshire',
						framework: 'frs102_1a',
						size: 'small',
						yearEnd: { day: 31, month: 3 }
					})
				],
				people: [
					individual(
						'Graham Sterling',
						{ born: [7, 1960], email: 'graham@sterlingprint.example', phone: '07700 900151' },
						director('Sterling Print Ltd', '1995-03-27'),
						director('Sterling Packaging Ltd', '2008-06-02'),
						owns('Sterling Print Ltd', 100, '1995-03-27')
					),
					individual(
						'Natalie Sterling',
						{ born: [3, 1992], email: 'natalie@sterlingprint.example' },
						director('Sterling Packaging Ltd', '2022-01-10')
					),
					individual(
						'Mark Fenwick',
						{
							born: [5, 1979],
							email: 'mark.fenwick@sterlingprint.example',
							phone: '01632 960151'
						},
						contact('Sterling Print Ltd', '2024-09-01'),
						contact('Sterling Packaging Ltd', '2024-09-01')
					),
					organisation('Sterling Print Ltd', owns('Sterling Packaging Ltd', 100, '2008-06-02'))
				]
			}
		]
	},
	{
		firmId: seedIds.wilkinsFirm,
		clients: [
			{
				name: 'Pennine Logistics',
				entities: [
					ltd(
						'Pennine Logistics Ltd',
						{
							incorporatedOn: '2001-10-15',
							sicCodes: ['49410', '52103'],
							registeredOffice:
								'Pennine House\nJunction 32 Business Park\nCastleford\nWest Yorkshire',
							framework: 'frs102',
							size: 'medium'
						},
						audit('2026-01-01', '2026-12-31', [lucy, 'partner'], [morgan, 'manager'])
					),
					// The family's property LLP, which owns the depot. Not audited.
					llp('Pennine Property LLP', {
						incorporatedOn: '2014-04-01',
						sicCodes: ['68209'],
						registeredOffice:
							'Pennine House\nJunction 32 Business Park\nCastleford\nWest Yorkshire',
						framework: 'frs102_1a',
						size: 'small',
						yearEnd: { day: 31, month: 12 }
					})
				],
				people: [
					individual(
						'Andrew Kershaw',
						{ born: [8, 1965], email: 'andrew@penninelogistics.example', phone: '07700 900161' },
						director('Pennine Logistics Ltd', '2001-10-15'),
						owns('Pennine Logistics Ltd', 80, '2001-10-15'),
						designatedMember('Pennine Property LLP', '2014-04-01', ['votes_50_to_75', 'other'])
					),
					individual(
						'Claire Kershaw',
						{ born: [12, 1967], email: 'claire@penninelogistics.example' },
						director('Pennine Logistics Ltd', '2005-01-01'),
						owns('Pennine Logistics Ltd', 20, '2005-01-01'),
						designatedMember('Pennine Property LLP', '2014-04-01', ['votes_25_to_50', 'other'])
					),
					individual(
						'Stuart Dobson',
						{
							born: [3, 1972],
							email: 'stuart.dobson@penninelogistics.example',
							phone: '01632 960161'
						},
						director('Pennine Logistics Ltd', '2020-01-01'),
						contact('Pennine Logistics Ltd', '2012-05-01'),
						contact('Pennine Property LLP', '2014-04-01')
					),
					individual(
						'Rachel Ingham',
						{ born: [10, 1970] },
						director('Pennine Logistics Ltd', '2010-03-01', '2024-06-30')
					)
				]
			},
			{
				// Morgan is an admin here but not on this team: listed, but not openable.
				name: 'Calder Dental Group',
				entities: [
					ltd(
						'Calder Dental Ltd',
						{
							incorporatedOn: '2010-09-06',
							sicCodes: ['86230'],
							registeredOffice: '14 Westgate\nHalifax\nWest Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2025-07-01', '2026-06-30', [lucy, 'partner'])
					)
				],
				people: [
					individual(
						'Hannah Lister',
						{ born: [6, 1979], email: 'hannah@calderdental.example', phone: '07700 900171' },
						director('Calder Dental Ltd', '2010-09-06'),
						owns('Calder Dental Ltd', 100, '2010-09-06')
					),
					individual(
						'James Lister',
						{ born: [1, 1977] },
						secretary('Calder Dental Ltd', '2010-09-06')
					),
					individual(
						'Mei Chen',
						{ born: [11, 1988], email: 'mei.chen@calderdental.example', phone: '01632 960171' },
						contact('Calder Dental Ltd', '2022-03-01')
					)
				]
			},
			{
				name: 'Thornbury Construction',
				entities: [
					ltd(
						'Thornbury Construction Ltd',
						{
							incorporatedOn: '1999-01-11',
							sicCodes: ['41201', '43999'],
							registeredOffice: 'Thornbury Yard\nDewsbury Road\nWakefield\nWest Yorkshire',
							framework: 'frs102',
							size: 'medium'
						},
						audit('2025-04-01', '2026-03-31', [lucy, 'partner'], [morgan, 'manager'])
					)
				],
				people: [
					individual(
						'Neil Thornbury',
						{ born: [2, 1963], email: 'neil@thornbury.example', phone: '07700 900181' },
						director('Thornbury Construction Ltd', '1999-01-11'),
						owns('Thornbury Construction Ltd', 51, '1999-01-11')
					),
					individual(
						'Gary Thornbury',
						{ born: [9, 1966], email: 'gary@thornbury.example' },
						director('Thornbury Construction Ltd', '1999-01-11'),
						owns('Thornbury Construction Ltd', 49, '1999-01-11')
					),
					individual(
						'Lisa Barker',
						{ born: [4, 1982], email: 'lisa.barker@thornbury.example', phone: '01632 960181' },
						secretary('Thornbury Construction Ltd', '2015-08-03'),
						contact('Thornbury Construction Ltd', '2015-08-03')
					)
				]
			},
			{
				name: 'Castleford Plastics',
				entities: [
					ltd(
						'Castleford Plastics Ltd',
						{
							incorporatedOn: '1984-03-20',
							sicCodes: ['22290'],
							registeredOffice:
								'Unit 12, Wheldon Road Industrial Estate\nCastleford\nWest Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2026-01-01', '2026-12-31', [lucy, 'partner'])
					),
					// A former subsidiary, merged into the parent and struck off in 2023.
					ltd('Castleford Mouldings Ltd', {
						status: 'dissolved',
						incorporatedOn: '1997-05-14',
						sicCodes: ['22290'],
						registeredOffice: 'Unit 12, Wheldon Road Industrial Estate\nCastleford\nWest Yorkshire',
						framework: 'frs102_1a',
						size: 'small',
						yearEnd: { day: 31, month: 12 }
					})
				],
				people: [
					individual(
						'Derek Firth',
						{ born: [5, 1957], email: 'derek@castlefordplastics.example', phone: '07700 900191' },
						director('Castleford Plastics Ltd', '1984-03-20'),
						director('Castleford Mouldings Ltd', '1997-05-14', '2023-02-28'),
						owns('Castleford Plastics Ltd', 100, '1984-03-20')
					),
					individual(
						'Kirsty Firth',
						{ born: [8, 1986], email: 'kirsty@castlefordplastics.example' },
						director('Castleford Plastics Ltd', '2020-04-01')
					),
					individual(
						'Tony Walsh',
						{
							born: [3, 1971],
							email: 'tony.walsh@castlefordplastics.example',
							phone: '01632 960191'
						},
						contact('Castleford Plastics Ltd', '2018-01-08')
					),
					organisation(
						'Castleford Plastics Ltd',
						owns('Castleford Mouldings Ltd', 100, '1997-05-14', '2023-02-28')
					)
				]
			}
		]
	},
	{
		firmId: seedIds.hartleyFirm,
		clients: [
			{
				name: 'Ouse Valley Farms',
				entities: [
					ltd(
						'Ouse Valley Farms Ltd',
						{
							incorporatedOn: '1976-04-02',
							sicCodes: ['01500', '01610'],
							registeredOffice: 'Low Field Farm\nSelby Road\nYork\nNorth Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2026-01-01', '2026-12-31', [lucy, 'partner'])
					)
				],
				people: [
					individual(
						'William Atkinson',
						{ born: [10, 1955], phone: '07700 900201' },
						director('Ouse Valley Farms Ltd', '1981-04-01'),
						owns('Ouse Valley Farms Ltd', 50, '1981-04-01')
					),
					individual(
						'Margaret Atkinson',
						{ born: [6, 1957] },
						director('Ouse Valley Farms Ltd', '1981-04-01'),
						owns('Ouse Valley Farms Ltd', 25, '1981-04-01')
					),
					individual(
						'Edward Atkinson',
						{ born: [2, 1986], email: 'edward@ousevalleyfarms.example' },
						director('Ouse Valley Farms Ltd', '2012-04-01'),
						owns('Ouse Valley Farms Ltd', 25, '2012-04-01')
					),
					individual(
						'Ruth Dalby',
						{ born: [7, 1969], email: 'ruth@ousevalleyfarms.example', phone: '01632 960201' },
						contact('Ouse Valley Farms Ltd', '2008-01-01')
					)
				]
			},
			{
				name: 'Kirkby Fresh Produce',
				entities: [
					ltd(
						'Kirkby Fresh Produce Ltd',
						{
							incorporatedOn: '2003-02-24',
							sicCodes: ['46310'],
							registeredOffice: 'Unit 5, Kirkby Lane\nThirsk\nNorth Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2025-02-01', '2026-01-31', [lucy, 'partner'])
					)
				],
				people: [
					individual(
						'Simon Kirkby',
						{ born: [11, 1972], email: 'simon@kirkbyfresh.example', phone: '07700 900211' },
						director('Kirkby Fresh Produce Ltd', '2003-02-24'),
						owns('Kirkby Fresh Produce Ltd', 100, '2003-02-24')
					),
					individual(
						'Anita Shah',
						{ born: [5, 1983], email: 'anita.shah@kirkbyfresh.example', phone: '01632 960211' },
						contact('Kirkby Fresh Produce Ltd', '2016-06-01')
					)
				]
			}
		]
	},
	{
		firmId: seedIds.standaloneFirm,
		clients: [
			{
				name: 'Kestrel Software',
				entities: [
					ltd(
						'Kestrel Software Ltd',
						{
							incorporatedOn: '2015-11-09',
							sicCodes: ['62012'],
							registeredOffice: 'Floor 3, Platform\nNew Station Street\nLeeds\nWest Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2025-04-01', '2026-03-31', [alex, 'partner'])
					)
				],
				people: [
					individual(
						'Ravi Patel',
						{ born: [1, 1987], email: 'ravi@kestrelsoftware.example', phone: '07700 900221' },
						director('Kestrel Software Ltd', '2015-11-09'),
						owns('Kestrel Software Ltd', 42, '2015-11-09')
					),
					individual(
						'Emma Doyle',
						{ born: [9, 1988], email: 'emma@kestrelsoftware.example', phone: '01632 960221' },
						director('Kestrel Software Ltd', '2015-11-09'),
						contact('Kestrel Software Ltd', '2015-11-09'),
						owns('Kestrel Software Ltd', 38, '2015-11-09')
					),
					// A seed investor, with a nominee director.
					organisation('Brightwater Seed Fund LP', owns('Kestrel Software Ltd', 20, '2021-06-30')),
					individual(
						'Tom Richardson',
						{ born: [4, 1980], email: 'tom@brightwater.example' },
						director('Kestrel Software Ltd', '2021-06-30')
					)
				]
			},
			{
				name: 'Ellison Recruitment',
				entities: [
					ltd(
						'Ellison Recruitment Ltd',
						{
							incorporatedOn: '2009-05-18',
							sicCodes: ['78109', '78200'],
							registeredOffice: '22 Park Square\nLeeds\nWest Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2026-01-01', '2026-12-31', [alex, 'partner'])
					)
				],
				people: [
					individual(
						'Louise Ellison',
						{ born: [8, 1975], email: 'louise@ellisonrecruitment.example', phone: '07700 900231' },
						director('Ellison Recruitment Ltd', '2009-05-18'),
						owns('Ellison Recruitment Ltd', 75, '2009-05-18')
					),
					individual(
						'Craig Ellison',
						{ born: [12, 1973] },
						director('Ellison Recruitment Ltd', '2009-05-18', '2019-12-31'),
						owns('Ellison Recruitment Ltd', 25, '2009-05-18')
					),
					individual(
						'Phil Garside',
						{
							born: [6, 1979],
							email: 'phil.garside@ellisonrecruitment.example',
							phone: '01632 960231'
						},
						contact('Ellison Recruitment Ltd', '2019-03-04')
					)
				]
			},
			{
				name: 'Greenfold Garden Centres',
				entities: [
					ltd(
						'Greenfold Garden Centres Ltd',
						{
							incorporatedOn: '1989-09-29',
							sicCodes: ['47760'],
							registeredOffice: 'Greenfold Nurseries\nOtley Road\nIlkley\nWest Yorkshire',
							framework: 'frs102_1a',
							size: 'small'
						},
						audit('2025-02-01', '2026-01-31', [alex, 'partner'])
					)
				],
				people: [
					individual(
						'Stephen Greenwood',
						{ born: [4, 1959], email: 'stephen@greenfold.example', phone: '07700 900241' },
						director('Greenfold Garden Centres Ltd', '1989-09-29'),
						owns('Greenfold Garden Centres Ltd', 60, '1989-09-29')
					),
					individual(
						'Diane Greenwood',
						{ born: [10, 1961], email: 'diane@greenfold.example' },
						director('Greenfold Garden Centres Ltd', '1989-09-29'),
						secretary('Greenfold Garden Centres Ltd', '1989-09-29'),
						owns('Greenfold Garden Centres Ltd', 40, '1989-09-29')
					),
					individual(
						'Laura Greenwood',
						{ born: [3, 1990], email: 'laura@greenfold.example' },
						director('Greenfold Garden Centres Ltd', '2018-03-01')
					),
					individual(
						'Gail Turner',
						{ born: [1, 1972], email: 'gail.turner@greenfold.example', phone: '01632 960241' },
						contact('Greenfold Garden Centres Ltd', '2012-11-01')
					)
				]
			}
		]
	}
];

/**
 * The date `months` after `date` (or before, if negative). Month ends stay month ends,
 * as Companies House counts them: 30 June + 9 months → 31 March, 31 Dec + 9 → 30 Sep.
 */
function addMonths(date: string, months: number) {
	const [year, month, day] = date.split('-').map(Number);
	const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	const targetYear = target.getUTCFullYear();
	const targetMonth = target.getUTCMonth() + 1;
	const lastDay = daysIn(targetYear, targetMonth);
	target.setUTCDate(day === daysIn(year, month) ? lastDay : Math.min(day, lastDay));
	return target.toISOString().slice(0, 10);
}

/**
 * Filing dates as if the client always files on time: private companies have nine
 * months after the year end. For an audited entity, the year being audited is the
 * next one due. Dissolved companies have none.
 */
function filingDates(
	yearEnd: { day: number; month: number },
	status: CompanyStatus,
	auditedYearEnd: string | undefined
) {
	if (status === 'dissolved') return { lastAccountsMadeUpTo: null, accountsNextDueOn: null };
	if (auditedYearEnd)
		return {
			lastAccountsMadeUpTo: addMonths(auditedYearEnd, -12),
			accountsNextDueOn: addMonths(auditedYearEnd, 9)
		};
	const today = seedTimestamp.toISOString().slice(0, 10);
	for (let year = seedTimestamp.getUTCFullYear(); ; year--) {
		const end = `${year}-${String(yearEnd.month).padStart(2, '0')}-${String(yearEnd.day).padStart(2, '0')}`;
		if (addMonths(end, 9) <= today)
			return { lastAccountsMadeUpTo: end, accountsNextDueOn: addMonths(addMonths(end, 12), 9) };
	}
}

// The portfolio flattened into table rows, with fixed IDs.
type Row<T extends { $inferInsert: object }> = T['$inferInsert'] & { id: string; firmId: string };
export const seedClients: { id: string; firmId: string; name: string }[] = [];
export const seedEntities: (Row<typeof entities> & { clientId: string })[] = [];
export const seedPeriods: Row<typeof reportingPeriods>[] = [];
export const seedEngagements: { id: string; firmId: string; periodId: string }[] = [];
export const seedTeam: {
	firmId: string;
	engagementId: string;
	userId: string;
	role: EngagementRole;
}[] = [];
export const seedPeople: Row<typeof people>[] = [];
export const seedRoles: (Row<typeof entityRoles> & {
	entityId: string;
	personId: string;
	role: EntityRoleKind;
})[] = [];

for (const { firmId, clients } of portfolio) {
	for (const client of clients) {
		const clientId = fixtureId(4, seedClients.length + 1);
		seedClients.push({ id: clientId, firmId, name: client.name });
		const entityIds = new Map<string, string>();

		for (const entity of client.entities) {
			const entityId = fixtureId(5, seedEntities.length + 1);
			entityIds.set(entity.name, entityId);
			const [, month, day] = (entity.audits[0]?.end ?? '').split('-').map(Number);
			const yearEnd = entity.yearEnd ?? { day, month };
			seedEntities.push({
				id: entityId,
				firmId,
				clientId,
				name: entity.name,
				entityType: entity.type,
				// ZZ is never issued by Companies House, so these can't match a real company.
				companyNumber: `ZZ${String(seedEntities.length + 1).padStart(6, '0')}`,
				companyStatus: entity.status,
				incorporatedOn: entity.incorporatedOn,
				registeredOffice: entity.registeredOffice,
				sicCodes: entity.sicCodes,
				yearEndDay: yearEnd.day,
				yearEndMonth: yearEnd.month,
				...filingDates(yearEnd, entity.status, entity.audits.at(-1)?.end),
				accountingFramework: entity.framework,
				sizeClass: entity.size
			});
			for (const audit of entity.audits) {
				const periodId = fixtureId(6, seedPeriods.length + 1);
				const engagementId = fixtureId(7, seedEngagements.length + 1);
				seedPeriods.push({
					id: periodId,
					firmId,
					entityId,
					startsOn: audit.start,
					endsOn: audit.end
				});
				seedEngagements.push({ id: engagementId, firmId, periodId });
				for (const [userId, role] of audit.team)
					seedTeam.push({ firmId, engagementId, userId, role });
			}
		}

		for (const person of client.people) {
			const personId = fixtureId(8, seedPeople.length + 1);
			seedPeople.push({
				id: personId,
				firmId,
				kind: person.kind,
				name: person.name,
				email: person.email ?? null,
				phone: person.phone ?? null,
				birthMonth: person.born?.[0] ?? null,
				birthYear: person.born?.[1] ?? null
			});
			for (const role of person.roles) {
				const entityId = entityIds.get(role.entity);
				if (!entityId) throw new Error(`Seed role names an unknown entity: ${role.entity}`);
				seedRoles.push({
					id: fixtureId(9, seedRoles.length + 1),
					firmId,
					entityId,
					personId,
					role: role.role,
					startedOn: role.from,
					endedOn: role.to ?? null,
					shareholdingPercent: role.percent ?? null,
					controls: role.controls ?? [],
					source: 'manual'
				});
			}
		}
	}
}

// Audit history for everything above, as the app would have recorded it.
type SeedEvent = typeof auditEvents.$inferInsert & { id: string; createdAt: Date };
export const seedEvents: SeedEvent[] = [];
const record = (event: Omit<SeedEvent, 'id' | 'createdAt'>) =>
	seedEvents.push({ ...event, id: fixtureId(3, seedEvents.length + 1), createdAt: seedTimestamp });
const firmOwnerOf = (firmId: string) =>
	seedTenants.find((tenant) => tenant.id === firmId)!.createdBy!;

for (const user of seedUsers) {
	record({
		action: 'user.provisioned',
		operatorName: seedOperator,
		subjectUserId: user.id,
		targetType: 'user',
		targetId: user.id
	});
}
for (const tenant of seedTenants) {
	const who = tenant.createdBy ? { actorId: tenant.createdBy } : { operatorName: seedOperator };
	record({
		...who,
		action: 'tenant.created',
		tenantId: tenant.id,
		targetType: 'tenant',
		targetId: tenant.id,
		details: { kind: tenant.kind, parentId: tenant.kind === 'group' ? tenant.parentId : null }
	});
	// Firms are created standalone; an operator then moves them into their group.
	if (tenant.kind === 'firm' && tenant.parentId) {
		record({
			action: 'tenant.moved',
			operatorName: seedOperator,
			tenantId: tenant.id,
			targetType: 'tenant',
			targetId: tenant.id,
			details: { previousParentId: null, newParentId: tenant.parentId }
		});
	}
}
for (const membership of seedMemberships) {
	const tenant = seedTenants.find((candidate) => candidate.id === membership.tenantId)!;
	if (tenant.createdBy === membership.userId) continue; // The creator became owner automatically.
	const who = tenant.createdBy ? { actorId: tenant.createdBy } : { operatorName: seedOperator };
	record({
		...who,
		action: 'membership.changed',
		tenantId: tenant.id,
		subjectUserId: membership.userId,
		details: { previousRole: null, newRole: membership.role }
	});
}
for (const client of seedClients) {
	record({
		action: 'client.created',
		actorId: firmOwnerOf(client.firmId),
		tenantId: client.firmId,
		targetType: 'client',
		targetId: client.id
	});
}
for (const entity of seedEntities) {
	record({
		action: 'entity.created',
		actorId: firmOwnerOf(entity.firmId),
		tenantId: entity.firmId,
		targetType: 'entity',
		targetId: entity.id,
		details: { clientId: entity.clientId, source: 'manual' }
	});
}
for (const engagement of seedEngagements) {
	const period = seedPeriods.find((candidate) => candidate.id === engagement.periodId)!;
	const entity = seedEntities.find((candidate) => candidate.id === period.entityId)!;
	const actorId = firmOwnerOf(engagement.firmId);
	record({
		action: 'engagement.created',
		actorId,
		tenantId: engagement.firmId,
		engagementId: engagement.id,
		targetType: 'engagement',
		targetId: engagement.id,
		details: {
			clientId: entity.clientId,
			entityId: entity.id,
			periodId: period.id,
			periodStart: period.startsOn,
			periodEnd: period.endsOn
		}
	});
	for (const member of seedTeam.filter((row) => row.engagementId === engagement.id)) {
		record({
			action: 'engagement.team_changed',
			actorId,
			tenantId: engagement.firmId,
			engagementId: engagement.id,
			subjectUserId: member.userId,
			details: { previousRole: null, newRole: member.role }
		});
	}
}
for (const person of seedPeople) {
	record({
		action: 'person.created',
		actorId: firmOwnerOf(person.firmId),
		tenantId: person.firmId,
		targetType: 'person',
		targetId: person.id,
		details: { source: 'manual' }
	});
}
for (const role of seedRoles) {
	record({
		action: 'entity_role.added',
		actorId: firmOwnerOf(role.firmId),
		tenantId: role.firmId,
		targetType: 'entity',
		targetId: role.entityId,
		details: { roleId: role.id, personId: role.personId, role: role.role, source: 'manual' }
	});
}
