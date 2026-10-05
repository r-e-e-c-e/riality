import { sql } from 'drizzle-orm';
import {
	check,
	date,
	foreignKey,
	index,
	numeric,
	smallint,
	snakeCase,
	text,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import type { ClientStatus, RiskRating } from '#lib/clients.js';
import type { AccountingFramework, CompanyStatus, EntityType, SizeClass } from '#lib/companies.js';
import type { ControlKind, EntityRoleKind, PersonKind } from '#lib/people.js';
import { createdAt, id, timestampTz } from '../../db/columns';
import { memberships } from '../tenancy/membership.entity';
import { tenants } from '../tenancy/tenant.entity';

// The client model: clients, their legal entities, and the people linked to them.
// Every firm-owned table has a firmId and a unique (firmId, id) pair. Child tables
// reference that pair, so the database itself refuses links between two firms'
// records (for example an entity in firm A pointing at a client in firm B).

/**
 * A client relationship of the firm, for example a family business with several
 * companies. The partner and manager are firm members responsible for it; the key
 * contact is the person the firm deals with day to day.
 */
export const clients = snakeCase.table(
	'client',
	{
		id: id(),
		firmId: uuid()
			.notNull()
			.references(() => tenants.id, { onDelete: 'restrict' }),
		name: text().notNull(),
		status: text().$type<ClientStatus>().notNull().default('active'),
		partnerId: uuid(),
		managerId: uuid(),
		keyContactId: uuid(),
		riskRating: text().$type<RiskRating>(),
		/** When acceptance (or, later, continuance) was last reviewed and approved. */
		lastReviewedOn: date(),
		createdAt: createdAt()
	},
	(t) => [
		unique('client_firm_id_unique').on(t.firmId, t.id),
		// The partner and manager must be members of the firm. Removing a member clears
		// these first (see removeClientResponsibilities).
		foreignKey({
			name: 'client_partner_membership_fk',
			columns: [t.firmId, t.partnerId],
			foreignColumns: [memberships.tenantId, memberships.userId]
		}).onDelete('restrict'),
		foreignKey({
			name: 'client_manager_membership_fk',
			columns: [t.firmId, t.managerId],
			foreignColumns: [memberships.tenantId, memberships.userId]
		}).onDelete('restrict'),
		foreignKey({
			name: 'client_key_contact_fk',
			columns: [t.firmId, t.keyContactId],
			foreignColumns: [people.firmId, people.id]
		}).onDelete('restrict'),
		check('client_name_length', sql`length(trim(${t.name})) between 1 and 160`)
	]
);

/**
 * A legal entity (usually a UK company) belonging to a client. This is what gets
 * audited. Register details (company number to accounts due date) can be filled and
 * refreshed from Companies House; framework and size are the firm's own judgement.
 */
export const entities = snakeCase.table(
	'entity',
	{
		id: id(),
		firmId: uuid().notNull(),
		clientId: uuid().notNull(),
		name: text().notNull(),
		entityType: text().$type<EntityType>().notNull().default('private_limited'),

		// From the public register (Companies House), when the entity is registered there.
		companyNumber: text(),
		companyStatus: text().$type<CompanyStatus>(),
		incorporatedOn: date(),
		registeredOffice: text(),
		sicCodes: text()
			.array()
			.notNull()
			.default(sql`'{}'`),
		/** The accounting reference date (year end), as day and month. */
		yearEndDay: smallint(),
		yearEndMonth: smallint(),
		accountsNextDueOn: date(),
		lastAccountsMadeUpTo: date(),
		companiesHouseSyncedAt: timestampTz(),

		// The firm's assessment.
		accountingFramework: text().$type<AccountingFramework>(),
		sizeClass: text().$type<SizeClass>(),
		createdAt: createdAt()
	},
	(t) => [
		unique('entity_firm_id_unique').on(t.firmId, t.id),
		uniqueIndex('entity_firm_company_number_idx').on(t.firmId, t.companyNumber),
		foreignKey({
			name: 'entity_client_fk',
			columns: [t.firmId, t.clientId],
			foreignColumns: [clients.firmId, clients.id]
		}).onDelete('restrict'),
		check('entity_name_length', sql`length(trim(${t.name})) between 1 and 160`),
		check('entity_company_number_format', sql`${t.companyNumber} ~ '^[A-Z0-9]{8}$'`),
		check(
			'entity_year_end_valid',
			sql`(${t.yearEndDay} is null and ${t.yearEndMonth} is null) or (${t.yearEndDay} between 1 and 31 and ${t.yearEndMonth} between 1 and 12)`
		)
	]
);

/**
 * A real person or organisation the firm deals with: directors, shareholders, people
 * with significant control, client contacts. One record per person per firm, linked to
 * each entity by role, so the same director of three companies is one person.
 */
export const people = snakeCase.table(
	'person',
	{
		id: id(),
		firmId: uuid()
			.notNull()
			.references(() => tenants.id, { onDelete: 'restrict' }),
		kind: text().$type<PersonKind>().notNull().default('individual'),
		name: text().notNull(),
		email: text(),
		phone: text(),

		// From Companies House, to recognise the same person on another company's register.
		// The register shows only the month and year of birth.
		birthMonth: smallint(),
		birthYear: smallint(),
		companiesHouseOfficerId: text(),
		createdAt: createdAt()
	},
	(t) => [
		unique('person_firm_id_unique').on(t.firmId, t.id),
		uniqueIndex('person_firm_officer_idx').on(t.firmId, t.companiesHouseOfficerId),
		index('person_firm_name_idx').on(t.firmId, t.name),
		check('person_name_length', sql`length(trim(${t.name})) between 1 and 160`),
		check(
			'person_birth_valid',
			sql`(${t.birthMonth} is null or ${t.birthMonth} between 1 and 12) and (${t.birthYear} is null or ${t.birthYear} between 1900 and 2100)`
		)
	]
);

/**
 * A person's role at an entity over a period (startedOn/endedOn; either may be
 * unknown). A role with no end date, or one in the future, is current.
 */
export const entityRoles = snakeCase.table(
	'entity_role',
	{
		id: id(),
		firmId: uuid().notNull(),
		entityId: uuid().notNull(),
		personId: uuid().notNull(),
		role: text().$type<EntityRoleKind>().notNull(),
		startedOn: date(),
		endedOn: date(),
		/** Shareholders only: the percentage of shares held. */
		shareholdingPercent: numeric({ precision: 5, scale: 2, mode: 'number' }),
		/** People with significant control only: how they control the entity. */
		controls: text()
			.$type<ControlKind>()
			.array()
			.notNull()
			.default(sql`'{}'`),
		/** Where the role came from: entered by hand or imported from Companies House. */
		source: text().$type<'manual' | 'companies_house'>().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		// The same role, held from the same date, is recorded once.
		unique('entity_role_unique')
			.on(t.firmId, t.entityId, t.personId, t.role, t.startedOn)
			.nullsNotDistinct(),
		index('entity_role_person_idx').on(t.firmId, t.personId),
		foreignKey({
			name: 'entity_role_entity_fk',
			columns: [t.firmId, t.entityId],
			foreignColumns: [entities.firmId, entities.id]
		}).onDelete('restrict'),
		foreignKey({
			name: 'entity_role_person_fk',
			columns: [t.firmId, t.personId],
			foreignColumns: [people.firmId, people.id]
		}).onDelete('restrict'),
		check(
			'entity_role_dates_in_order',
			sql`${t.startedOn} is null or ${t.endedOn} is null or ${t.endedOn} >= ${t.startedOn}`
		),
		check(
			'entity_role_shareholding_valid',
			sql`${t.shareholdingPercent} is null or (${t.role} = 'shareholder' and ${t.shareholdingPercent} > 0 and ${t.shareholdingPercent} <= 100)`
		)
	]
);
