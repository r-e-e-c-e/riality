// Adds the synthetic development fixtures. Local development databases only.
// Usage: bun run db:seed [--check]   (--check only shows the target)
import { seedDevelopmentDatabase, validateSeedTarget } from '../src/server/db/development-seed';
import { seedPassword, seedUsers } from '../src/server/db/seed-data';
import { seedDevelopmentDocuments } from '../src/server/db/seed-documents';
import { openDatabase } from '../src/server/db/connection';
import { createFileStorage } from '../src/server/integrations/storage';
import { readDevelopmentTarget, runScript } from './lib/runtime';

await runScript(async () => {
	const args = process.argv.slice(2);
	if (args.length > 1 || (args.length === 1 && args[0] !== '--check'))
		throw new Error('Usage: bun run db:seed [--check]');

	const { databaseUrl, environment, storage } = readDevelopmentTarget();
	const { target, name } = validateSeedTarget(databaseUrl, environment);
	console.log(`Development seed target: ${target.hostname}:${target.port || '5432'}/${name}`);
	if (args[0] === '--check') return;

	const result = await seedDevelopmentDatabase(databaseUrl, environment);

	// Documents need file storage (MinIO in compose.yaml); safe to add again.
	if (storage) {
		const { db, close } = openDatabase(databaseUrl);
		try {
			const count = await seedDevelopmentDocuments(db, createFileStorage(storage));
			console.log(`Uploaded ${count} synthetic documents to ${storage.endpoint}.`);
		} finally {
			await close();
		}
	} else {
		console.log('File storage is not configured (S3_*), so no documents were added.');
	}

	if (!result.created) {
		console.log('Development fixtures already exist; later edits were kept.');
		return;
	}
	console.log(
		`Seeded ${result.users} users, ${result.tenants} tenants, ${result.memberships} memberships and ${result.engagements} engagements.`
	);
	console.log('Synthetic sign-ins:');
	for (const user of seedUsers) console.log(`  ${user.email} (${user.id})`);
	console.log(`Password for all of them: ${seedPassword}`);
});
