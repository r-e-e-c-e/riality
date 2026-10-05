// Erases a local development database and re-applies all migrations.
// Usage: bun run db:reset [--check] [--seed]
//   --check  only show the target     --seed  add the development fixtures afterwards
import { resetDevelopmentDatabase, validateResetTarget } from '../src/server/db/development-reset';
import { validateSeedTarget } from '../src/server/db/development-seed';
import { readDevelopmentTarget, runScript } from './lib/runtime';

await runScript(async () => {
	const args = process.argv.slice(2);
	const unknown = args.filter((arg) => arg !== '--check' && arg !== '--seed');
	if (unknown.length > 0 || new Set(args).size !== args.length)
		throw new Error('Usage: bun run db:reset [--check] [--seed]');
	const seed = args.includes('--seed');

	const { databaseUrl, environment } = readDevelopmentTarget();
	const { target, name } = validateResetTarget(databaseUrl, environment);
	if (seed) validateSeedTarget(databaseUrl, environment);
	console.log(`Development reset target: ${target.hostname}:${target.port || '5432'}/${name}`);
	if (args.includes('--check')) return;

	// The standard `local` database and file storage run in Docker; start them if needed,
	// then make sure the storage bucket exists.
	if (name === 'local' && target.port === '6000') {
		const run = async (args: string[], failure: string) => {
			const docker = Bun.spawn(['docker', 'compose', ...args], {
				stdout: 'inherit',
				stderr: 'inherit'
			});
			if ((await docker.exited) !== 0) throw new Error(failure);
		};
		await run(
			['up', '-d', '--wait', '--wait-timeout', '60', 'db', 'storage'],
			'Could not start the development database and storage'
		);
		await run(['run', '--rm', '-T', 'storage-setup'], 'Could not create the storage bucket');
	}

	await resetDevelopmentDatabase(databaseUrl, environment);
	console.log('Development database reset. All migrations and security guards re-applied.');

	if (seed) {
		const seeding = Bun.spawn(['bun', 'scripts/seed-db.ts'], {
			stdout: 'inherit',
			stderr: 'inherit'
		});
		if ((await seeding.exited) !== 0)
			throw new Error('Database reset succeeded, but seeding failed');
	}
});
