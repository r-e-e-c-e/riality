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
			MAIL_MODE: 'preview',
			// Bun loads .env, so blank this: browser tests never call Companies House.
			COMPANIES_HOUSE_API_KEY: '',
			// Browser tests don't use file storage.
			S3_ENDPOINT: '',
			S3_BUCKET: '',
			S3_ACCESS_KEY_ID: '',
			S3_SECRET_ACCESS_KEY: ''
		}
	},
	workers: 1,
	use: { baseURL: 'http://localhost:4173' },
	testMatch: '**/*.e2e.{ts,js}'
});
