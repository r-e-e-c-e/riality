import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { openTestDatabase } from '../database';
import type { AuthUser } from '../../src/server/modules/identity/identity.service';
import { createServices } from '../../src/server/services';
import { testConfig } from '../config';
import { createTenant, testOperator } from '../tenants';
import { runWithRequestContext } from '../../src/server/request-context';
import { inTransaction } from '../../src/server/db/transaction';
import { loggedWarnings, securityEvents } from '../setup';
import { createTenancyService } from '../../src/server/modules/tenancy/tenancy.service';
import { auditEvents } from '../../src/server/modules/audit/audit-event.entity';
import { memberships } from '../../src/server/modules/tenancy/membership.entity';
import { sessions } from '../../src/server/modules/identity/session.entity';
import { tenants } from '../../src/server/modules/tenancy/tenant.entity';
import { users } from '../../src/server/modules/identity/user.entity';
import { createMailService, type Mail } from '../../src/server/modules/notifications/mail.service';
import { createInvitationService } from '../../src/server/modules/tenancy/invitation.service';
import { credentialTokens } from '../../src/server/modules/identity/credential-token.entity';
import { mfaCredentials, recoveryCodes } from '../../src/server/modules/identity/mfa.entity';
import { mailOutbox } from '../../src/server/modules/notifications/mail.entity';
import { invitations } from '../../src/server/modules/tenancy/invitation.entity';
import { createSecretBox, hashToken } from '../../src/server/modules/identity/identity.crypto';
import { hashPassword } from '../../src/server/modules/identity/passwords';
import { encodeBase32, totp } from '../../src/server/modules/identity/totp';

const { db, close } = openTestDatabase();
const config = testConfig({
	encryptionKey: Buffer.alloc(32, 1).toString('base64'),
	origin: 'http://localhost:4173'
});
const { identity: auth, mfa } = createServices(db, config);
const tenancy = createTenancyService(db);
const password = 'synthetic test passphrase';
let owner: Pick<AuthUser, 'id' | 'name' | 'email'>;
let outsider: Pick<AuthUser, 'id' | 'name' | 'email'>;
let sharedHash: string;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: './drizzle' });
	sharedHash = await hashPassword(password);
});
beforeEach(async () => {
	// Explicitly disposable test DB only. No application path truncates audit history.
	await db.execute(
		sql`truncate audit_event, tenant_membership, auth_session, rate_limit, tenant, app_user, credential_token, mfa_credential, mfa_recovery_code, tenant_invitation, mail_outbox cascade`
	);
	[owner, outsider] = await db
		.insert(users)
		.values([
			{
				name: 'Synthetic Owner',
				email: 'owner@example.test',
				passwordHash: sharedHash,
				emailVerifiedAt: new Date()
			},
			{
				name: 'Synthetic Outsider',
				email: 'outsider@example.test',
				passwordHash: sharedHash,
				emailVerifiedAt: new Date()
			}
		])
		.returning({ id: users.id, name: users.name, email: users.email });
});
afterAll(close);

function create(name: string, kind: 'group' | 'firm' = 'firm', parentId: string | null = null) {
	return createTenant(db, owner, { name, kind, parentId });
}
const { tenancyAdministration } = createServices(db, config);
const move = (tenant: string, parent: string | null) =>
	tenancyAdministration.moveTenant({ tenant, parent }, testOperator);

