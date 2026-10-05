import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { isLocalHostname } from '../config';

/** Opens a PostgreSQL connection pool. Call close() when a script or test is done. */
export function openDatabase(url: string) {
	const target = new URL(url);
	if (!['postgres:', 'postgresql:'].includes(target.protocol))
		throw new Error('Invalid database URL');

	// Remote databases always use TLS with certificate checks. (postgres.js treats
	// sslmode=require as "encrypt but don't verify", so we never rely on the URL.)
	// For a private certificate authority, add it to the runtime's trusted CAs.
	const sslMode = target.searchParams.get('sslmode');
	const useTls = !isLocalHostname(target.hostname) || (sslMode !== null && sslMode !== 'disable');

	const client = postgres(url, {
		max: 10,
		ssl: useTls ? { rejectUnauthorized: true } : false,
		onnotice: () => {}
	});
	return { db: drizzle({ client }), close: () => client.end() };
}

export type Database = ReturnType<typeof openDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
