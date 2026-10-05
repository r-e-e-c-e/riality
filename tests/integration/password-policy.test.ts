import { test, expect } from 'bun:test';
import { createPasswordPolicy } from '../../src/server/modules/identity/passwords';
import { validateResetTarget } from '../../src/server/db/development-reset';

test('breach screening sends only the padded five-character hash prefix and rejects positive matches', async () => {
	const password = 'synthetic screening passphrase';
	const hash = Buffer.from(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password)))
		.toString('hex')
		.toUpperCase();
	const policy = createPasswordPolicy(true, async (url, options) => {
		expect(String(url)).toBe(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
		expect(JSON.stringify(options)).not.toContain(password);
		expect(options?.headers).toMatchObject({ 'Add-Padding': 'true' });
		return new Response(`${hash.slice(5)}:12\r\n${'0'.repeat(35)}:0`);
	});
	await expect(policy(password)).rejects.toThrow('breach');
	await expect(
		createPasswordPolicy(true, async () => new Response(`${hash.slice(5)}:0`))(password)
	).resolves.toBeUndefined();
});

test('new passwords fail closed on screening outages/malformed data and common passwords are blocked offline', async () => {
	for (const response of [new Response('', { status: 503 }), new Response('bad response')])
		await expect(
			createPasswordPolicy(true, async () => response)('synthetic acceptable passphrase')
		).rejects.toMatchObject({ status: 503 });
	await expect(createPasswordPolicy(false)('passwordpassword')).rejects.toThrow('common');
	await expect(createPasswordPolicy(false)('aaaaaaaaaaaaaaa')).rejects.toThrow('common');
});

test('development reset refuses public/production/admin targets and connection overrides', () => {
	for (const url of [
		'postgres://localhost/postgres',
		'postgres://localhost/client_data',
		'postgres://remote.example/local',
		'postgres://localhost/local?host=remote.example'
	])
		expect(() => validateResetTarget(url, {})).toThrow();
	expect(() =>
		validateResetTarget('postgres://localhost/local', { nodeEnv: 'production' })
	).toThrow();
	expect(() =>
		validateResetTarget('postgres://localhost/local', { origin: 'https://app.example.test' })
	).toThrow();
	expect(validateResetTarget('postgres://localhost/synthetic_test', {}).name).toBe(
		'synthetic_test'
	);
});