describe('authentication', () => {
	test('provisions normalized accounts with Argon2id and an attributable event', async () => {
		const operator = { name: 'Synthetic Operator' };
		const user = await auth.provision(
			{ name: 'New User', email: ' NEW@example.test ', password },
			operator
		);
		const [stored] = await db.select().from(users).where(eq(users.id, user.id));
		expect(stored.email).toBe('new@example.test');
		expect(stored.passwordHash).toStartWith('$argon2id$');
		expect(stored.passwordHash).not.toBe(password);
		const [event] = await db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.subjectUserId, user.id));
		expect(event).toMatchObject({ actorId: null, operatorName: operator.name });
		await expect(
			auth.provision({ name: 'Duplicate', email: 'new@example.test', password }, operator)
		).rejects.toMatchObject({ status: 409 });
		await expect(
			auth.provision({ name: 'Weak', email: 'weak@example.test', password: 'short' }, operator)
		).rejects.toThrow('15 characters');
	});
	test('stores only token hashes, authenticates across service instances and revokes immediately', async () => {
		const login = await auth.login({
			email: owner.email.toUpperCase(),
			password,
			address: 'test-a'
		});
		const [stored] = await db.select().from(sessions);
		expect(stored.tokenHash).toBe(await hashToken(login.token));
		expect(stored.tokenHash).not.toBe(login.token);
		expect((await createServices(db, config).identity.authenticate(login.token))?.user.id).toBe(
			owner.id
		);
		await auth.logout(login.session.tokenHash);
		expect(await auth.authenticate(login.token)).toBeNull();
		expect(await auth.authenticate('malformed')).toBeNull();
	});
	test('expires sessions and blocks disabled accounts', async () => {
		const login = await auth.login({ email: owner.email, password, address: 'test-a' });
		await db.update(sessions).set({ expiresAt: new Date(0) });
		expect(await auth.authenticate(login.token)).toBeNull();
		const second = await auth.login({ email: owner.email, password, address: 'test-a' });
		await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, owner.id));
		expect(await auth.authenticate(second.token)).toBeNull();
		await expect(
			auth.login({ email: owner.email, password, address: 'test-a' })
		).rejects.toMatchObject({ status: 401 });
	});
	test('uses generic credential errors for unknown emails and incorrect passwords', async () => {
		for (const email of [owner.email, 'missing@example.test']) {
			await expect(
				auth.login({ email, password: 'wrong password', address: 'test-a' })
			).rejects.toMatchObject({
				status: 401,
				message: 'Email, password or security code is incorrect'
			});
		}
	});
	test('replaces an existing browser session at login', async () => {
		const first = await auth.login({ email: owner.email, password, address: 'test-a' });
		const second = await auth.login({
			email: owner.email,
			password,
			address: 'test-a',
			previousToken: first.token
		});
		expect(first.token).not.toBe(second.token);
		expect(await auth.authenticate(first.token)).toBeNull();
		expect(await auth.authenticate(second.token)).not.toBeNull();
	});
	test('limits reset emails per email and per address across service instances', async () => {
		const attempts = await Promise.allSettled(
			Array.from({ length: 12 }, (_, i) =>
				createServices(db, config).identity.requestReset({
					email: 'missing@example.test',
					address: `test-${i}`
				})
			)
		);
		const throttled = attempts.filter(
			(result) => result.status === 'rejected' && result.reason.status === 429
		);
		expect(throttled).toHaveLength(9);
		// Distinct emails cannot bypass the address limit.
		await db.execute(sql`truncate rate_limit`);
		const addresses = await Promise.allSettled(
			Array.from({ length: 102 }, (_, i) =>
				auth.requestReset({ email: `missing-${i}@example.test`, address: 'shared-address' })
			)
		);
		expect(
			addresses.filter((result) => result.status === 'rejected' && result.reason.status === 429)
		).toHaveLength(2);
	});
	test('security events use fingerprints, never raw emails, addresses or passwords', async () => {
		loggedWarnings.mockClear();
		await expect(
			auth.login({ email: owner.email, password: 'wrong password', address: '192.0.2.1' })
		).rejects.toMatchObject({ code: 'SIGN_IN_FAILED' });
		const events = securityEvents();
		expect(events).toEqual([
			{
				event: 'authentication.failed',
				code: 'SIGN_IN_FAILED',
				keys: [
					expect.stringMatching(/^login-failures:email\+address:[a-f0-9]{64}$/),
					expect.stringMatching(/^login-failures:address:[a-f0-9]{64}$/)
				]
			}
		]);
		const encoded = JSON.stringify(events);
		for (const secret of [owner.email, '192.0.2.1', 'wrong password'])
			expect(encoded).not.toContain(secret);
	});
	test('a whole office signing in from one address is never throttled', async () => {
		// Successful sign-ins never count, so colleagues behind one IP cannot block each other.
		for (let i = 0; i < 40; i++) {
			const user = i % 2 === 0 ? owner : outsider;
			await auth.login({ email: user.email, password, address: 'office-address' });
		}
		expect(await db.select().from(sessions)).toHaveLength(40);
	});
	test('failed sign-ins elsewhere cannot lock a real user out', async () => {
		for (let i = 0; i < 10; i++) {
			await expect(
				auth.login({ email: owner.email, password: 'wrong password', address: 'bot-address' })
			).rejects.toMatchObject({ status: 401 });
		}
		// The bot's address is now blocked for this account...
		await expect(
			auth.login({ email: owner.email, password, address: 'bot-address' })
		).rejects.toMatchObject({ status: 429 });
		// ...but the real user, from their own address, signs in normally.
		expect(
			(await auth.login({ email: owner.email, password, address: 'office-address' })).user.id
		).toBe(owner.id);
	});
	test('wrong second-factor codes are limited per account across addresses', async () => {
		await enableMfa();
		for (let i = 0; i < 10; i++) {
			await expect(
				auth.login({ email: owner.email, password, code: '000000', address: `stolen-${i}` })
			).rejects.toMatchObject({
				status: 401,
				message: 'Email, password or security code is incorrect'
			});
		}
		await expect(
			auth.login({ email: owner.email, password, code: '000000', address: 'stolen-new' })
		).rejects.toMatchObject({ status: 429 });
	});
});

