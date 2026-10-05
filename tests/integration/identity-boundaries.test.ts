import { test, expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { createTenant } from '../tenants';
import { testConfig } from '../config';
import { createServices } from '../../src/server/services';
import { createInvitationService } from '../../src/server/modules/tenancy/invitation.service';
import { createMailService } from '../../src/server/modules/notifications/mail.service';
import { createSecretBox } from '../../src/server/modules/identity/identity.crypto';
import { totp } from '../../src/server/modules/identity/totp';
import { mfaCredentials, recoveryCodes } from '../../src/server/modules/identity/mfa.entity';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';

const config = testConfig({
	encryptionKey: Buffer.alloc(32, 8).toString('base64'),
	origin: 'http://localhost:4173'
});
const password = 'synthetic identity boundary passphrase';

test('MFA disablement requires a live session and both factors in the service transaction', async () => {
	const f = await isolatedDatabase();
	try {
		const { identity: auth, mfa } = createServices(f.db, config);
		const user = await auth.provision(
			{ name: 'Synthetic MFA', email: 'mfa@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		await mfa.begin(user.id);
		const [credential] = await f.db
			.select()
			.from(mfaCredentials)
			.where(eq(mfaCredentials.userId, user.id));
		const secret = Buffer.from(
			await createSecretBox(config.encryptionKey).decrypt(
				credential.encryptedSecret,
				`mfa:${user.id}`
			),
			'base64'
		);
		const codes = await mfa.confirm(user.id, await totp(secret, Math.floor(Date.now() / 30000)));
		const login = await auth.login({
			email: user.email,
			password,
			code: codes[0],
			address: 'synthetic'
		});
		await expect(
			mfa.disable(user.id, login.session.tokenHash, 'wrong', codes[1])
		).rejects.toMatchObject({ status: 401 });
		await expect(
			mfa.disable(user.id, login.session.tokenHash, password, 'invalid')
		).rejects.toMatchObject({ status: 401 });
		await auth.logout(login.session.tokenHash);
		await expect(
			mfa.disable(user.id, login.session.tokenHash, password, codes[1])
		).rejects.toMatchObject({ status: 401 });
		expect(await f.db.select().from(recoveryCodes)).toHaveLength(9);
		const fresh = await auth.login({
			email: user.email,
			password,
			code: codes[2],
			address: 'synthetic'
		});
		await expect(
			createServices(f.db, { ...config, requireMfa: true }).mfa.disable(
				user.id,
				fresh.session.tokenHash,
				password,
				codes[1]
			)
		).rejects.toMatchObject({ status: 403 });
		await mfa.disable(user.id, fresh.session.tokenHash, password, codes[1]);
		expect(await auth.authenticate(fresh.token)).toBeNull();
		expect(await f.db.select().from(mfaCredentials)).toHaveLength(0);
		expect(await f.db.select().from(recoveryCodes)).toHaveLength(0);
		expect(
			await f.db.select().from(auditEvents).where(eq(auditEvents.action, 'mfa.disabled'))
		).toHaveLength(1);
	} finally {
		await f.close();
	}
}, 20000);

test('invitation history retains references and keyed recipient fingerprints after deletion', async () => {
	const f = await isolatedDatabase();
	try {
		const auth = createServices(f.db, config).identity;
		const owner = await auth.provision(
			{ name: 'Synthetic Owner', email: 'owner@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		const recipient = await auth.provision(
			{ name: 'Synthetic Recipient', email: 'recipient@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		const firm = await createTenant(f.db, owner, {
			name: 'Synthetic Firm',
			kind: 'firm',
			parentId: null
		});
		const invitations = createInvitationService(f.db, config);
		const first = await invitations.invite(owner, {
			tenantId: firm.id,
			email: recipient.email,
			role: 'member'
		});
		await invitations.revoke(owner, firm.id, first.id);
		const second = await invitations.invite(owner, {
			tenantId: firm.id,
			email: recipient.email,
			role: 'member'
		});
		let token = '';
		const mail = createMailService(f.db, config.encryptionKey);
		while (
			await mail.deliverNext(async (message) => {
				token = message.text.match(/#([A-Za-z0-9_-]{43})/)![1];
			})
		) {
			/* Drain synthetic messages; last belongs to the live invitation. */
		}
		await invitations.accept(recipient, token);
		const events = await f.db.select().from(auditEvents);
		const fingerprint = await createSecretBox(config.encryptionKey).fingerprint(
			`invitation-recipient:${recipient.email}`
		);
		const rows = events.filter((event) => event.action.startsWith('invitation.'));
		expect(rows).toHaveLength(4);
		for (const row of rows) expect(row.details.recipientFingerprint).toBe(fingerprint);
		expect(rows.find((row) => row.action === 'invitation.revoked')?.targetId).toBe(first.id);
		expect(rows.find((row) => row.action === 'invitation.accepted')).toMatchObject({
			targetType: 'invitation',
			targetId: second.id,
			subjectUserId: recipient.id
		});
		expect(JSON.stringify(rows)).not.toContain(recipient.email);
		expect(JSON.stringify(rows)).not.toContain(token);
	} finally {
		await f.close();
	}
}, 20000);
