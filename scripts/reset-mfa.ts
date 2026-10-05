// Removes a user's authenticator and recovery codes after they lost both.
// Only run this after confirming the person's identity through a separate trusted
// channel (for example a video call with their firm owner). Email alone is not enough.
// Usage: bun run auth:reset-mfa
import {
	ask,
	confirm,
	operator,
	requireInteractiveTerminal,
	runScript,
	withServices
} from './lib/runtime';

await runScript(async () => {
	requireInteractiveTerminal();
	const email = ask('Email of the account:');
	confirm('Have you verified this person through a separate trusted channel?', 'VERIFIED');

	await withServices(async ({ services }) => {
		await services.administration.resetMfa(email, operator());
		console.log('MFA removed and all sessions signed out. They must set up MFA again at sign-in.');
	});
});
