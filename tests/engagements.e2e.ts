import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const suffix = crypto.randomUUID();
const password = 'synthetic engagement browser passphrase';
const ownerEmail = `owner-${suffix}@example.test`;
const memberEmail = `member-${suffix}@example.test`;
const handle = `e2e-${suffix.slice(0, 8)}`;

test.beforeAll(() => {
	// Bun owns hashing/domain calls; browser tests run under Node. Synthetic fixture only.
	const result = execFileSync(
		'bun',
		[
			'-e',
			`
		import { openTestDatabase } from './tests/database';
		import { users } from './src/server/modules/identity/user.entity';
		import { createTenancyService } from './src/server/modules/tenancy/tenancy.service';
		import { migrate } from 'drizzle-orm/postgres-js/migrator';
		const { db, close } = openTestDatabase();
		try {
			await migrate(db, { migrationsFolder: './drizzle' });
			const passwordHash = await Bun.password.hash(${JSON.stringify(password)}, { algorithm: 'argon2id', memoryCost: 65536, timeCost: 2 });
			const [owner, member] = await db.insert(users).values([
				{ name: 'Synthetic Engagement Owner', email: ${JSON.stringify(ownerEmail)}, passwordHash, emailVerifiedAt: new Date() },
				{ name: 'Synthetic Engagement Member', email: ${JSON.stringify(memberEmail)}, passwordHash, emailVerifiedAt: new Date() }
			]).returning();
			const tenancy = createTenancyService(db);
			const firm = await tenancy.createFirm(owner, { name: 'Synthetic Engagement Firm', handle: ${JSON.stringify(handle)} });
			await tenancy.setMembership(owner, { tenantId: firm.id, userId: member.id, role: 'member' });
			console.log(JSON.stringify({ handle: firm.handle }));
		} finally { await close(); }
	`
		],
		{ encoding: 'utf8' }
	);
	expect(JSON.parse(result.trim().split('\n').at(-1)!).handle).toBe(handle);
});

