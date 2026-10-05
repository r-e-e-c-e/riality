// Grants the app's restricted database role access to the tables it needs.
// Run with the migration (owner) connection. Usage: bun run db:grant-runtime <role>
import { grantRuntimePrivileges } from '../src/server/db/permissions';
import { runScript, withServices } from './lib/runtime';

await runScript(async () => {
	const role = process.argv[2];
	if (!role || process.argv.length !== 3)
		throw new Error('Usage: bun run db:grant-runtime <existing-unprivileged-role>');
	await withServices(async ({ db }) => {
		await grantRuntimePrivileges(db, role);
		console.log('Restricted runtime privileges applied.');
	});
});
