import type { auditEvents } from '../modules/audit/audit-event.entity';
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
 * 1 users, 2 tenants, 3 audit events, 4 clients, 5 entities, 6 periods, 7 engagements.
 * Keep IDs stable: tests and bookmarks may use them.
 */
function fixtureId(range: number, n: number) {
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
type Portfolio = {
	firmId: string;
	clients: { name: string; entities: { name: string; audits: Audit[] }[] }[];
}[];

// People, by first name, to keep the portfolio below easy to read.
const morgan = seedIds.groupOwner;
const lucy = seedIds.firmOwner;
const jamie = seedIds.auditor;
const alex = seedIds.standaloneOwner;

/** One statutory audit of a reporting period, with its team. */
const audit = (start: string, end: string, ...team: Audit['team']): Audit => ({ start, end, team });
/** A legal entity and its audits (none for a new client not yet engaged). */
const entity = (name: string, ...audits: Audit[]) => ({ name, audits });

/**
 * Each firm's clients, legal entities and statutory audits: owner-managed UK
 * companies with a spread of year ends. Teams vary so each person's Dashboard shows
 * different work, and some engagements deliberately leave the firm owner off the team.
 */
const portfolio: Portfolio = [
	{
		firmId: seedIds.baldwynFirm,
		clients: [
			{
				name: 'Harrow Family Holdings',
				entities: [
					entity(
						'Harrow Engineering Ltd',
						audit(
							'2025-01-01',
							'2025-12-31',
							[morgan, 'partner'],
							[lucy, 'manager'],
							[jamie, 'auditor']
						)
					),
					entity('Harrow Property Ltd')
				]
			},
			{
				name: 'Northgate Bakeries',
				entities: [
					entity(
						'Northgate Bakeries Ltd',
						audit('2025-04-01', '2026-03-31', [morgan, 'partner'], [jamie, 'auditor'])
					)
				]
			},
			{
				name: 'Whitcombe Motors',
				entities: [
					entity(
						'Whitcombe Motors Ltd',
						audit('2025-01-01', '2025-12-31', [morgan, 'partner'], [lucy, 'manager'])
					),
					entity(
						'Whitcombe Leasing Ltd',
						audit('2025-01-01', '2025-12-31', [morgan, 'partner'], [lucy, 'manager'])
					)
				]
			},
			{
				// Lucy leads this one; Morgan owns the firm but is not on the team.
				name: 'Aire Valley Care',
				entities: [
					entity(
						'Aire Valley Care Homes Ltd',
						audit('2025-04-01', '2026-03-31', [lucy, 'partner'], [jamie, 'auditor'])
					)
				]
			},
			{
				name: 'Moorland Brewing Co',
				entities: [
					entity(
						'Moorland Brewing Ltd',
						audit('2024-10-01', '2025-09-30', [morgan, 'partner'], [jamie, 'auditor'])
					)
				]
			},
			{
				// A new client: entities set up, no engagement yet.
				name: 'Sterling Print Group',
				entities: [entity('Sterling Print Ltd'), entity('Sterling Packaging Ltd')]
			}
		]
	},
	{
		firmId: seedIds.wilkinsFirm,
		clients: [
			{
				name: 'Pennine Logistics',
				entities: [
					entity(
						'Pennine Logistics Ltd',
						audit('2025-01-01', '2025-12-31', [lucy, 'partner'], [morgan, 'manager'])
					)
				]
			},
			{
				// Morgan is an admin here but not on this team: listed, but not openable.
				name: 'Calder Dental Group',
				entities: [
					entity('Calder Dental Ltd', audit('2024-07-01', '2025-06-30', [lucy, 'partner']))
				]
			},
			{
				name: 'Thornbury Construction',
				entities: [
					entity(
						'Thornbury Construction Ltd',
						audit('2025-04-01', '2026-03-31', [lucy, 'partner'], [morgan, 'manager'])
					)
				]
			},
			{
				name: 'Castleford Plastics',
				entities: [
					entity('Castleford Plastics Ltd', audit('2025-01-01', '2025-12-31', [lucy, 'partner']))
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
					entity('Ouse Valley Farms Ltd', audit('2025-01-01', '2025-12-31', [lucy, 'partner']))
				]
			},
			{
				name: 'Kirkby Fresh Produce',
				entities: [
					entity('Kirkby Fresh Produce Ltd', audit('2025-02-01', '2026-01-31', [lucy, 'partner']))
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
					entity('Kestrel Software Ltd', audit('2025-04-01', '2026-03-31', [alex, 'partner']))
				]
			},
			{
				name: 'Ellison Recruitment',
				entities: [
					entity('Ellison Recruitment Ltd', audit('2025-01-01', '2025-12-31', [alex, 'partner']))
				]
			},
			{
				name: 'Greenfold Garden Centres',
				entities: [
					entity(
						'Greenfold Garden Centres Ltd',
						audit('2025-02-01', '2026-01-31', [alex, 'partner'])
					)
				]
			}
		]
	}
];

// The portfolio flattened into table rows, with fixed IDs.
export const seedClients: { id: string; firmId: string; name: string }[] = [];
export const seedEntities: {
	id: string;
	firmId: string;
	clientId: string;
	name: string;
	entityType: 'private_limited';
	companyNumber: string;
	companyStatus: 'active';
	yearEndDay: number;
	yearEndMonth: number;
	accountingFramework: 'frs102' | 'frs102_1a';
	sizeClass: 'small' | 'medium';
}[] = [];

// Larger clients report under full FRS 102; the rest are small companies.
const mediumSized = new Set([
	'Whitcombe Motors Ltd',
	'Aire Valley Care Homes Ltd',
	'Pennine Logistics Ltd',
	'Thornbury Construction Ltd'
]);
export const seedPeriods: {
	id: string;
	firmId: string;
	entityId: string;
	startsOn: string;
	endsOn: string;
}[] = [];
export const seedEngagements: { id: string; firmId: string; periodId: string }[] = [];
export const seedTeam: {
	firmId: string;
	engagementId: string;
	userId: string;
	role: EngagementRole;
}[] = [];

for (const { firmId, clients } of portfolio) {
	for (const client of clients) {
		const clientId = fixtureId(4, seedClients.length + 1);
		seedClients.push({ id: clientId, firmId, name: client.name });
		for (const entity of client.entities) {
			const entityId = fixtureId(5, seedEntities.length + 1);
			// Year end from the entity's audits; 31 December for entities not yet audited.
			const [, endMonth, endDay] = (entity.audits[0]?.end ?? '2025-12-31').split('-').map(Number);
			const medium = mediumSized.has(entity.name);
			seedEntities.push({
				id: entityId,
				firmId,
				clientId,
				name: entity.name,
				entityType: 'private_limited',
				// ZZ is never issued by Companies House, so these can't match a real company.
				companyNumber: `ZZ${String(seedEntities.length + 1).padStart(6, '0')}`,
				companyStatus: 'active',
				yearEndDay: endDay,
				yearEndMonth: endMonth,
				accountingFramework: medium ? 'frs102' : 'frs102_1a',
				sizeClass: medium ? 'medium' : 'small'
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
