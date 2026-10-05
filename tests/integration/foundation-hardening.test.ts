import { test, expect } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { isolatedDatabase } from '../isolated-database';
import { createTenant } from '../tenants';
import { testConfig } from '../config';
import { createServices } from '../../src/server/services';
import { createIdentityAdministrationService } from '../../src/server/modules/identity/identity-administration.service';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';
import { createInvitationService } from '../../src/server/modules/tenancy/invitation.service';
import { createMailService } from '../../src/server/modules/notifications/mail.service';
import { createSecretBox } from '../../src/server/modules/identity/identity.crypto';
import { totp } from '../../src/server/modules/identity/totp';
import { sessions } from '../../src/server/modules/identity/session.entity';
import { credentialTokens } from '../../src/server/modules/identity/credential-token.entity';
import { invitations } from '../../src/server/modules/tenancy/invitation.entity';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';
import { mfaCredentials, recoveryCodes } from '../../src/server/modules/identity/mfa.entity';
import { mailOutbox } from '../../src/server/modules/notifications/mail.entity';
import { resetDevelopmentDatabase } from '../../src/server/db/development-reset';
import { createPasswordPolicy } from '../../src/server/modules/identity/passwords';
import { loggedWarnings, securityEvents } from '../setup';

const password = 'synthetic hardening passphrase';
const config = testConfig({
	encryptionKey: Buffer.alloc(32, 6).toString('base64'),
	origin: 'http://localhost:4173'
});