async function signIn(page: import('@playwright/test').Page, email: string) {
	await page.goto('/login');
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

async function openDisclosure(page: import('@playwright/test').Page, title: string) {
	const summary = title.startsWith('Change access for')
		? page.getByLabel(title, { exact: true })
		: page.locator('summary').filter({ hasText: new RegExp(`^${title}$`) });
	if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
}

async function addTeamMember(page: import('@playwright/test').Page, name: string, role: string) {
	await openDisclosure(page, 'Add a team member');
	await page
		.getByRole('combobox', { name: 'Firm member', exact: true })
		.selectOption({ label: name });
	await page.getByRole('combobox', { name: 'Team role', exact: true }).selectOption(role);
	await page.getByRole('button', { name: 'Add to team', exact: true }).click();
	await expect(
		page.getByRole('region', { name: 'Assigned team' }).getByRole('heading', { name, exact: true })
	).toBeVisible();
}

async function saveTeamRole(page: import('@playwright/test').Page, name: string, role: string) {
	const summary = page.getByLabel(`Change role for ${name}`, { exact: true });
	const details = summary.locator('..');
	if ((await details.getAttribute('open')) === null) await summary.click();
	const form = details.locator('form');
	await form.getByRole('combobox').selectOption(role);
	await form.getByRole('button', { name: `Save role for ${name}`, exact: true }).click();
	if (role === 'remove') {
		await expect(
			page
				.getByRole('region', { name: 'Assigned team' })
				.getByRole('heading', { name, exact: true })
		).toHaveCount(0);
	} else {
		await expect(form.getByRole('status')).toHaveText(`Team role saved: ${role}.`);
	}
}

async function createNewEntity(
	page: import('@playwright/test').Page,
	client: string,
	entity: string
) {
	await openDisclosure(page, 'Add a client or legal entity');
	await openDisclosure(page, 'Create a client');
	await page.getByLabel('Client name', { exact: true }).fill(client);
	await page.getByRole('button', { name: 'Create client', exact: true }).click();
	await openDisclosure(page, 'Add a client or legal entity');
	await expect(page.getByRole('option', { name: client, exact: true })).toHaveCount(1);
	await page.getByRole('combobox', { name: 'Client', exact: true }).selectOption({ label: client });
	await page.getByLabel('Legal entity name', { exact: true }).fill(entity);
	await page.getByRole('button', { name: 'Add entity', exact: true }).click();
	await expect(page.getByRole('combobox', { name: 'Entity', exact: true })).toBeVisible();
	await page
		.getByRole('combobox', { name: 'Entity', exact: true })
		.selectOption({ label: `${client} · ${entity}` });
}

test('prioritises assigned work, discloses setup and team edits, and enforces current access', async ({
	page,
	browser
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await signIn(page, ownerEmail);
	await expect(page.getByRole('button', { name: 'Create client', exact: true })).toHaveCount(0);
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Engagements', exact: true })
		.click();
	await expect(page.getByRole('heading', { name: 'Engagements', exact: true })).toBeVisible();
	await expect(page.getByRole('combobox')).toHaveCount(0);
	await page.getByRole('link', { name: 'New engagement', exact: true }).click();
	await createNewEntity(page, 'Synthetic Browser Client', 'Synthetic Browser Trading Ltd');
	await page.getByLabel('Period start', { exact: true }).fill('2025-01-01');
	await page.getByLabel('Period end', { exact: true }).fill('2024-12-31');
	await page.getByRole('button', { name: 'Create engagement', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText(
		'Period end must be on or after period start'
	);
	await page.getByLabel('Period end', { exact: true }).fill('2025-12-31');
	await page.getByRole('button', { name: 'Create engagement', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Engagement team', exact: true })).toBeVisible();
	await expect(page.getByRole('combobox')).toHaveCount(0);
	const teamUrl = page.url(),
		engagementUrl = teamUrl.replace(/\/team$/, '');
	await addTeamMember(page, 'Synthetic Engagement Member', 'auditor');
	const context = await browser.newContext();
	const staff = await context.newPage();
	try {
		await signIn(staff, memberEmail);
		await expect(
			staff.getByRole('link', { name: 'Synthetic Browser Trading Ltd', exact: true })
		).toBeVisible();
		await expect(staff.getByRole('link', { name: 'New engagement', exact: true })).toHaveCount(0);
		await staff.getByRole('link', { name: 'Synthetic Browser Trading Ltd', exact: true }).click();
		await expect(staff.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
		await expect(staff.getByText('Synthetic Engagement Owner', { exact: true })).toBeVisible();
		await expect(staff.getByRole('link', { name: 'Manage team', exact: true })).toHaveCount(0);
		await expect(staff.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
		expect((await staff.goto(teamUrl))?.status()).toBe(403);
		expect((await staff.goto(`/${handle}/settings`))?.status()).toBe(403);
		expect((await staff.goto(`/${handle}/engagements/new`))?.status()).toBe(403);
		await saveTeamRole(page, 'Synthetic Engagement Member', 'partner');
		await staff.goto(engagementUrl);
		await expect(staff.getByRole('definition').filter({ hasText: /^Partner$/ })).toBeVisible();
		await saveTeamRole(page, 'Synthetic Engagement Member', 'remove');
		expect((await staff.goto(engagementUrl))?.status()).toBe(404);
		await staff.goto('/');
		await expect(
			staff.getByRole('heading', { name: 'No engagements assigned to you yet' })
		).toBeVisible();
		await addTeamMember(page, 'Synthetic Engagement Member', 'auditor');
		await page.goto(`/${handle}/settings`);
		await expect(page.getByRole('combobox')).toHaveCount(0);
		await openDisclosure(page, 'Change access for Synthetic Engagement Member');
		const membership = page.locator('form').filter({
			has: page.getByRole('combobox', {
				name: 'Access for Synthetic Engagement Member',
				exact: true
			})
		});
		await membership.getByRole('combobox').selectOption('remove');
		await membership.getByRole('button', { name: 'Update access', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Synthetic Engagement Member', exact: true })
		).toHaveCount(0);
		expect((await staff.goto(engagementUrl))?.status()).toBe(404);
		expect((await staff.goto(`/${handle}`))?.status()).toBe(404);
		await page.goto(teamUrl);
		await saveTeamRole(page, 'Synthetic Engagement Owner', 'remove');
		await expect(page.getByRole('link', { name: 'Open engagement', exact: true })).toHaveCount(0);
		expect((await page.goto(engagementUrl))?.status()).toBe(404);
		await page.goto(teamUrl);
		await expect(page.getByRole('heading', { name: 'Engagement team', exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

test('progressive client/entity/engagement setup works without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	try {
		await signIn(page, ownerEmail);
		await page.goto(`/${handle}/engagements/new`);
		await createNewEntity(page, 'Synthetic Native Client', 'Synthetic Native Ltd');
		await page.getByLabel('Period start', { exact: true }).fill('2025-01-01');
		await page.getByLabel('Period end', { exact: true }).fill('2025-12-31');
		await page.getByRole('button', { name: 'Create engagement', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Engagement team', exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Open engagement', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Synthetic Native Ltd', exact: true })
		).toBeVisible();

		// Without JavaScript, a refused duplicate still shows its message after the page reloads.
		await page.goto(`/${handle}/engagements/new`);
		await page
			.getByRole('combobox', { name: 'Entity', exact: true })
			.selectOption({ label: 'Synthetic Native Client · Synthetic Native Ltd' });
		await page.getByLabel('Period start', { exact: true }).fill('2025-01-01');
		await page.getByLabel('Period end', { exact: true }).fill('2025-12-31');
		await page.getByRole('button', { name: 'Create engagement', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('An engagement already exists');
	} finally {
		await context.close();
	}
});

test('error pages keep the app usable and signing in returns to the page', async ({ page }) => {
	// Signed out: the firm page asks you to sign in, then brings you back.
	const signedOut = await page.goto(`/${handle}/clients`);
	expect(signedOut?.status()).toBe(401);
	await expect(page.getByRole('heading', { name: 'Your session has ended' })).toBeVisible();
	await page.getByRole('link', { name: 'Sign in', exact: true }).click();
	await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/${handle}/clients$`));

	// A firm you can't access looks the same as one that doesn't exist, inside the app layout.
	const hidden = await page.goto('/no-such-firm-here');
	expect(hidden?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
	await expect(
		page
			.getByRole('navigation', { name: 'Main navigation' })
			.getByRole('link', { name: 'Dashboard' })
	).toHaveAttribute('href', `/${handle}`);

	// Only paths on this site are accepted after signing in.
	await page.context().clearCookies();
	await page.goto('/login?next=https://attacker.example');
	await page.getByLabel('Email', { exact: true }).fill(ownerEmail);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('a duplicate engagement is refused with the message on the period field', async ({ page }) => {
	await signIn(page, ownerEmail);
	await page.goto(`/${handle}/engagements/new`);
	await createNewEntity(page, 'Synthetic Duplicate Client', 'Synthetic Duplicate Ltd');
	for (let attempt = 0; attempt < 2; attempt++) {
		await page.goto(`/${handle}/engagements/new`);
		await page
			.getByRole('combobox', { name: 'Entity', exact: true })
			.selectOption({ label: 'Synthetic Duplicate Client · Synthetic Duplicate Ltd' });
		await page.getByLabel('Period start', { exact: true }).fill('2025-01-01');
		await page.getByLabel('Period end', { exact: true }).fill('2025-12-31');
		await page.getByRole('button', { name: 'Create engagement', exact: true }).click();
		if (attempt === 0)
			await expect(page.getByRole('heading', { name: 'Engagement team' })).toBeVisible();
	}
	await expect(page.getByRole('alert')).toContainText('An engagement already exists');
	await expect(page.getByLabel('Period start', { exact: true })).toHaveAttribute(
		'aria-invalid',
		'true'
	);
});

test('the header shows the firm, its navigation and an account menu', async ({ page }) => {
	await signIn(page, ownerEmail);
	await expect(page.locator('summary', { hasText: 'Synthetic Engagement Firm' })).toBeVisible();
	await expect(page.getByText('Lines', { exact: true })).toHaveCount(0);
	const navigation = page.getByRole('navigation', { name: 'Main navigation' });
	for (const link of ['Dashboard', 'Clients', 'Engagements', 'Settings'])
		await expect(navigation.getByRole('link', { name: link, exact: true })).toBeVisible();
	await page.getByLabel('Account menu for Synthetic Engagement Owner').click();
	await page.getByRole('link', { name: 'Manage account', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Manage account', exact: true })).toBeVisible();
	// Account pages keep the last firm's navigation.
	await expect(navigation.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute(
		'href',
		`/${handle}`
	);
	await page.getByLabel('Account menu for Synthetic Engagement Owner').click();
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
});

test('entities are added on the Clients page and edited on their own page', async ({ page }) => {
	await signIn(page, ownerEmail);
	await page.goto(`/${handle}/clients`);
	await openDisclosure(page, 'Add a client');
	await page.getByLabel('Client name', { exact: true }).fill('Synthetic Register Client');
	await page.getByRole('button', { name: 'Add client', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Synthetic Register Client' })).toBeVisible();

	// Companies House is not configured in tests, so details are entered by hand.
	await openDisclosure(page, 'Add a legal entity');
	await page
		.getByRole('combobox', { name: 'Client', exact: true })
		.selectOption({ label: 'Synthetic Register Client' });
	await page.getByLabel(/^Company number/).fill('oc301234');
	await page.getByLabel(/^Name/).fill('Synthetic Register LLP');
	await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('llp');
	await page.getByRole('button', { name: 'Add entity', exact: true }).click();
	await page.getByRole('link', { name: 'Synthetic Register LLP' }).click();

	await expect(page.getByRole('heading', { name: 'Synthetic Register LLP' })).toBeVisible();
	await expect(page.getByText('OC301234')).toBeVisible();
	await openDisclosure(page, 'Edit details');
	await page
		.getByRole('combobox', { name: 'Accounting framework', exact: true })
		.selectOption('frs102_1a');
	await page.getByLabel('Year end day', { exact: true }).fill('31');
	await page.getByRole('combobox', { name: 'Year end month', exact: true }).selectOption('3');
	await page.getByRole('button', { name: 'Save details', exact: true }).click();
	const details = page.getByRole('definition');
	await expect(details.filter({ hasText: /^31 March$/ })).toBeVisible();
	await expect(details.filter({ hasText: 'FRS 102 Section 1A (small entities)' })).toBeVisible();

	// People: add a designated member by hand, then find them on the People page.
	await openDisclosure(page, 'Add a person');
	const addPerson = page
		.locator('details')
		.filter({ has: page.locator('summary', { hasText: /^Add a person$/ }) });
	await addPerson.getByLabel(/^Name/).fill('Synthetic Member Person');
	await addPerson
		.getByRole('combobox', { name: 'Role', exact: true })
		.selectOption('llp_designated_member');
	await addPerson.getByLabel('Started on', { exact: true }).fill('2019-06-01');
	await addPerson.getByRole('button', { name: 'Add person', exact: true }).click();
	const people = page.getByRole('region', { name: 'People' });
	await expect(people.getByRole('link', { name: 'Synthetic Member Person' })).toBeVisible();
	await expect(people.getByText(/LLP designated member · 1 Jun 2019 – present/)).toBeVisible();

	await page.getByRole('link', { name: 'People', exact: true }).click();
	await page.getByRole('link', { name: 'Synthetic Member Person' }).click();
	await openDisclosure(page, 'Edit details');
	await page.getByLabel('Email', { exact: true }).fill('member.person@example.test');
	await page.getByRole('button', { name: 'Save details', exact: true }).click();
	await expect(
		page.getByRole('definition').filter({ hasText: 'member.person@example.test' })
	).toBeVisible();
	await expect(page.getByRole('cell', { name: 'Synthetic Register LLP' })).toBeVisible();
});

test('changes made in one window appear in other open windows without reloading', async ({
	context
}) => {
	const first = await context.newPage();
	await signIn(first, ownerEmail);
	await first.goto(`/${handle}/clients`);
	const second = await context.newPage();
	await second.goto(`/${handle}/clients`);
	// Remember this page load, to prove the window updates in place.
	await second.evaluate(() => Object.assign(window, { untouched: true }));

	await openDisclosure(first, 'Add a client');
	await first.getByLabel('Client name', { exact: true }).fill('Synthetic Live Client');
	await first.getByRole('button', { name: 'Add client', exact: true }).click();

	await expect(second.getByRole('heading', { name: 'Synthetic Live Client' })).toBeVisible();
	expect(await second.evaluate(() => 'untouched' in window)).toBe(true);

	// Signing out in one window signs out the others.
	await first.getByLabel(/^Account menu for /).click();
	await first.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(second.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});
