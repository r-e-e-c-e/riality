import { expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { testConfig } from '../config';
import { createTenant } from '../tenants';
import type { FileStorage } from '../../src/server/integrations/storage';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';
import { createClientsService } from '../../src/server/modules/clients/clients.service';
import { createDocumentsService } from '../../src/server/modules/documents/documents.service';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';
import { users } from '../../src/server/modules/identity/user.entity';

/** Storage kept in memory, so tests never touch MinIO or R2. */
function memoryStorage() {
	const files = new Map<string, Uint8Array>();
	const storage: FileStorage = {
		put: async (key, bytes) => void files.set(key, bytes),
		open: async (key) => (files.has(key) ? new Blob([files.get(key)!.slice()]).stream() : null)
	};
	return { files, storage };
}

const pdf = (text: string) => new File([`%PDF-1.4\n${text}`], 'Articles of association.pdf');

test('documents: checked uploads, downloads for those who can see the entity, audited removal', async () => {
	const f = await isolatedDatabase();
	try {
		const [owner, member] = await f.db
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
		const firm = await createTenant(f.db, owner, { name: 'Firm', kind: 'firm', parentId: null });
		await createTenancyService(f.db).setMembership(owner, {
			tenantId: firm.id,
			userId: member.id,
			role: 'member'
		});
		const clients = createClientsService(f.db, testConfig(), null);
		const client = await clients.createClient(owner, { firmId: firm.id, name: 'Client' });
		const entity = await clients.createEntity(owner, {
			firmId: firm.id,
			clientId: client.id,
			name: 'Synthetic Ltd'
		});
		const { files, storage } = memoryStorage();
		const service = createDocumentsService(f.db, testConfig(), storage);
		const scope = { firmId: firm.id, entityId: entity.id };

		const document = await service.upload(owner, {
			...scope,
			category: 'constitution',
			file: pdf('synthetic articles')
		});
		expect(document).toMatchObject({
			title: 'Articles of association',
			fileName: 'Articles of association.pdf',
			contentType: 'application/pdf'
		});
		// The storage key is made by the app, never from the file name.
		expect(document.storageKey).toBe(`firms/${firm.id}/entities/${entity.id}/${document.id}`);
		expect(files.has(document.storageKey)).toBe(true);

		const opened = await service.open(owner, { firmId: firm.id, documentId: document.id });
		expect(await new Response(opened.contents).text()).toBe('%PDF-1.4\nsynthetic articles');

		// A renamed file must really be what its extension says.
		await expect(
			service.upload(owner, {
				...scope,
				category: 'other',
				file: new File(['<script>alert(1)</script>'], 'invoice.pdf')
			})
		).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_NOT_ALLOWED' });
		await expect(
			service.upload(owner, {
				...scope,
				category: 'other',
				file: new File(['MZ synthetic program'], 'tool.exe')
			})
		).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_NOT_ALLOWED' });

		// Members without an engagement for the entity can't see, download or add documents.
		const documentScope = { firmId: firm.id, documentId: document.id };
		await expect(service.listForEntity(member, scope)).rejects.toMatchObject({ status: 404 });
		await expect(service.open(member, documentScope)).rejects.toMatchObject({ status: 404 });
		await expect(
			service.upload(member, { ...scope, category: 'other', file: pdf('x') })
		).rejects.toMatchObject({ status: 404 });
		await expect(service.remove(member, documentScope)).rejects.toMatchObject({ status: 403 });

		// Removing keeps the file and the record, and is audited.
		await service.remove(owner, documentScope);
		expect(await service.listForEntity(owner, scope)).toEqual([]);
		await expect(service.open(owner, documentScope)).rejects.toMatchObject({ status: 404 });
		expect(files.has(document.storageKey)).toBe(true);
		const events = await f.db
			.select({ action: auditEvents.action, details: auditEvents.details })
			.from(auditEvents)
			.where(eq(auditEvents.targetId, entity.id));
		expect(events.map((event) => event.action)).toEqual(
			expect.arrayContaining(['document.uploaded', 'document.removed'])
		);

		// Without storage, uploads are turned off.
		await expect(
			createDocumentsService(f.db, testConfig(), null).upload(owner, {
				...scope,
				category: 'other',
				file: pdf('x')
			})
		).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
	} finally {
		await f.close();
	}
});