test('password screening outages preserve reset credentials, passwords and sessions while recording sanitized failures', async () => {
	const fixture = await isolatedDatabase();
	try {
		const auth = createServices(fixture.db, config).identity;
		const user = await auth.provision(
			{ name: 'Synthetic Policy', email: 'policy@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		const login = await auth.login({ email: user.email, password, address: 'synthetic' });
		await auth.requestReset({ email: user.email, address: 'synthetic' });
		let token = '';
		await createMailService(fixture.db, config.encryptionKey).deliverNext(async (mail) => {
			token = mail.text.match(/#([A-Za-z0-9_-]{43})/)![1];
		});
		// The real breach check, with the provider down.
		const unavailable = createServices(fixture.db, config, {
			passwordCheck: createPasswordPolicy(true, async () => {
				throw new Error('Synthetic provider outage');
			})
		}).identity;
		loggedWarnings.mockClear();
		await expect(
			unavailable.resetPassword({
				token,
				password: 'synthetic replacement passphrase',
				address: 'synthetic'
			})
		).rejects.toMatchObject({ status: 503 });
		expect(await fixture.db.select().from(credentialTokens)).toHaveLength(1);
		expect(await auth.authenticate(login.token)).not.toBeNull();
		await expect(
			auth.login({ email: user.email, password: 'incorrect', address: 'synthetic' })
		).rejects.toThrow();
		expect(securityEvents().map((event) => event.event)).toEqual([
			'password.check_unavailable',
			'authentication.failed'
		]);
		await auth.resetPassword({
			token,
			password: 'synthetic replacement passphrase',
			address: 'synthetic'
		});
		expect(await auth.authenticate(login.token)).toBeNull();
	} finally {
		await fixture.close();
	}
}, 20000);

test('offboarding protects sole owners; incident containment revokes all access and remains attributable', async () => {
	const fixture = await isolatedDatabase();
	try {
		const auth = createServices(fixture.db, config).identity,
			tenancy = createTenancyService(fixture.db);
		const owner = await auth.provision(
			{ name: 'Synthetic Owner', email: 'disable@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		const firm = await createTenant(fixture.db, owner, {
			name: 'Synthetic Firm',
			kind: 'firm',
			parentId: null
		});
		const login = await auth.login({ email: owner.email, password, address: 'synthetic' });
		await auth.requestReset({ email: owner.email, address: 'synthetic-reset' });
		await createInvitationService(fixture.db, config).invite(owner, {
			tenantId: firm.id,
			email: 'invite@example.test',
			role: 'member'
		});
		const admin = createIdentityAdministrationService(fixture.db);
		await expect(
			admin.disableUser(owner.id, { name: 'Synthetic Operator' }, 'offboarding')
		).rejects.toThrow('ownership');
		expect(await auth.authenticate(login.token)).not.toBeNull();
		const result = await admin.disableUser(
			owner.id,
			{ name: 'Synthetic Operator' },
			'security_incident'
		);
		expect(result.tenantsRequiringOwner).toEqual([firm.id]);
		expect(await auth.authenticate(login.token)).toBeNull();
		expect(await fixture.db.select().from(sessions)).toHaveLength(0);
		expect(await fixture.db.select().from(credentialTokens)).toHaveLength(0);
		expect(await fixture.db.select().from(invitations)).toHaveLength(0);
		const [event] = await fixture.db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.action, 'user.disabled'));
		expect(event).toMatchObject({
			operatorName: 'Synthetic Operator',
			subjectUserId: owner.id,
			actorId: null,
			details: { reason: 'security_incident', tenantsWithoutOwner: [firm.id] }
		});
		await expect(tenancy.get(owner, firm.id)).rejects.toThrow('not found');
	} finally {
		await fixture.close();
	}
}, 20000);

test('recovery regeneration requires a live session and both factors, invalidates old codes and revokes sessions', async () => {
	const fixture = await isolatedDatabase();
	try {
		const { identity: auth, mfa } = createServices(fixture.db, config);
		const user = await auth.provision(
			{ name: 'Synthetic MFA', email: 'regenerate@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		await mfa.begin(user.id);
		const [credential] = await fixture.db.select().from(mfaCredentials);
		const secret = Buffer.from(
			await createSecretBox(config.encryptionKey).decrypt(
				credential.encryptedSecret,
				`mfa:${user.id}`
			),
			'base64'
		);
		const oldCodes = await mfa.confirm(user.id, await totp(secret, Math.floor(Date.now() / 30000)));
		const login = await auth.login({
			email: user.email,
			password,
			code: oldCodes[0],
			address: 'synthetic'
		});
		await expect(
			mfa.replaceRecoveryCodes(user.id, login.session.tokenHash, 'incorrect password', oldCodes[1])
		).rejects.toThrow();
		await expect(
			mfa.replaceRecoveryCodes(user.id, 'revoked-session', password, oldCodes[1])
		).rejects.toThrow();
		const codes = await mfa.replaceRecoveryCodes(
			user.id,
			login.session.tokenHash,
			password,
			oldCodes[1]
		);
		expect(codes).toHaveLength(10);
		expect(await auth.authenticate(login.token)).toBeNull();
		await expect(
			auth.login({ email: user.email, password, code: oldCodes[2], address: 'synthetic' })
		).rejects.toThrow();
		expect(
			(await auth.login({ email: user.email, password, code: codes[0], address: 'synthetic' })).user
				.mfaEnabled
		).toBe(true);
	} finally {
		await fixture.close();
	}
}, 20000);

test('operator MFA reset removes the authenticator, signs the user out and is attributed', async () => {
	const fixture = await isolatedDatabase();
	try {
		const { identity: auth, mfa, administration } = createServices(fixture.db, config);
		const user = await auth.provision(
			{ name: 'Synthetic Lost Phone', email: 'lost@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		await expect(
			administration.resetMfa(user.email, { name: 'Synthetic Operator' })
		).rejects.toMatchObject({ status: 409 });
		await mfa.begin(user.id);
		const [credential] = await fixture.db.select().from(mfaCredentials);
		const secret = Buffer.from(
			await createSecretBox(config.encryptionKey).decrypt(
				credential.encryptedSecret,
				`mfa:${user.id}`
			),
			'base64'
		);
		const codes = await mfa.confirm(user.id, await totp(secret, Math.floor(Date.now() / 30000)));
		const login = await auth.login({ email: user.email, password, code: codes[0], address: 'a' });

		await administration.resetMfa(' LOST@example.test ', { name: 'Synthetic Operator' });

		expect(await auth.authenticate(login.token)).toBeNull();
		expect(await fixture.db.select().from(mfaCredentials)).toHaveLength(0);
		expect(await fixture.db.select().from(recoveryCodes)).toHaveLength(0);
		const signedIn = await auth.login({ email: user.email, password, address: 'a' });
		expect(signedIn.user.mfaEnabled).toBe(false);
		const [event] = await fixture.db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.action, 'mfa.reset'));
		expect(event).toMatchObject({
			operatorName: 'Synthetic Operator',
			actorId: null,
			subjectUserId: user.id,
			details: { reason: 'lost_authenticator' }
		});
	} finally {
		await fixture.close();
	}
}, 20000);

test('key rotation preserves decryptable MFA/mail and rolls back all replacements if any old ciphertext fails', async () => {
	const fixture = await isolatedDatabase();
	try {
		const { identity: auth, mfa } = createServices(fixture.db, config);
		const user = await auth.provision(
			{ name: 'Synthetic Key', email: 'key@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		await mfa.begin(user.id);
		await auth.requestReset({ email: user.email, address: 'synthetic' });
		const admin = createIdentityAdministrationService(fixture.db),
			nextKey = Buffer.alloc(32, 7).toString('base64');
		const [old] = await fixture.db.select().from(mfaCredentials);
		const secret = await createSecretBox(config.encryptionKey).decrypt(
			old.encryptedSecret,
			`mfa:${user.id}`
		);
		await fixture.db.update(mailOutbox).set({ encryptedMessage: 'corrupt' });
		await expect(
			admin.rotateEncryptionKey(config.encryptionKey, nextKey, { name: 'Synthetic Operator' })
		).rejects.toThrow();
		expect((await fixture.db.select().from(mfaCredentials))[0].encryptedSecret).toBe(
			old.encryptedSecret
		);
		await fixture.db.delete(mailOutbox);
		await auth.requestReset({ email: user.email, address: 'synthetic-other' });
		expect(
			await admin.rotateEncryptionKey(config.encryptionKey, nextKey, { name: 'Synthetic Operator' })
		).toEqual({ mfaCredentials: 1, queuedEmails: 1 });
		const [rotated] = await fixture.db.select().from(mfaCredentials);
		expect(await createSecretBox(nextKey).decrypt(rotated.encryptedSecret, `mfa:${user.id}`)).toBe(
			secret
		);
		await expect(
			createSecretBox(config.encryptionKey).decrypt(rotated.encryptedSecret, `mfa:${user.id}`)
		).rejects.toThrow();
		expect(
			await createMailService(fixture.db, nextKey).deliverNext(async (mail) => {
				expect(mail.to).toBe(user.email);
			})
		).toBe(true);
	} finally {
		await fixture.close();
	}
}, 20000);

test('development reset can be repeated, preserves history files and restores security guards', async () => {
	const fixture = await isolatedDatabase();
	try {
		const auth = createServices(fixture.db, config).identity;
		await auth.provision(
			{ name: 'Synthetic Reset', email: 'reset@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		await resetDevelopmentDatabase(fixture.ownerUrl, {});
		await resetDevelopmentDatabase(fixture.ownerUrl, {});
		expect(
			(await fixture.db.execute(sql`select count(*)::int as count from app_user`))[0].count
		).toBe(0);
		const restored = createServices(fixture.db, config).identity;
		await restored.provision(
			{ name: 'Synthetic Restored', email: 'restored@example.test', password },
			{ name: 'Synthetic Operator' }
		);
		await expect(
			Promise.resolve(fixture.db.execute(sql`delete from audit_event`))
		).rejects.toThrow();
		const [guards] = await fixture.db.execute(
			sql`select count(*)::int as count from pg_trigger where not tgisinternal and tgrelid in ('tenant'::regclass, 'audit_event'::regclass)`
		);
		expect(guards.count).toBeGreaterThanOrEqual(2);
	} finally {
		await fixture.close();
	}
}, 20000);