describe('tenancy and isolation', () => {
	test('supports nested groups and acquired firms without changing IDs or memberships', async () => {
		const group = await create('Holding group', 'group');
		const subgroup = await create('Regional group', 'group', group.id);
		const firm = await create('Independent firm');
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: outsider.id, role: 'member' });
		const acquired = await move(firm.id, subgroup.id);
		expect(acquired.id).toBe(firm.id);
		expect(acquired.parentId).toBe(subgroup.id);
		expect((await tenancy.list(outsider)).map((t) => t.id)).toEqual([firm.id]);
		expect((await tenancy.get(outsider, firm.id)).role).toBe('member');
		await expect(tenancy.get(outsider, subgroup.id)).rejects.toMatchObject({ status: 404 });
	});
	test('parent ownership never inherits child or sibling access', async () => {
		const group = await create('Holding group', 'group');
		const firm = await create('Private firm', 'firm', group.id);
		await tenancy.setMembership(owner, { tenantId: group.id, userId: outsider.id, role: 'owner' });
		expect((await tenancy.list(outsider)).map((t) => t.id)).toEqual([group.id]);
		await expect(tenancy.get(outsider, firm.id)).rejects.toMatchObject({ status: 404 });
		await expect(tenancy.listMembers(outsider, firm.id)).rejects.toMatchObject({ status: 404 });
		await expect(tenancy.getFirmByHandle(outsider, firm.handle!)).rejects.toMatchObject({
			status: 404
		});
	});
	test('operators move firms by handle; cycles and firm parents are refused with no partial events', async () => {
		const group = await create('Group', 'group');
		const child = await create('Child', 'group', group.id);
		const firm = await create('Firm');
		expect((await move(firm.handle!, group.id)).parentId).toBe(group.id);
		const before = await db.select().from(auditEvents);
		await expect(move(group.id, group.id)).rejects.toMatchObject({ code: 'TENANT_CYCLE' });
		await expect(move(group.id, child.id)).rejects.toMatchObject({ code: 'TENANT_CYCLE' });
		await expect(move(child.id, firm.id)).rejects.toMatchObject({
			code: 'ONLY_GROUPS_CONTAIN_TENANTS'
		});
		expect(await db.select().from(auditEvents)).toHaveLength(before.length);
	});
	test('serializes concurrent opposing moves', async () => {
		const a = await create('Group A', 'group');
		const b = await create('Group B', 'group');
		const results = await Promise.allSettled([
			move(a.id, b.id),
			createServices(db, config).tenancyAdministration.moveTenant(
				{ tenant: b.id, parent: a.id },
				testOperator
			)
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
	});
	test('firm handles are suggested, unique, validated and changeable only by owners', async () => {
		const first = await tenancy.createFirm(owner, { name: 'Cedar Audit LLP' });
		const second = await tenancy.createFirm(owner, { name: 'Cedar Audit LLP' });
		expect([first.handle, second.handle]).toEqual(['cedar-audit-llp', 'cedar-audit-llp-2']);
		await expect(
			tenancy.createFirm(owner, { name: 'Copycat', handle: 'cedar-audit-llp' })
		).rejects.toMatchObject({ code: 'HANDLE_TAKEN' });
		await expect(
			tenancy.createFirm(owner, { name: 'Reserved', handle: 'settings' })
		).rejects.toThrow('reserved');
		await expect(
			tenancy.createFirm(owner, { name: 'Bad', handle: 'Not A Handle' })
		).rejects.toThrow();

		await tenancy.setMembership(owner, { tenantId: first.id, userId: outsider.id, role: 'admin' });
		await expect(
			tenancy.updateFirm(outsider, { firmId: first.id, name: 'Renamed', handle: 'renamed' })
		).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
		await expect(
			tenancy.updateFirm(owner, { firmId: first.id, name: 'Cedar', handle: second.handle! })
		).rejects.toMatchObject({ code: 'HANDLE_TAKEN' });
		await tenancy.updateFirm(owner, { firmId: first.id, name: 'Cedar', handle: 'cedar' });
		expect((await tenancy.getFirmByHandle(outsider, 'cedar')).firm.name).toBe('Cedar');
		await expect(tenancy.getFirmByHandle(outsider, 'cedar-audit-llp')).rejects.toMatchObject({
			status: 404
		});
		const [event] = await db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.action, 'tenant.updated'));
		expect(event.details).toEqual({
			previousName: 'Cedar Audit LLP',
			name: 'Cedar',
			previousHandle: 'cedar-audit-llp',
			handle: 'cedar'
		});
	});
	test('lines.ws/ opens the last firm used, falling back to the first firm by name', async () => {
		expect(await tenancy.findHomeFirmHandle(owner)).toBeNull();
		const zulu = await create('Zulu Audit');
		const alpha = await create('Alpha Audit');
		expect(await tenancy.findHomeFirmHandle(owner)).toBe(alpha.handle);
		await auth.rememberLastFirm(owner.id, zulu.id);
		expect(await tenancy.findHomeFirmHandle(owner)).toBe(zulu.handle);
		await tenancy.setMembership(owner, { tenantId: zulu.id, userId: outsider.id, role: 'owner' });
		await tenancy.setMembership(outsider, { tenantId: zulu.id, userId: owner.id, role: null });
		expect(await tenancy.findHomeFirmHandle(owner)).toBe(alpha.handle);
	});
	test('admins manage members and admins, but only owners grant or change ownership', async () => {
		const firm = await create('Firm');
		const [member] = await db
			.insert(users)
			.values({
				name: 'Synthetic Member',
				email: 'member@example.test',
				passwordHash: sharedHash,
				emailVerifiedAt: new Date()
			})
			.returning();
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: outsider.id, role: 'admin' });
		await tenancy.setMembership(outsider, { tenantId: firm.id, userId: member.id, role: 'member' });
		await tenancy.setMembership(outsider, { tenantId: firm.id, userId: member.id, role: 'admin' });
		await expect(
			tenancy.setMembership(outsider, { tenantId: firm.id, userId: member.id, role: 'owner' })
		).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
		await expect(
			tenancy.setMembership(outsider, { tenantId: firm.id, userId: owner.id, role: null })
		).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
		await tenancy.setMembership(outsider, { tenantId: firm.id, userId: member.id, role: null });
		expect((await tenancy.listMembers(outsider, firm.id)).map((m) => m.userId).sort()).toEqual(
			[owner.id, outsider.id].sort()
		);

		await invitationService.invite(outsider, {
			tenantId: firm.id,
			email: 'new-member@example.test',
			role: 'member'
		});
		await expect(
			invitationService.invite(outsider, {
				tenantId: firm.id,
				email: 'new-owner@example.test',
				role: 'owner'
			})
		).rejects.toMatchObject({ code: 'OWNER_REQUIRED' });
		const ownerInvite = await invitationService.invite(owner, {
			tenantId: firm.id,
			email: 'new-owner@example.test',
			role: 'owner'
		});
		await expect(invitationService.revoke(outsider, firm.id, ownerInvite.id)).rejects.toMatchObject(
			{ code: 'OWNER_REQUIRED' }
		);
		expect(await invitationService.list(outsider, firm.id)).toHaveLength(2);
	});
	test('profile changes are saved and audited', async () => {
		await auth.updateProfile(owner.id, { name: 'Renamed Owner', avatarColor: 'purple' });
		const [stored] = await db.select().from(users).where(eq(users.id, owner.id));
		expect(stored).toMatchObject({ name: 'Renamed Owner', avatarColor: 'purple' });
		const [event] = await db
			.select()
			.from(auditEvents)
			.where(eq(auditEvents.action, 'user.profile_updated'));
		expect(event.details).toEqual({ changed: ['name', 'avatarColor'] });
		await expect(
			auth.updateProfile(owner.id, { name: 'Renamed Owner', avatarColor: 'neon' as 'teal' })
		).rejects.toThrow();
	});
	test('prevents role escalation, duplicate membership and removal of the last owner', async () => {
		const firm = await create('Firm');
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: outsider.id, role: 'admin' });
		await expect(
			tenancy.setMembership(outsider, { tenantId: firm.id, userId: outsider.id, role: 'owner' })
		).rejects.toMatchObject({ status: 403, code: 'OWNER_REQUIRED' });
		await expect(
			tenancy.setMembership(owner, { tenantId: firm.id, userId: owner.id, role: null })
		).rejects.toMatchObject({ status: 409, code: 'LAST_OWNER' });
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: outsider.id, role: 'owner' });
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: owner.id, role: 'member' });
		await expect(
			tenancy.setMembership(owner, { tenantId: firm.id, userId: owner.id, role: 'owner' })
		).rejects.toMatchObject({ status: 403 });
		expect(
			await db.select().from(memberships).where(eq(memberships.tenantId, firm.id))
		).toHaveLength(2);
		await tenancy.setMembership(outsider, { tenantId: firm.id, userId: owner.id, role: null });
		await expect(tenancy.get(owner, firm.id)).rejects.toMatchObject({ status: 404 });
	});
	test('protects tree invariants and append-only events at the database boundary', async () => {
		const group = await create('Group', 'group');
		const child = await create('Child', 'group', group.id);
		const firm = await create('Firm');
		await expect(
			db.update(tenants).set({ parentId: child.id }).where(eq(tenants.id, group.id)).execute()
		).rejects.toThrow();
		await expect(
			db.update(tenants).set({ parentId: firm.id }).where(eq(tenants.id, child.id)).execute()
		).rejects.toThrow();
		await expect(
			db.update(tenants).set({ kind: 'firm' }).where(eq(tenants.id, group.id)).execute()
		).rejects.toThrow();
		await expect(db.delete(auditEvents).execute()).rejects.toThrow();
		await expect(
			db.insert(auditEvents).values({ action: 'tenant.created', tenantId: firm.id }).execute()
		).rejects.toThrow();
	});
	test('records the operator and old/new parents of a move in the same transaction', async () => {
		const group = await create('Group', 'group');
		const firm = await create('Firm');
		await move(firm.id, group.id);
		const [event] = await db
			.select()
			.from(auditEvents)
			.where(and(eq(auditEvents.tenantId, firm.id), eq(auditEvents.action, 'tenant.moved')));
		expect(event).toMatchObject({
			actorId: null,
			operatorName: testOperator.name,
			details: { previousParentId: null, newParentId: group.id }
		});
	});
	test('audit events record the request and session that caused them', async () => {
		const context = { requestId: Bun.randomUUIDv7(), sessionId: Bun.randomUUIDv7() };
		const firm = await runWithRequestContext(context, () => create('Traced firm'));
		const [event] = await db.select().from(auditEvents).where(eq(auditEvents.tenantId, firm.id));
		expect(event).toMatchObject({
			action: 'tenant.created',
			requestId: context.requestId,
			sessionId: context.sessionId,
			targetType: 'tenant',
			targetId: firm.id
		});
	});
});

