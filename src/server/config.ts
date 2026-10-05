import type { variables } from '../env';

/** Raw environment values, already checked against the schemas in src/env.ts. */
export type Environment = { [Name in keyof typeof variables]?: string };

export type MailConfig = { mode: 'preview' } | { mode: 'resend'; apiKey: string; from: string };

export type Config = {
	databaseUrl: string;
	/** Public origin with no path, for example https://app.example.com. */
	origin: string;
	/** True when the app runs on localhost (local development and tests). */
	isLocal: boolean;
	encryptionKey: string;
	requireMfa: boolean;
	signup: 'public' | 'invitation';
	mail: MailConfig;
	/** Null when no key is configured: Companies House lookups are then turned off. */
	companiesHouseApiKey: string | null;
};

const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];
const DEFAULT_LOCAL_ORIGIN = 'http://localhost:5173';

export function isLocalHostname(hostname: string) {
	return LOCAL_HOSTNAMES.includes(hostname);
}

/**
 * Turns environment values into app configuration and refuses unsafe settings.
 * Used by the running app (src/server/app.ts) and by scripts.
 *
 * `building`: SvelteKit is building the app, so secrets may be missing.
 * `dev`: local development, where APP_ORIGIN defaults to the Vite dev server.
 */
export function createConfig(
	env: Environment,
	options: { building?: boolean; dev?: boolean } = {}
): Config {
	const { building = false, dev = false } = options;
	const origin = parseOrigin(env.APP_ORIGIN || (dev || building ? DEFAULT_LOCAL_ORIGIN : ''));
	const isLocal = isLocalHostname(origin.hostname);

	if (building) {
		// Secrets are not available while building. Use harmless placeholders.
		return {
			databaseUrl: env.DATABASE_URL || 'postgres://build@localhost/build',
			origin: origin.origin,
			isLocal,
			encryptionKey: env.AUTH_ENCRYPTION_KEY || Buffer.alloc(32).toString('base64'),
			requireMfa: true,
			signup: 'public',
			mail: { mode: 'preview' },
			companiesHouseApiKey: null
		};
	}

	if (!env.DATABASE_URL) throw new Error('Configure DATABASE_URL');
	if (!env.AUTH_ENCRYPTION_KEY)
		throw new Error('Configure AUTH_ENCRYPTION_KEY. Create one with: bun run auth:key');

	const mail = parseMail(env);
	if (!isLocal) {
		if (origin.protocol !== 'https:')
			throw new Error('Public deployments require an HTTPS APP_ORIGIN');
		if (mail.mode !== 'resend')
			throw new Error('Public deployments require MAIL_MODE=resend, RESEND_API_KEY and MAIL_FROM');
		if (env.REQUIRE_MFA === 'false')
			throw new Error('MFA cannot be disabled on public deployments');
	}

	return {
		databaseUrl: env.DATABASE_URL,
		origin: origin.origin,
		isLocal,
		encryptionKey: env.AUTH_ENCRYPTION_KEY,
		requireMfa: !isLocal || env.REQUIRE_MFA === 'true',
		signup: env.SIGNUP_MODE === 'invitation' ? 'invitation' : 'public',
		mail,
		companiesHouseApiKey: env.COMPANIES_HOUSE_API_KEY || null
	};
}

function parseOrigin(value: string) {
	const url = URL.parse(value);
	const isPlainOrigin =
		url &&
		['http:', 'https:'].includes(url.protocol) &&
		url.pathname === '/' &&
		!url.search &&
		!url.hash &&
		!url.username &&
		!url.password;
	if (!isPlainOrigin)
		throw new Error('Configure APP_ORIGIN as a plain origin, for example https://app.example.com');
	return url;
}

function parseMail(env: Environment): MailConfig {
	if (env.MAIL_MODE !== 'resend') return { mode: 'preview' };
	if (!env.RESEND_API_KEY || !env.MAIL_FROM || /[\r\n]/.test(env.MAIL_FROM))
		throw new Error('MAIL_MODE=resend requires RESEND_API_KEY and a single-line MAIL_FROM');
	return { mode: 'resend', apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM };
}
