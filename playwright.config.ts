import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'bun run build && bun run start',
		port: 4173,
		env: {
			DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
			PORT: '4173',
			APP_ORIGIN: 'http://localhost:4173',
			AUTH_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
			REQUIRE_MFA: process.env.TEST_REQUIRE_MFA ?? 'false',
			MAIL_MODE: 'preview'
		}
	},
	workers: 1,
	use: { baseURL: 'http://localhost:4173' },
	testMatch: '**/*.e2e.{ts,js}'
});
