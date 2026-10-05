import { sql } from 'drizzle-orm';
import { check, date, foreignKey, snakeCase, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../../db/columns';
import { entities } from '../clients/client.entity';

/** The financial period being audited for one entity, for example 1 Jan to 31 Dec 2025. */
export const reportingPeriods = snakeCase.table(
	'reporting_period',
	{
		id: id(),
		firmId: uuid().notNull(),
		entityId: uuid().notNull(),
		startsOn: date().notNull(),
		endsOn: date().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('period_firm_id_unique').on(t.firmId, t.id),
		unique('period_entity_dates_unique').on(t.firmId, t.entityId, t.startsOn, t.endsOn),
		foreignKey({
			name: 'period_entity_fk',
			columns: [t.firmId, t.entityId],
			foreignColumns: [entities.firmId, entities.id]
		}).onDelete('restrict'),
		check('period_dates_ordered', sql`${t.startsOn} <= ${t.endsOn}`)
	]
);
