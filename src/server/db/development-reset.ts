import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { isLocalHostname } from '../config';
import { openDatabase } from './connection';

export type DevelopmentEnvironment = { nodeEnv?: string; origin?: string };

/**
 * Refuses anything that could be a real database: production mode, a public app
 * origin, a non-local database host, URL options, or a database name other than
 * `local` (the Docker database on port 6000) or one ending in _dev or _test.
 */
export function validateResetTarget(url: string, environment: DevelopmentEnvironment) {
	const target = new URL(url);
	if (environment.nodeEnv === 'production') throw new Error('Database reset is development-only');
	if (environment.origin && !isLocalHostname(new URL(environment.origin).hostname))
		throw new Error('Database reset refuses a public application origin');

	const isLocalPostgres =
		['postgres:', 'postgresql:'].includes(target.protocol) && isLocalHostname(target.hostname);
	if (!isLocalPostgres || target.search || target.hash)
		throw new Error('Database reset requires a loopback PostgreSQL URL without overrides');

	const name = decodeURIComponent(target.pathname.slice(1));
	if (name === 'local' && target.port !== '6000')
		throw new Error(
			'The local Docker database uses port 6000; update DATABASE_URL before resetting'
		);
	if (name !== 'local' && !/^[a-z][a-z0-9_]*_(dev|test)$/.test(name))
		throw new Error('Database reset requires local or a database ending in _dev or _test');
	return { target, name };
}

/** Drops all tables and data, then re-applies every migration (including security triggers). */
export async function resetDevelopmentDatabase(
	url: string,
	environment: DevelopmentEnvironment,
	migrationsFolder = './drizzle'
) {
	validateResetTarget(url, environment);
	if (readMigrationFiles({ migrationsFolder }).length === 0)
		throw new Error('Migration history is missing; refusing to reset');

	const { db, close } = openDatabase(url);
	try {
		await db.transaction(async (tx) => {
			await tx.execute(sql`drop schema if exists public cascade`);
			await tx.execute(sql`drop schema if exists drizzle cascade`);
			await tx.execute(sql`create schema public`);
			await tx.execute(sql`revoke create on schema public from public`);
		});
		await migrate(db, { migrationsFolder });
	} finally {
		await close();
	}
}
