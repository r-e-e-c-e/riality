import { dev } from '$app/env';
import { getRequestEvent } from '$app/server';
import { invalid } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { config } from './app';
import { BusinessError, type BusinessErrorCode } from './errors';
import type { AuthSession, AuthUser } from './modules/identity/identity.service';
import { RECENT_SIGN_IN_MINUTES, SESSION_SECONDS } from './modules/identity/identity.shared';

// Helpers for remote functions: who is signed in, the session cookie, and form
// errors. Services never import SvelteKit; this file does.

/** The __Host- prefix makes browsers require Secure, Path=/ and no Domain. */
export const SESSION_COOKIE = dev ? 'lines_session' : '__Host-lines_session';
const cookieOptions = { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax' } as const;

export function setSessionCookie(token: string, session: AuthSession) {
	const secondsLeft = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
	getRequestEvent().cookies.set(SESSION_COOKIE, token, {
		...cookieOptions,
		maxAge: Math.max(0, Math.min(SESSION_SECONDS, secondsLeft)),
		expires: session.expiresAt
	});
}

export function deleteSessionCookie(cookies: Cookies = getRequestEvent().cookies) {
	cookies.delete(SESSION_COOKIE, cookieOptions);
}

/** Signs the browser out for the rest of this request and future ones. */
export function clearIdentity() {
	const event = getRequestEvent();
	deleteSessionCookie(event.cookies);
	event.locals.user = null;
	event.locals.session = null;
}

/** Any signed-in user, including one who still has to set up MFA. Use for account-security actions. */
export function requireIdentity() {
	const { user, session } = getRequestEvent().locals;
	if (!user || !session) throw new BusinessError('SIGN_IN_REQUIRED');
	return { user, session };
}

/** True if this deployment requires MFA and the user has not completed it in this session. */
export function isMfaPending(user: AuthUser, session: AuthSession) {
	return config.requireMfa && (!user.mfaEnabled || !session.mfaVerifiedAt);
}

/** A signed-in user who has completed MFA where it is required. Use for everything else. */
export function requireUser() {
	const { user, session } = requireIdentity();
	if (isMfaPending(user, session)) throw new BusinessError('MFA_SETUP_REQUIRED');
	return user;
}

/**
 * A user who entered their password in the last few minutes. Use for sensitive
 * account changes; this does not require MFA, so it works during MFA setup.
 */
export function requireRecentSignIn() {
	const identity = requireIdentity();
	const cutoff = Date.now() - RECENT_SIGN_IN_MINUTES * 60_000;
	if (identity.session.authenticatedAt.getTime() < cutoff)
		throw new BusinessError('RECENT_SIGN_IN_REQUIRED');
	return identity;
}

/** requireUser plus a recent sign-in. Use for team, membership and firm changes. */
export function requireRecentUser() {
	const user = requireUser();
	requireRecentSignIn();
	return user;
}

/** Which form field a business error belongs to, for example { PASSWORD_BREACHED: '_password' }. */
export type ErrorFields = Partial<Record<BusinessErrorCode, string>>;

/** Password-policy errors belong to the new-password field in every form that sets one. */
export const NEW_PASSWORD_FIELD = {
	PASSWORD_TOO_COMMON: '_password',
	PASSWORD_BREACHED: '_password'
} satisfies ErrorFields;

/**
 * For forms: shows a business error as a form message instead of an error page.
 * If `fields` names a field for the error's code, the message is attached to that
 * field, so its input is marked invalid. Queries and commands need nothing:
 * hooks.server.ts turns business errors into responses.
 */
export async function submit<T>(operation: () => Promise<T>, fields: ErrorFields = {}): Promise<T> {
	try {
		return await operation();
	} catch (cause) {
		if (cause instanceof BusinessError) {
			const field = fields[cause.code];
			invalid(field ? { message: cause.message, path: [field] } : cause.message);
		}
		if (cause instanceof ZodError) invalid('Check your input');
		throw cause;
	}
}

/**
 * Returns `value` if it is a path on this site (like /cedar-audit/clients), otherwise '/'.
 * Stops "open redirect" links that send people to another site after signing in.
 */
export function safeReturnPath(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
		return '/';
	return value;
}

/**
 * Makes a request take at least ~250ms, so response time does not reveal whether
 * an email has an account (used by signup and password reset requests).
 */
export async function withMinimumDuration<T>(operation: () => Promise<T>): Promise<T> {
	const randomExtra = crypto.getRandomValues(new Uint8Array(1))[0] % 50;
	const earliestEnd = Date.now() + 250 + randomExtra;
	try {
		return await operation();
	} finally {
		const remaining = earliestEnd - Date.now();
		if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
	}
}
