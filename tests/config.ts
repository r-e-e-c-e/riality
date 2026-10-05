import type { Config } from '../src/server/config';

/** A synthetic encryption key for tests only. */
export const testEncryptionKey = Buffer.alloc(32, 7).toString('base64');

/** App config for tests: local origin, preview mail, synthetic key. */
export function testConfig(overrides: Partial<Config> = {}): Config {
	return {
		databaseUrl: process.env.TEST_DATABASE_URL ?? '',
		origin: 'http://localhost:5173',
		isLocal: true,
		encryptionKey: testEncryptionKey,
		requireMfa: false,
		signup: 'public',
		mail: { mode: 'preview' },
		companiesHouseApiKey: null,
		storage: null,
		...overrides
	};
}