const mail = createMailService(db, config.encryptionKey);
const invitationService = createInvitationService(db, config);
async function drainMail(): Promise<Mail[]> {
	const messages: Mail[] = [];
	while (
		await mail.deliverNext(async (message) => {
			messages.push(message);
		})
	) {
		/* bounded by synthetic fixtures */
	}
	return messages;
}
function codeFrom(message: Mail): string {
	return message.text.match(/#[A-Za-z0-9_-]{43}/)![0].slice(1);
}
async function signup(email = 'signup@example.test') {
	await auth.signup({ name: 'Synthetic Signup', email, address: 'signup-address' });
	const messages = await drainMail();
	return { email, token: codeFrom(messages[0]) };
}
async function enableMfa(userId = owner.id) {
	const setup = await mfa.begin(userId);
	const box = createSecretBox(config.encryptionKey);
	const [credential] = await db
		.select()
		.from(mfaCredentials)
		.where(eq(mfaCredentials.userId, userId));
	const secret = Buffer.from(
		await box.decrypt(credential.encryptedSecret, `mfa:${userId}`),
		'base64'
	);
	const code = await totp(secret, Math.floor(Date.now() / 30000));
	const codes = await mfa.confirm(userId, code);
	return { setup, secret, code, codes };
}

describe('verified onboarding and account lifecycle', () => {
	test('verifies the mailbox before storing a password and consumes signup only once', async () => {
		const pending = await signup();
		expect(await db.select().from(users).where(eq(users.email, pending.email))).toHaveLength(0);
		const [stored] = await db.select().from(credentialTokens);
		expect(stored.tokenHash).toBe(await hashToken(pending.token));
		const outcomes = await Promise.allSettled(
			Array.from({ length: 2 }, () => auth.activate({ ...pending, password, address: 'activate' }))
		);
		expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const [user] = await db.select().from(users).where(eq(users.email, pending.email));
		expect(user.emailVerifiedAt).not.toBeNull();
		expect(user.passwordHash).toStartWith('$argon2id$');
		expect((await auth.login({ email: pending.email, password, address: 'signin' })).user.id).toBe(
			user.id
		);
		await expect(
			auth.activate({ ...pending, password, address: 'activate' })
		).rejects.toMatchObject({ status: 401 });
	});
	test('duplicate and unknown signup/reset requests have the same public outcome without changing existing passwords', async () => {
		await expect(
			auth.signup({ name: 'Attacker', email: owner.email, address: 'signup' })
		).resolves.toBeUndefined();
		await expect(
			auth.requestReset({ email: 'missing@example.test', address: 'reset' })
		).resolves.toBeUndefined();
		expect(await drainMail()).toHaveLength(0);
		expect((await auth.login({ email: owner.email, password, address: 'signin' })).user.id).toBe(
			owner.id
		);
	});
	test('expires credentials and blocks accounts that have not been verified', async () => {
		const pending = await signup();
		await db.update(credentialTokens).set({ expiresAt: new Date(0) });
		await expect(
			auth.activate({ ...pending, password, address: 'activate' })
		).rejects.toMatchObject({ status: 401 });
		await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, owner.id));
		await expect(
			auth.login({ email: owner.email, password, address: 'signin' })
		).rejects.toMatchObject({ status: 401 });
		await expect(tenancy.createFirm(owner, { name: 'Invalid firm' })).rejects.toMatchObject({
			status: 401
		});
	});
	test('password recovery is one-use, revokes all sessions and does not bypass MFA', async () => {
		const login = await auth.login({ email: owner.email, password, address: 'signin' });
		await enableMfa();
		await auth.requestReset({ email: owner.email, address: 'reset' });
		const token = codeFrom((await drainMail())[0]);
		const newPassword = 'synthetic replacement passphrase';
		await auth.resetPassword({ token, password: newPassword, address: 'confirm-reset' });
		expect(await auth.authenticate(login.token)).toBeNull();
		expect(await db.select().from(sessions)).toHaveLength(0);
		expect((await db.select().from(mfaCredentials))[0].enabledAt).not.toBeNull();
		await expect(
			auth.resetPassword({ token, password, address: 'confirm-reset' })
		).rejects.toMatchObject({ status: 401 });
		await expect(
			auth.login({ email: owner.email, password, address: 'signin' })
		).rejects.toMatchObject({ status: 401 });
		await expect(
			auth.login({ email: owner.email, password: newPassword, address: 'signin' })
		).rejects.toMatchObject({ status: 401 });
	});
	test('password changes require the old password, revoke sessions and invalidate pending resets', async () => {
		const login = await auth.login({ email: owner.email, password, address: 'signin' });
		await auth.requestReset({ email: owner.email, address: 'reset' });
		const token = codeFrom((await drainMail())[0]);
		await expect(
			auth.changePassword(owner.id, { currentPassword: 'wrong', password, address: 'change' })
		).rejects.toMatchObject({ status: 401 });
		await auth.changePassword(owner.id, {
			currentPassword: password,
			password: 'another synthetic passphrase',
			address: 'change'
		});
		expect(await auth.authenticate(login.token)).toBeNull();
		await expect(auth.resetPassword({ token, password, address: 'reset' })).rejects.toMatchObject({
			status: 401
		});
	});
	test('sessions expire after inactivity and another user cannot revoke them', async () => {
		const login = await auth.login({ email: owner.email, password, address: 'signin' });
		await auth.revokeSession(outsider.id, login.session.id);
		expect(await auth.authenticate(login.token)).not.toBeNull();
		expect((await auth.listSessions(owner.id))[0]).not.toHaveProperty('tokenHash');
		await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 31 * 60000) });
		expect(await auth.authenticate(login.token)).toBeNull();
	});
});

