import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { openDatabase } from '../src/server/db/connection';
import { openTestDatabase } from './database';
import { grantRuntimePrivileges } from '../src/server/db/permissions';

export async function isolatedDatabase(restricted = false) {
	const control = openTestDatabase();
	const suffix = crypto.randomUUID().replaceAll('-', '');
	const name = `lines_fixture_${suffix}_test`,
		role = `lines_runtime_${suffix}`;
	let created = false,
		roleCreated = false;
	let owner: ReturnType<typeof openDatabase> | undefined,
		runtime: ReturnType<typeof openDatabase> | undefined;
	const close = async () => {
		if (runtime) await runtime.close();
		if (owner) await owner.close();
		try {
			if (created) await control.db.execute(sql`drop database ${sql.identifier(name)}`);
			if (roleCreated) await control.db.execute(sql`drop role ${sql.identifier(role)}`);
		} finally {
			await control.close();
		}
	};
	try {
		await control.db.execute(sql`create database ${sql.identifier(name)}`);
		created = true;
		const url = new URL(process.env.TEST_DATABASE_URL!);
		url.pathname = `/${name}`;
		owner = openDatabase(url.toString());
		await migrate(owner.db, { migrationsFolder: './drizzle' });
		if (restricted) {
			// Generated hex contains no quote/metacharacter; PostgreSQL role DDL cannot
			// bind the password as a parameter. This is synthetic and never logged.
			const password = crypto.randomUUID().replaceAll('-', '');
			await control.db.execute(
				sql`create role ${sql.identifier(role)} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${sql.raw(`'${password}'`)}`
			);
			roleCreated = true;
			await grantRuntimePrivileges(owner.db, role);
			url.username = role;
			url.password = password;
			runtime = openDatabase(url.toString());
		}
		return {
			db: owner.db,
			runtimeDb: runtime?.db ?? owner.db,
			url: url.toString(),
			ownerUrl: (() => {
				const u = new URL(process.env.TEST_DATABASE_URL!);
				u.pathname = `/${name}`;
				return u.toString();
			})(),
			role,
			close
		};
	} catch (cause) {
		await close();
		throw cause;
	}
}
