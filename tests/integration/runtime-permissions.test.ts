import { test, expect } from 'bun:test';
import { sql } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { createTenant } from '../tenants';
import { testConfig } from '../config';
import { createServices } from '../../src/server/services';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';
import { createInvitationService } from '../../src/server/modules/tenancy/invitation.service';
import { createMailService } from '../../src/server/modules/notifications/mail.service';
import { grantRuntimePrivileges } from '../../src/server/db/permissions';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';
import { invitations } from '../../src/server/modules/tenancy/invitation.entity';
import { mailOutbox } from '../../src/server/modules/notifications/mail.entity';

test('restricted runtime role supports app operations but cannot change audit history, schema or ledger', async () => {
	const fixture = await isolatedDatabase(true);
	try {
		const db = fixture.runtimeDb;
		const config = testConfig({
			encryptionKey: Buffer.alloc(32, 4).toString('base64'),
			origin: 'http://localhost:4173'
		});
		const auth = createServices(db, config).identity,
			tenancy = createTenancyService(db);
		const password = 'synthetic restricted role passphrase';
		const owner = await auth.provision(
			{ name: 'Synthetic Owner', email: 'role@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		const login = await auth.login({ email: owner.email, password, address: 'synthetic' });
		expect((await auth.authenticate(login.token))?.user.id).toBe(owner.id);
		const group = await createTenant(db, owner, {
			name: 'Synthetic Group',
			kind: 'group',
			parentId: null
		});
		const firm = await createTenant(db, owner, {
			name: 'Synthetic Firm',
			kind: 'firm',
			parentId: group.id
		});
		expect((await tenancy.get(owner, firm.id)).role).toBe('owner');
		await createInvitationService(db, config).invite(owner, {
			tenantId: firm.id,
			email: 'invite@example.test',
			role: 'member'
		});
		const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		for (const table of [invitations, mailOutbox, auditEvents])
			for (const row of await db.select().from(table)) expect(row.id).toMatch(v7);
		for (const row of [owner, login.session, group, firm]) expect(row.id).toMatch(v7);
		expect(await createMailService(db, config.encryptionKey).deliverNext(async () => {})).toBe(
			true
		);
		await auth.requestReset({ email: owner.email, address: 'synthetic-reset' });
		expect((await db.select().from(auditEvents)).length).toBeGreaterThan(0);
		await auth.logout(login.session.tokenHash);
		expect(await auth.authenticate(login.token)).toBeNull();
		const forbidden = [
			sql`update audit_event set operator_name = 'tampered'`,
			sql`delete from audit_event`,
			sql`truncate audit_event cascade`,
			sql`truncate app_user cascade`,
			sql`create table public.forbidden (id int)`,
			sql`alter table tenant add column forbidden int`,
			sql`alter table audit_event disable trigger all`,
			sql`drop schema public cascade`,
			sql`select * from drizzle.__drizzle_migrations`
		];
		for (const statement of forbidden) {
			try {
				await db.execute(statement);
				throw new Error('Forbidden SQL succeeded');
			} catch (cause) {
				expect((cause as { cause?: { code?: string } }).cause?.code).toBe('42501');
			}
		}
		await expect(
			grantRuntimePrivileges(fixture.db, new URL(process.env.TEST_DATABASE_URL!).username)
		).rejects.toThrow('unprivileged');
	} finally {
		await fixture.close();
	}
}, 20000);