describe('MFA and encrypted secrets', () => {
	test('matches independent RFC 6238 SHA1 test vectors and authenticates encryption context', async () => {
		const secret = new TextEncoder().encode('12345678901234567890');
		for (const [time, expected] of [
			[59, '94287082'],
			[1111111109, '07081804'],
			[1111111111, '14050471'],
			[1234567890, '89005924'],
			[2000000000, '69279037'],
			[20000000000, '65353130']
		] as const)
			expect(await totp(secret, Math.floor(time / 30), 8)).toBe(expected);
		expect(encodeBase32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI');
		const box = createSecretBox(config.encryptionKey);
		const encrypted = await box.encrypt('synthetic credential', 'mfa:one');
		expect(encrypted).not.toContain('synthetic credential');
		expect(await box.decrypt(encrypted, 'mfa:one')).toBe('synthetic credential');
		await expect(box.decrypt(encrypted, 'mfa:two')).rejects.toThrow();
	});
	test('MFA enrolment revokes old sessions, rejects TOTP replay and consumes recovery codes atomically', async () => {
		const login = await auth.login({ email: owner.email, password, address: 'signin' });
		const enrolled = await enableMfa();
		expect(await auth.authenticate(login.token)).toBeNull();
		const [credential] = await db.select().from(mfaCredentials);
		expect(credential.encryptedSecret).not.toContain(enrolled.setup.secret);
		expect((await db.select().from(recoveryCodes))[0].codeHash).not.toBe(enrolled.codes[0]);
		await expect(
			auth.login({ email: owner.email, password, code: enrolled.code, address: 'signin' })
		).rejects.toMatchObject({ status: 401 });
		const outcomes = await Promise.allSettled(
			Array.from({ length: 2 }, () =>
				auth.login({ email: owner.email, password, code: enrolled.codes[0], address: 'signin' })
			)
		);
		expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const [session] = await db.select().from(sessions);
		expect(session.mfaVerifiedAt).not.toBeNull();
		await expect(
			auth.login({ email: owner.email, password, code: enrolled.codes[0], address: 'signin' })
		).rejects.toMatchObject({ status: 401 });
	});
});

describe('invitations and delivery', () => {
	test('requires owner authority, verified recipient identity and a one-use invitation', async () => {
		const firm = await create('Invitation firm');
		await expect(
			invitationService.invite(outsider, {
				tenantId: firm.id,
				email: outsider.email,
				role: 'owner'
			})
		).rejects.toMatchObject({ status: 404 });
		await invitationService.invite(owner, {
			tenantId: firm.id,
			email: outsider.email,
			role: 'member'
		});
		const token = codeFrom((await drainMail())[0]);
		await expect(invitationService.accept(owner, token)).rejects.toMatchObject({ status: 400 });
		expect(await invitationService.accept(outsider, token)).toEqual({ tenantId: firm.id });
		expect((await tenancy.get(outsider, firm.id)).role).toBe('member');
		await expect(invitationService.accept(outsider, token)).rejects.toMatchObject({ status: 400 });
	});
	test('revocation and removal of inviter authority invalidate pending invitations', async () => {
		const firm = await create('Invitation firm');
		const invitation = await invitationService.invite(owner, {
			tenantId: firm.id,
			email: outsider.email,
			role: 'owner'
		});
		const token = codeFrom((await drainMail())[0]);
		await invitationService.revoke(owner, firm.id, invitation.id);
		await expect(invitationService.accept(outsider, token)).rejects.toMatchObject({ status: 400 });
		await invitationService.invite(owner, {
			tenantId: firm.id,
			email: outsider.email,
			role: 'owner'
		});
		const second = codeFrom((await drainMail())[0]);
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: outsider.id, role: 'owner' });
		await tenancy.setMembership(owner, { tenantId: firm.id, userId: owner.id, role: 'member' });
		await expect(invitationService.accept(outsider, second)).rejects.toMatchObject({
			code: 'INVITATION_NO_LONGER_VALID'
		});
	});
	test('invitation-only signup rejects uninvited addresses and rechecks invitation expiry', async () => {
		const privateAuth = createServices(db, { ...config, signup: 'invitation' }).identity;
		await privateAuth.signup({ name: 'New', email: 'new@example.test', address: 'signup' });
		expect(await drainMail()).toHaveLength(0);
		const firm = await create('Private firm');
		await invitationService.invite(owner, {
			tenantId: firm.id,
			email: 'new@example.test',
			role: 'member'
		});
		await drainMail();
		await privateAuth.signup({ name: 'New', email: 'new@example.test', address: 'signup' });
		const token = codeFrom((await drainMail())[0]);
		await db.update(invitations).set({ expiresAt: new Date(0) });
		await expect(
			privateAuth.activate({ token, password, address: 'activate' })
		).rejects.toMatchObject({ status: 400 });
	});
	test('encrypted outbox commits with credentials and parallel workers do not duplicate delivery', async () => {
		for (const email of ['one@example.test', 'two@example.test'])
			await auth.signup({ name: 'Synthetic', email, address: 'signup' });
		const stored = await db.select().from(mailOutbox);
		expect(stored).toHaveLength(2);
		expect(stored[0].encryptedMessage).not.toContain('example.test');
		const seen: string[] = [];
		await Promise.all([
			mail.deliverNext(async (_, id) => {
				seen.push(id);
			}),
			mail.deliverNext(async (_, id) => {
				seen.push(id);
			})
		]);
		expect(new Set(seen).size).toBe(2);
		expect(await db.select().from(mailOutbox)).toHaveLength(0);
	});
});

