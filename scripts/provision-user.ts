// Creates a verified account from the command line. For bootstrap and support only:
// verify the person's email independently and hand over the password securely.
// Usage: bun run auth:provision
import {
	ask,
	askHidden,
	operator,
	requireInteractiveTerminal,
	runScript,
	withServices
} from './lib/runtime';

await runScript(async () => {
	requireInteractiveTerminal();
	const name = ask('Full name:');
	const email = ask('Email:');
	if (!name || !email) throw new Error('Name and email are required');
	const password = await askHidden('Password (15–128 characters): ');

	await withServices(async ({ services }) => {
		const user = await services.identity.provision({ name, email, password }, operator());
		console.log(`Account provisioned. User ID: ${user.id}`);
		console.log('They can now sign in and create a firm, or be invited to one.');
	});
});
