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
import type { ControlKind, EntityRoleKind, PersonKind } from '#lib/people.js';
import { createdAt, id } from '../../db/columns';
import { tenants } from '../tenancy/tenant.entity';
import { entities } from './client.entity';

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
