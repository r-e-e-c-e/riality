import { expect, test } from '@playwright/test';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { openTestDatabase } from './database';
import { users } from '../src/server/modules/identity/user.entity';

const email = `browser-${Date.now()}@example.test`;
const password = 'synthetic browser passphrase';
const firmName = `Synthetic firm ${Date.now()}`;

test.beforeAll(async () => {
	// Playwright runs on Node; the database seed uses Bun's hashing in a child process.
	const { execFileSync } = await import('node:child_process');
	const passwordHash = execFileSync(
		'bun',
		[
			'-e',
			`console.log(await Bun.password.hash(${JSON.stringify(password)}, { algorithm: 'argon2id', memoryCost: 65536, timeCost: 2 }))`
		],
		{ encoding: 'utf8' }
	).trim();
	const { db, close } = openTestDatabase();
	try {
		await migrate(db, { migrationsFolder: './drizzle' });
		await db
			.insert(users)
			.values({ name: 'Synthetic Browser User', email, passwordHash, emailVerifiedAt: new Date() });
	} finally {
		await close();
	}
});

async function signOut(page: import('@playwright/test').Page) {
	await page.getByLabel(/^Account menu for /).click();
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
}

test('signs in, creates firm workspaces, switches between them and signs out', async ({
	page,
	context
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/login');
	await expect(page.getByText('Lines', { exact: true })).toBeVisible();
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill('incorrect');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText('Email, password or security code is incorrect');
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	// No firm yet: the welcome page offers to create one.
	await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
	const cookie = (await context.cookies()).find((cookie) => cookie.name === '__Host-lines_session');
	expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });

	await page.getByRole('link', { name: 'Create a firm', exact: true }).click();
	await page.getByLabel('Firm name', { exact: true }).fill(firmName);
	await page.getByRole('button', { name: 'Create firm', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
	const firstUrl = page.url();
	expect(new URL(firstUrl).pathname).toBe(`/synthetic-firm-${firmName.split(' ').at(-1)}`);
	await expect(page.locator('summary', { hasText: firmName })).toBeVisible();

	// A second firm, then switch back through the workspace switcher.
	await page.locator('summary', { hasText: firmName }).click();
	await page.getByRole('link', { name: 'Create a firm', exact: true }).click();
	await page.getByLabel('Firm name', { exact: true }).fill(`${firmName} Two`);
	await page.getByLabel(/^Web address/).fill(`second-${Date.now()}`);
	await page.getByRole('button', { name: 'Create firm', exact: true }).click();
	await expect(page.locator('summary', { hasText: `${firmName} Two` })).toBeVisible();
	await page.locator('summary', { hasText: `${firmName} Two` }).click();
	await page.getByRole('link', { name: firmName, exact: true }).click();
	await expect(page).toHaveURL(firstUrl);

	// lines.ws/ returns to the firm used last.
	await page.goto('/');
	await expect(page).toHaveURL(firstUrl);
	await signOut(page);
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	expect(errors).toEqual([]);
});

test('native forms work without JavaScript and never echo invalid passwords', async ({
	browser
}) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	try {
		await page.goto('http://localhost:4173/login');
		await page.getByLabel('Email', { exact: true }).fill(email);
		await page.getByLabel('Password', { exact: true }).fill('private-wrong-password');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
		expect(await page.content()).not.toContain('private-wrong-password');
		await page.getByLabel('Password', { exact: true }).fill(password);
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	} finally {
		await context.close();
	}
});

test('rejects cross-origin remote forms and avoids caching private pages', async ({
	page,
	request
}) => {
	const response = await page.goto('/login');
	expect(response?.headers()['cache-control']).toContain('no-store');
	expect(response?.headers()['x-frame-options']).toBe('DENY');
	expect(response?.headers()['referrer-policy']).toBe('same-origin');
	const csp = response?.headers()['content-security-policy'] ?? '';
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(
		csp.split(';').find((directive) => directive.trim().startsWith('script-src'))
	).not.toContain('unsafe-inline');
	const action = await page.locator('form').getAttribute('action');
	expect(action).toBeTruthy();
	const rejected = await request.post(`/login${action}`, {
		headers: { origin: 'https://untrusted.example.test' },
		form: { email, _password: password }
	});
	expect(rejected.status()).toBe(403);
});

