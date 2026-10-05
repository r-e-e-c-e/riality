// Re-encrypts MFA secrets and queued email with a new AUTH_ENCRYPTION_KEY.
// Stop the app first. Usage:
//   AUTH_MAINTENANCE=true AUTH_ENCRYPTION_KEY_NEXT=<new key> bun run auth:rotate-key
import {
	confirm,
	operator,
	requireInteractiveTerminal,
	runScript,
	withServices
} from './lib/runtime';

await runScript(async () => {
	requireInteractiveTerminal();
	const nextKey = process.env.AUTH_ENCRYPTION_KEY_NEXT;
	if (process.env.AUTH_MAINTENANCE !== 'true' || !nextKey)
		throw new Error('Set AUTH_MAINTENANCE=true and AUTH_ENCRYPTION_KEY_NEXT, with the app stopped');
	confirm('Is the app stopped on every server?', 'ROTATE');

	await withServices(async ({ config, services }) => {
		const result = await services.administration.rotateEncryptionKey(
			config.encryptionKey,
			nextKey,
			operator()
		);
		console.log('Encrypted values rotated.', result);
		console.log(
			'Now set AUTH_ENCRYPTION_KEY to the new key everywhere, then start the app. Keep the old key safe for backups.'
		);
	});
});
