// Disables an account and revokes its sessions, codes and invitations.
// Usage: bun run auth:disable
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
	const userId = ask('User ID to disable:');
	const reason = ask('Reason (offboarding or security_incident):');
	if (reason !== 'offboarding' && reason !== 'security_incident') throw new Error('Invalid reason');
	confirm(`Disable account ${userId}?`, userId);

	await withServices(async ({ services }) => {
		const result = await services.administration.disableUser(userId, operator(), reason);
		console.log('Account disabled; sessions, pending codes and invitations revoked.');
		if (result.tenantsRequiringOwner.length > 0)
			console.log('These tenants now need a new owner:', result.tenantsRequiringOwner.join(', '));
	});
});
