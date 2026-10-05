import { openDatabase } from '../src/server/db/connection';

export function openTestDatabase() {
	const url = process.env.TEST_DATABASE_URL;
	if (!url || !new URL(url).pathname.endsWith('_test')) {
		throw new Error(
			'TEST_DATABASE_URL must point to a disposable database whose name ends in _test'
		);
	}
	return openDatabase(url);
}
