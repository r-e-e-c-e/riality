import { sql } from 'drizzle-orm';
import {
	bigint,
	check,
	foreignKey,
	index,
	snakeCase,
	text,
	unique,
	uuid
} from 'drizzle-orm/pg-core';
import type { DocumentCategory } from '#lib/documents.js';
import { createdAt, id, timestampTz } from '../../db/columns';
import { entities } from '../clients/client.entity';
import { users } from '../identity/user.entity';

/**
 * A file in an entity's permanent file (articles, shareholder agreements, leases,
 * loan agreements, engagement letters). The file itself is in object storage under
 * `storageKey`; this row describes it. Removing a document keeps the row and the file
 * (removedAt), so the history stays complete.
 */
export const documents = snakeCase.table(
	'document',
	{
		id: id(),
		firmId: uuid().notNull(),
		entityId: uuid().notNull(),
		category: text().$type<DocumentCategory>().notNull(),
		title: text().notNull(),
		/** The uploaded file's name, shown when downloading. */
		fileName: text().notNull(),
		contentType: text().notNull(),
		sizeBytes: bigint({ mode: 'number' }).notNull(),
		/** SHA-256 of the contents, to prove the file has not changed. */
		sha256: text().notNull(),
		storageKey: text().notNull().unique(),
		uploadedBy: uuid()
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		createdAt: createdAt(),
		removedAt: timestampTz(),
		removedBy: uuid().references(() => users.id, { onDelete: 'restrict' })
	},
	(t) => [
		unique('document_firm_id_unique').on(t.firmId, t.id),
		index('document_entity_idx').on(t.firmId, t.entityId),
		foreignKey({
			name: 'document_entity_fk',
			columns: [t.firmId, t.entityId],
			foreignColumns: [entities.firmId, entities.id]
		}).onDelete('restrict'),
		check('document_title_length', sql`length(trim(${t.title})) between 1 and 200`),
		check('document_size_positive', sql`${t.sizeBytes} > 0`),
		check('document_removed_complete', sql`(${t.removedAt} is null) = (${t.removedBy} is null)`)
	]
);
