// Creates an ownership group, owned by an existing user. Firms are then moved into
// it with tenancy:move. Usage: bun run tenancy:create-group
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
	const name = ask('Group name:');
	const ownerEmail = ask('Email of the group owner (an existing account):');
	confirm(`Create group "${name}" owned by ${ownerEmail}?`, 'CREATE');

	await withServices(async ({ services }) => {
		const group = await services.tenancyAdministration.createGroup(
			{ name, ownerEmail },
			operator()
		);
		console.log(`Group created. Group ID: ${group.id}`);
	});
});