/** Waits for the app's background mail job to write the email (preview mode) and returns its code. */
async function takeMail(email: string): Promise<string> {
	const { readdir, readFile, rm } = await import('node:fs/promises');
	const directory = '.local/mail';
	for (let attempt = 0; attempt < 60; attempt++) {
		// File names are UUID v7, so sorting gives the oldest email first.
		const files = (await readdir(directory).catch(() => [] as string[])).sort();
		for (const file of files) {
			const mail = JSON.parse(await readFile(`${directory}/${file}`, 'utf8'));
			if (mail.to !== email) continue;
			await rm(`${directory}/${file}`);
			return mail.text.match(/#[A-Za-z0-9_-]{43}/)![0].slice(1);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`No email arrived for ${email}`);
}

test('verified signup, MFA setup, recovery-code login and firm invitation work end to end', async ({
	page
}) => {
	const suffix = Date.now();
	const ownerEmail = `signup-${suffix}@example.test`,
		invitedEmail = `invited-${suffix}@example.test`;
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/signup');
	await page.getByLabel('Name', { exact: true }).fill('Synthetic Signup Owner');
	await page.getByLabel('Work email').fill(ownerEmail);
	await page.getByRole('button', { name: 'Send verification email' }).click();
	await expect(page.getByRole('status')).toContainText('verification link');
	const activationCode = await takeMail(ownerEmail);
	await page.goto(`/activate#${activationCode}`);
	await expect(page.getByLabel('Verification code')).toHaveValue(activationCode);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Verify email and create account' }).click();
	await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
	await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
	await page.goto('/account');
	const beforeReauth = (await page.context().cookies()).find(
		(cookie) => cookie.name === '__Host-lines_session'
	)?.value;
	await page.getByText('Confirm your identity', { exact: true }).click();
	const reauth = page
		.locator('details')
		.filter({ has: page.getByText('Confirm your identity', { exact: true }) });
	await reauth.getByLabel('Password', { exact: true }).fill(password);
	await reauth.getByRole('button', { name: 'Confirm identity', exact: true }).click();
	await expect(reauth.getByRole('status')).toContainText('Identity confirmed');
	expect(
		(await page.context().cookies()).find((cookie) => cookie.name === '__Host-lines_session')?.value
	).not.toBe(beforeReauth);
	await page.getByRole('button', { name: 'Start MFA setup' }).click();
	await expect(page.locator('.secret')).toBeVisible();
	const { createSecretBox } = await import('../src/server/modules/identity/identity.crypto');
	const { totp } = await import('../src/server/modules/identity/totp');
	const { mfaCredentials } = await import('../src/server/modules/identity/mfa.entity');
	const { eq } = await import('drizzle-orm');
	const { db, close } = openTestDatabase();
	let code: string;
	try {
		const [user] = await db.select().from(users).where(eq(users.email, ownerEmail));
		const [credential] = await db
			.select()
			.from(mfaCredentials)
			.where(eq(mfaCredentials.userId, user.id));
		const secret = Buffer.from(
			await createSecretBox(Buffer.alloc(32, 2).toString('base64')).decrypt(
				credential.encryptedSecret,
				`mfa:${user.id}`
			),
			'base64'
		);
		code = await totp(secret, Math.floor(Date.now() / 30000));
	} finally {
		await close();
	}
	await page.getByLabel('Authenticator code', { exact: true }).fill(code);
	await page.getByRole('button', { name: 'Enable MFA and show recovery codes' }).click();
	await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
	const recoveryCode = await page.locator('li code').first().innerText();
	const replacementProof = await page.locator('li code').nth(1).innerText();
	expect(await page.locator('li code').count()).toBe(10);
	await page.getByRole('link', { name: 'Sign in with your authenticator' }).click();
	await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Security code (if MFA is enabled)').fill(recoveryCode);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
	await page.goto('/new-firm');
	const name = `Inviting firm ${suffix}`;
	await page.getByLabel('Firm name', { exact: true }).fill(name);
	await page.getByRole('button', { name: 'Create firm', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByText('Invite someone', { exact: true }).click();
	const invite = page
		.locator('details')
		.filter({ has: page.getByText('Invite someone', { exact: true }) });
	await invite.getByLabel('Email', { exact: true }).fill(invitedEmail);
	await invite.getByRole('button', { name: 'Send invitation' }).click();
	await expect(invite.getByRole('status')).toContainText('Invitation sent');
	const invitationCode = await takeMail(invitedEmail);
	await signOut(page);
	await page.goto('/signup');
	await page.getByLabel('Name', { exact: true }).fill('Synthetic Invited Member');
	await page.getByLabel('Work email').fill(invitedEmail);
	await page.getByRole('button', { name: 'Send verification email' }).click();
	await expect(page.getByRole('status')).toBeVisible();
	await page.goto(`/activate#${await takeMail(invitedEmail)}`);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Verify email and create account' }).click();
	await page.getByLabel('Email', { exact: true }).fill(invitedEmail);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();
	await page.goto(`/invite#${invitationCode}`);
	await expect(page.getByLabel('Invitation code')).toHaveValue(invitationCode);
	await page.getByRole('button', { name: 'Accept invitation' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
	await expect(page.locator('summary', { hasText: name })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
	await signOut(page);
	await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel('Security code (if MFA is enabled)').fill(replacementProof);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await page.goto('/account');
	await page.getByText('Replace recovery codes', { exact: true }).click();
	const regeneration = page.locator('form').filter({
		has: page.getByRole('button', { name: 'Generate new recovery codes and sign out' })
	});
	// Use an unused TOTP counter within the allowed clock tolerance.
	const { recoveryCodes } = await import('../src/server/modules/identity/mfa.entity');
	const connection = openTestDatabase();
	try {
		const [owner] = await connection.db.select().from(users).where(eq(users.email, ownerEmail));
		const [credential] = await connection.db
			.select()
			.from(mfaCredentials)
			.where(eq(mfaCredentials.userId, owner.id));
		const secret = Buffer.from(
			await createSecretBox(Buffer.alloc(32, 2).toString('base64')).decrypt(
				credential.encryptedSecret,
				`mfa:${owner.id}`
			),
			'base64'
		);
		const step = Math.max(Math.floor(Date.now() / 30000), Number(credential.lastStep) + 1);
		await regeneration.getByLabel('Password', { exact: true }).fill(password);
		await regeneration
			.getByLabel('Authenticator or unused recovery code')
			.fill(await totp(secret, step));
		await regeneration
			.getByRole('button', { name: 'Generate new recovery codes and sign out' })
			.click();
		await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
		expect(await page.locator('li code').count()).toBe(10);
		expect(
			(await connection.db.select().from(recoveryCodes).where(eq(recoveryCodes.userId, owner.id)))
				.length
		).toBe(10);
		expect(
			(await page.context().cookies()).some((cookie) => cookie.name === '__Host-lines_session')
		).toBe(false);
	} finally {
		await connection.close();
	}
	expect(errors).toEqual([]);
});

test('password recovery form updates credentials and leaves no token in the request URL', async ({
	page
}) => {
	await page.goto('/forgot-password');
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByRole('button', { name: 'Send reset email' }).click();
	await expect(page.getByRole('status')).toBeVisible();
	const token = await takeMail(email);
	await page.goto(`/reset-password#${token}`);
	await expect(page.getByLabel('Reset code')).toHaveValue(token);
	await page
		.getByLabel('New password', { exact: true })
		.fill('synthetic updated browser passphrase');
	const requests: string[] = [];
	page.on('request', (request) => requests.push(request.url()));
	await page.getByRole('button', { name: 'Update password' }).click();
	await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
	expect(requests.some((url) => url.includes(token))).toBe(false);
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill('synthetic updated browser passphrase');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('MFA requirement rejects direct tenant calls before enrolment', async ({ page }) => {
	test.skip(process.env.TEST_REQUIRE_MFA !== 'true', 'Run with TEST_REQUIRE_MFA=true');
	await page.goto('/login');
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Manage account', exact: true })).toBeVisible();
	// Discover Kit's generated endpoint identifier; don't hard-code an experimental hash.
	const { readdir, readFile } = await import('node:fs/promises');
	const directory = '.svelte-kit/output/server/chunks';
	let moduleId = '';
	for (const file of await readdir(directory)) {
		if (
			file.startsWith('remote-') &&
			file.endsWith('.js') &&
			(await readFile(`${directory}/${file}`, 'utf8')).includes('workspace.remote.js')
		)
			moduleId = file.slice(7, -3);
	}
	expect(moduleId).not.toBe('');
	// Remote query arguments travel as base64url-encoded devalue JSON.
	const payload = Buffer.from(JSON.stringify(['any-firm'])).toString('base64url');
	const rejected = await page.request.get(
		`/_app/remote/${moduleId}/getWorkspace?payload=${payload}`
	);
	// Kit transports remote-function errors in an HTTP 200 envelope.
	expect(await rejected.json()).toMatchObject({ type: 'error', error: { status: 403 } });
	const engagement = await page.goto('/any-firm/engagements/00000000-0000-4000-8000-000000000002');
	expect(engagement?.status()).toBe(403);
	// lines.ws/ sends them to finish MFA setup; the header offers no firm navigation yet.
	await page.goto('/');
	await expect(page).toHaveURL(/\/account$/);
	await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
});