describe('privacy and operating controls', () => {
	test('account summary includes only the requester and no credential material', async () => {
		const firm = await create('Personal account firm');
		await auth.login({ email: owner.email, password, address: 'signin' });
		const summary = await auth.exportAccount(owner.id);
		expect(summary.profile.email).toBe(owner.email);
		expect(summary.memberships[0].tenantId).toBe(firm.id);
		const encoded = JSON.stringify(summary);
		expect(encoded).not.toContain(outsider.email);
		for (const forbidden of ['passwordHash', 'tokenHash', 'encryptedSecret', 'codeHash'])
			expect(encoded).not.toContain(forbidden);
	});
	test('cleanup removes expired private records while preserving domain audit history', async () => {
		await create('Retained firm');
		await auth.signup({ name: 'Expired', email: 'expired@example.test', address: 'signup' });
		await mfa.begin(owner.id);
		await db.update(credentialTokens).set({ expiresAt: new Date(0) });
		await db.update(mailOutbox).set({ expiresAt: new Date(0) });
		await db.update(mfaCredentials).set({ createdAt: new Date(0) });
		expect(
			await mail.deliverNext(async () => {
				throw new Error('Expired mail must not be sent');
			})
		).toBe(false);
		// The same calls the hourly background job makes.
		await auth.removeExpiredRecords();
		await invitationService.removeExpired();
		await mail.removeExpired();
		expect(await db.select().from(credentialTokens)).toHaveLength(0);
		expect(await db.select().from(mailOutbox)).toHaveLength(0);
		expect(await db.select().from(mfaCredentials)).toHaveLength(0);
		expect(await db.select().from(auditEvents)).toHaveLength(1);
	});
	test('Resend adapter uses a fixed endpoint, stable idempotency and rejects delivery failures', async () => {
		const { createResendSender } =
			await import('../../src/server/modules/notifications/mail.service');
		let endpoint = '',
			key = '',
			body = '';
		const request = async (url: string, init: RequestInit) => {
			endpoint = String(url);
			key = new Headers(init?.headers).get('idempotency-key')!;
			body = String(init?.body);
			return new Response('{"id":"synthetic"}', { status: 200 });
		};
		await createResendSender(
			'synthetic-api-key',
			'sender@example.test',
			request
		)(
			{ to: 'recipient@example.test', subject: 'Synthetic mail', text: 'Synthetic content' },
			'synthetic-delivery-id'
		);
		expect(endpoint).toBe('https://api.resend.com/emails');
		expect(key).toBe('synthetic-delivery-id');
		expect(JSON.parse(body)).toMatchObject({
			to: ['recipient@example.test'],
			text: 'Synthetic content'
		});
		const rejected = async () =>
			new Response('Provider details must stay private', { status: 429 });
		await expect(
			createResendSender(
				'synthetic',
				'sender@example.test',
				rejected
			)({ to: 'recipient@example.test', subject: 'Synthetic', text: 'Synthetic' }, 'synthetic-id')
		).rejects.toThrow('Email delivery failed');
	});
});

