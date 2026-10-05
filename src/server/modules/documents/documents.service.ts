import { and, asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Config } from '../../config';
import type { Database } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError, notFound } from '../../errors';
import type { FileStorage } from '../../integrations/storage';
import {
	DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
	documentTypeOf,
	type DocumentType
} from '#lib/documents.js';
import { entityScopeSchema } from '#lib/schemas/clients.js';
import { documentScopeSchema, uploadDocumentSchema } from '#lib/schemas/documents.js';
import { recordEvent } from '../audit/audit-event.service';
import { requireEntityViewer } from '../clients/entity-access';
import { users } from '../identity/user.entity';
import { RATE_LIMITS, createRateLimiter } from '../identity/rate-limit.service';
import { requireFirmAdmin, type Actor } from '../tenancy/tenancy-access';
import { documents } from './document.entity';

/** The first bytes ("magic numbers") each kind of file starts with. */
const SIGNATURES = {
	pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
	png: [0x89, 0x50, 0x4e, 0x47],
	jpeg: [0xff, 0xd8, 0xff],
	zip: [0x50, 0x4b, 0x03, 0x04], // .docx and .xlsx are zip files
	ole: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] // .doc, .xls and .msg
};

const startsWith = (bytes: Uint8Array, signature: number[]) =>
	signature.every((byte, index) => bytes[index] === byte);

/**
 * True if the file's contents match its extension, so a renamed program or web page
 * can't pass as a PDF. CSV has no signature: it must be text (no zero bytes).
 */
function contentMatchesType(type: DocumentType, bytes: Uint8Array) {
	switch (type) {
		case 'pdf':
			return startsWith(bytes, SIGNATURES.pdf);
		case 'png':
			return startsWith(bytes, SIGNATURES.png);
		case 'jpg':
		case 'jpeg':
			return startsWith(bytes, SIGNATURES.jpeg);
		case 'docx':
		case 'xlsx':
			return startsWith(bytes, SIGNATURES.zip);
		case 'doc':
		case 'xls':
		case 'msg':
			return startsWith(bytes, SIGNATURES.ole);
		case 'csv':
			return !bytes.subarray(0, 8192).includes(0);
	}
}

/** The file name without any folder part or control characters. */
function cleanFileName(name: string) {
	const base = name.split(/[\\/]/).pop() ?? '';
	// eslint-disable-next-line no-control-regex
	return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(-200) || 'document';
}

/**
 * Documents in entities' permanent files. Anyone who can see the entity (owners,
 * admins, and members on one of its engagements) can list, download and upload;
 * owners and admins can remove. Files live in object storage (`storage`, null when it
 * is not configured); rows here describe them.
 */
export function createDocumentsService(
	db: Database,
	config: Pick<Config, 'encryptionKey'>,
	storage: FileStorage | null
) {
	const limiter = createRateLimiter(db, config.encryptionKey);

	function requireStorage() {
		if (!storage) throw new BusinessError('STORAGE_NOT_CONFIGURED');
		return storage;
	}

	return {
		/** The entity's current documents, by category then title. */
		async listForEntity(actor: Actor, input: z.infer<typeof entityScopeSchema>) {
			const scope = entityScopeSchema.parse(input);
			await requireEntityViewer(db, actor, scope);
			return db
				.select({
					id: documents.id,
					category: documents.category,
					title: documents.title,
					fileName: documents.fileName,
					contentType: documents.contentType,
					sizeBytes: documents.sizeBytes,
					uploadedAt: documents.createdAt,
					uploadedBy: users.name
				})
				.from(documents)
				.innerJoin(users, eq(users.id, documents.uploadedBy))
				.where(
					and(
						eq(documents.firmId, scope.firmId),
						eq(documents.entityId, scope.entityId),
						isNull(documents.removedAt)
					)
				)
				.orderBy(asc(documents.category), asc(documents.title), asc(documents.id));
		},

		/**
		 * Checks and stores an uploaded file, then records it. The file goes to storage
		 * first: if saving the row then fails, an unused file is left behind, which is
		 * harmless; the reverse would leave a row pointing at nothing.
		 */
		async upload(actor: Actor, input: z.input<typeof uploadDocumentSchema>) {
			const { firmId, entityId, category, title, file } = uploadDocumentSchema.parse(input);
			await requireEntityViewer(db, actor, { firmId, entityId });
			const files = requireStorage();
			await limiter.consume(RATE_LIMITS.documentUploadsPerUser, actor.id);

			const fileName = cleanFileName(file.name);
			const type = documentTypeOf(fileName);
			const bytes = new Uint8Array(await file.arrayBuffer());
			if (bytes.length > MAX_DOCUMENT_BYTES) throw new BusinessError('DOCUMENT_TOO_LARGE');
			if (!type || !contentMatchesType(type, bytes))
				throw new BusinessError('DOCUMENT_TYPE_NOT_ALLOWED');

			const { contentType } = DOCUMENT_TYPES[type];
			const id = Bun.randomUUIDv7();
			const storageKey = `firms/${firmId}/entities/${entityId}/${id}`;
			await files.put(storageKey, bytes, contentType);

			return inTransaction(db, async (tx) => {
				await requireEntityViewer(tx, actor, { firmId, entityId });
				const [document] = await tx
					.insert(documents)
					.values({
						id,
						firmId,
						entityId,
						category,
						title: title ?? fileName.replace(/\.[^.]+$/, ''),
						fileName,
						contentType,
						sizeBytes: bytes.length,
						sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
						storageKey,
						uploadedBy: actor.id
					})
					.returning();
				await recordEvent(tx, {
					action: 'document.uploaded',
					actorId: actor.id,
					tenantId: firmId,
					target: { type: 'entity', id: entityId },
					details: { documentId: id, category, sizeBytes: bytes.length }
				});
				return document;
			});
		},

		/** Removes a document from the permanent file. The file is kept. Owners and admins. */
		async remove(actor: Actor, input: z.infer<typeof documentScopeSchema>) {
			const { firmId, documentId } = documentScopeSchema.parse(input);
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, firmId);
				const [removed] = await tx
					.update(documents)
					.set({ removedAt: new Date(), removedBy: actor.id })
					.where(
						and(
							eq(documents.firmId, firmId),
							eq(documents.id, documentId),
							isNull(documents.removedAt)
						)
					)
					.returning();
				if (!removed) throw notFound('Document');
				await recordEvent(tx, {
					action: 'document.removed',
					actorId: actor.id,
					tenantId: firmId,
					target: { type: 'entity', id: removed.entityId },
					details: { documentId }
				});
				return removed;
			});
		},

		/** A current document and its contents, for downloading. Same access as the entity. */
		async open(actor: Actor, input: z.infer<typeof documentScopeSchema>) {
			const { firmId, documentId } = documentScopeSchema.parse(input);
			const [document] = await db
				.select()
				.from(documents)
				.where(
					and(
						eq(documents.firmId, firmId),
						eq(documents.id, documentId),
						isNull(documents.removedAt)
					)
				);
			if (!document) throw notFound('Document');
			await requireEntityViewer(db, actor, { firmId, entityId: document.entityId });
			const contents = await requireStorage().open(document.storageKey);
			if (!contents) throw notFound('Document');
			return { document, contents };
		}
	};
}
