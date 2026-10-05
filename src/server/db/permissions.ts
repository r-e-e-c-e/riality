import { sql } from 'drizzle-orm';
import type { Database } from './connection';

// Tables the app's restricted database role may read and write. Add new tables here.
// audit_event is separate: the app may only read and insert it.
export const runtimeTables = [
	'app_user',
	'auth_session',
	'rate_limit',
	'credential_token',
	'mfa_credential',
	'mfa_recovery_code',
	'tenant',
	'tenant_membership',
	'tenant_invitation',
	'mail_outbox',
	'client',
	'entity',
	'reporting_period',
	'engagement',
	'engagement_team'
] as const;

/**
 * Grants the runtime role exactly the privileges the app needs. Run with the migration
 * (owner) connection. The role must already exist, own nothing, and have no special
 * attributes (superuser, CREATEDB, CREATEROLE, ...), inherited roles or memberships.
 */
export async function grantRuntimePrivileges(db: Database, role: string) {
	if (!/^[a-z][a-z0-9_]{0,62}$/.test(role) || role === 'public')
		throw new Error('Invalid runtime role');
	const [attributes] = await db.execute<{ unsafe: boolean }>(sql`select
		(rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit
		or exists (select 1 from pg_auth_members where member = pg_roles.oid)
		or exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relowner = pg_roles.oid and n.nspname in ('public', 'drizzle'))
		or exists (select 1 from pg_namespace where nspowner = pg_roles.oid and nspname in ('public', 'drizzle'))
		or exists (select 1 from pg_database where datname = current_database() and datdba = pg_roles.oid)) as unsafe
		from pg_roles where rolname = ${role}`);
	if (!attributes || attributes.unsafe)
		throw new Error('Runtime role must be unprivileged, NOINHERIT and non-owning');
	await db.transaction(async (tx) => {
		await tx.execute(sql`revoke create on schema public from public`);
		await tx.execute(sql`revoke all on all tables in schema public from ${sql.identifier(role)}`);
		await tx.execute(sql`grant usage on schema public to ${sql.identifier(role)}`);
		await tx.execute(
			sql`grant select, insert, update, delete on ${sql.join(
				runtimeTables.map((name) => sql.identifier(name)),
				sql`, `
			)} to ${sql.identifier(role)}`
		);
		await tx.execute(sql`grant select, insert on audit_event to ${sql.identifier(role)}`);
	});
}