test('reauthentication rotates the token and cannot resurrect a revoked session', async () => {
	const login = await auth.login({ email: owner.email, password, address: 'signin' });
	const refreshed = await auth.reauthenticate(owner.id, login.session.tokenHash, password, '');
	expect(refreshed.token).not.toBe(login.token);
	expect(refreshed.session.expiresAt.getTime()).toBe(login.session.expiresAt.getTime());
	expect(await auth.authenticate(login.token)).toBeNull();
	expect((await auth.authenticate(refreshed.token))?.user.id).toBe(owner.id);
	await auth.logout(refreshed.session.tokenHash);
	await expect(
		auth.reauthenticate(owner.id, refreshed.session.tokenHash, password, '')
	).rejects.toMatchObject({ status: 401 });
});

describe('transactions', () => {
	test('a transaction that loses a real deadlock is retried and succeeds', async () => {
		// Two transactions lock the same two rows in opposite order. PostgreSQL aborts one
		// (after about a second); inTransaction runs it again.
		let arrived = 0;
		let releaseBoth!: () => void;
		const bothHoldFirstLock = new Promise<void>((resolve) => (releaseBoth = resolve));
		const lockInOrder = (first: string, second: string) =>
			inTransaction(db, async (tx) => {
				await tx.update(users).set({ name: 'Synthetic lock' }).where(eq(users.id, first));
				if (++arrived === 2) releaseBoth();
				await bothHoldFirstLock;
				await tx.update(users).set({ name: 'Synthetic lock' }).where(eq(users.id, second));
			});
		const results = await Promise.allSettled([
			lockInOrder(owner.id, outsider.id),
			lockInOrder(outsider.id, owner.id)
		]);
		expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
		expect(arrived).toBe(3);
	});
	test('repeated collisions become a "try again" business error, other errors pass through', async () => {
		let attempts = 0;
		await expect(
			inTransaction(db, async () => {
				attempts++;
				throw Object.assign(new Error('synthetic serialization failure'), { code: '40001' });
			})
		).rejects.toMatchObject({ code: 'TRY_AGAIN', status: 503 });
		expect(attempts).toBe(3);
		await expect(
			inTransaction(db, async () => {
				throw new Error('synthetic bug');
			})
		).rejects.toThrow('synthetic bug');
	});
});
