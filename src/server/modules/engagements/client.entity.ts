import { sql } from 'drizzle-orm';
import { check, foreignKey, snakeCase, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../../db/columns';
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

/** A legal entity (usually a UK company) belonging to a client. This is what gets audited. */
export const entities = snakeCase.table(
	'entity',
	{
		id: id(),
		firmId: uuid().notNull(),
		clientId: uuid().notNull(),
		name: text().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		unique('entity_firm_id_unique').on(t.firmId, t.id),
		foreignKey({
			name: 'entity_client_fk',
			columns: [t.firmId, t.clientId],
			foreignColumns: [clients.firmId, clients.id]
		}).onDelete('restrict'),
		check('entity_name_length', sql`length(trim(${t.name})) between 1 and 160`)
	]
);
