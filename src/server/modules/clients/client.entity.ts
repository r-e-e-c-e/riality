import { sql } from 'drizzle-orm';
import {
	check,
	date,
	foreignKey,
	smallint,
	snakeCase,
	text,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import type { AccountingFramework, CompanyStatus, EntityType, SizeClass } from '#lib/companies.js';
import { createdAt, id, timestampTz } from '../../db/columns';
import { tenants } from '../tenancy/tenant.entity';

// Every firm-owned table has a firmId and a unique (firmId, id) pair. Child tables
// reference that pair, so the database itself refuses links between two firms'
// records (for example an entity in firm A pointing at a client in firm B).

/** A client relationship of the firm, for example a family business with several companies. */
export const clients = snakeCase.table(
	'client',
	{
		id: id(),
		firmId: uuid()
			.notNull()
			.references(() => tenants.id, { onDelete: 'restrict' }),
		name: text().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('client_firm_id_unique').on(t.firmId, t.id),
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
