import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

// Every environment variable the app reads. SvelteKit validates these when the
// app starts; scripts validate them with the same schemas (see scripts/lib/runtime.ts).
// Rules that involve more than one variable live in src/server/config.ts.
export const variables = defineEnvVars({
	DATABASE_URL: { description: 'The PostgreSQL connection string.' },
	APP_ORIGIN: {
		schema: z.string().optional(),
		description: 'Public origin, for example https://app.example.com. Also needed at build time.'
	},
	AUTH_ENCRYPTION_KEY: {
		schema: z.string().optional(),
		description:
			'Base64 32-byte secret. Encrypts MFA secrets and queued mail. Create with bun run auth:key.'
	},
	REQUIRE_MFA: {
		schema: z.enum(['true', 'false']).optional(),
		description: 'Require MFA locally too. MFA is always required on public deployments.'
	},
	SIGNUP_MODE: {
		schema: z.enum(['public', 'invitation']).optional(),
		description:
			'public: anyone can sign up with a verified email. invitation: invited emails only.'
	},
	MAIL_MODE: {
		schema: z.enum(['preview', 'resend']).optional(),
		description: 'preview writes emails to .local/mail (local only). resend sends real email.'
	},
	RESEND_API_KEY: { schema: z.string().optional(), description: 'Resend API key.' },
	COMPANIES_HOUSE_API_KEY: {
		schema: z.string().optional(),
		description: 'Companies House API key. Without it, entities are entered by hand.'
	},
	MAIL_FROM: {
		schema: z.string().optional(),
		description: 'Verified sender address, for example "Lines <accounts@example.com>".'
	}
});
