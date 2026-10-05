// Moves a firm (or group) into a group, or back to the top level. Used when a firm
// joins or leaves an ownership group. Nobody gains access to firm work by a move.
// Confirm both owners agreed before running. Usage: bun run tenancy:move
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
	const tenant = ask('Firm handle (or tenant ID) to move:');
	const parent = ask('Destination group ID (leave empty for top level):');
	confirm(`Move ${tenant} to ${parent || 'the top level'}?`, 'MOVE');

	await withServices(async ({ services }) => {
		await services.tenancyAdministration.moveTenant({ tenant, parent: parent || null }, operator());
		console.log('Moved.');
	});
});
