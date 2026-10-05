/**
 * Every expected business error, in one place. Services throw these to stop an
 * operation (the transaction rolls back). hooks.server.ts turns them into responses
 * with the status, message and code; forms show the message next to the form.
 *
 * `failedAttempt: true` marks a wrong password, code or token. The rate limiter
 * counts these, and only these, as failed attempts.
 *
 * Messages are shown to users: keep them short, plain and safe. Never include IDs,
 * emails or anything that reveals whether a record exists.
 */
const BUSINESS_ERRORS = {
	// Signing in and sessions
	SIGN_IN_REQUIRED: { status: 401, message: 'Sign in to continue' },
	SESSION_ENDED: { status: 401, message: 'Please sign in again' },
	SIGN_IN_FAILED: {
		status: 401,
		message: 'Email, password or security code is incorrect',
		failedAttempt: true
	},
	CONFIRMATION_FAILED: {
		status: 401,
		message: 'Password or security code is incorrect',
		failedAttempt: true
	},
	CURRENT_PASSWORD_INCORRECT: {
		status: 401,
		message: 'Current password is incorrect',
		failedAttempt: true
	},
	AUTHENTICATOR_CODE_INCORRECT: {
		status: 401,
		message: 'Authenticator code is incorrect',
		failedAttempt: true
	},
	EMAIL_CODE_INVALID: {
		status: 401,
		message: 'This code is invalid or expired',
		failedAttempt: true
	},
	RECENT_SIGN_IN_REQUIRED: {
		status: 403,
		message: 'Confirm your identity in Manage account before continuing'
	},
	MFA_SETUP_REQUIRED: {
		status: 403,
		message: 'Set up MFA in Manage account before continuing'
	},
	RATE_LIMITED: { status: 429, message: 'Too many attempts. Try again in 15 minutes.' },
	SIGN_IN_BUSY: { status: 503, message: 'Sign-in is busy. Try again in a moment.' },
	TRY_AGAIN: {
		status: 503,
		message: 'Someone else was changing the same records. Please try again.'
	},

	// Accounts and passwords
	ACCOUNT_EXISTS: { status: 409, message: 'Account already exists' },
	PASSWORD_TOO_COMMON: { status: 400, message: 'Choose a less common password' },
	PASSWORD_BREACHED: {
		status: 400,
		message: 'This password has appeared in a breach. Choose another'
	},
	PASSWORD_CHECK_UNAVAILABLE: {
		status: 503,
		message: 'Password security check is unavailable. Try again shortly.'
	},
	SOLE_OWNER: {
		status: 409,
		message: 'Transfer sole tenant ownership before offboarding'
	},

	// MFA
	MFA_ALREADY_ENABLED: { status: 409, message: 'MFA is already enabled' },
	MFA_NOT_ENABLED: { status: 400, message: 'Enable MFA first' },
	MFA_SETUP_EXPIRED: { status: 400, message: 'Start MFA setup again' },
	MFA_CANNOT_BE_DISABLED: { status: 403, message: 'MFA is required for this environment' },
	MFA_NOT_SET_UP: { status: 409, message: 'This account has no MFA to reset' },

	// Tenants, memberships and invitations
	NOT_FOUND: { status: 404, message: 'Not found' },
	OWNER_REQUIRED: { status: 403, message: 'Owner access is required' },
	ADMIN_REQUIRED: { status: 403, message: 'Admin access is required' },
	ONLY_GROUPS_CONTAIN_TENANTS: { status: 400, message: 'Only groups can contain tenants' },
	TENANT_CYCLE: {
		status: 409,
		message: 'A tenant cannot be placed inside itself or its descendants'
	},
	LAST_OWNER: { status: 409, message: 'There must always be at least one active owner' },
	HANDLE_TAKEN: { status: 409, message: 'That handle is already taken. Choose another' },
	INVITATION_INVALID: {
		status: 400,
		message: 'Invitation is invalid, expired or belongs to another email'
	},
	INVITATION_NO_LONGER_VALID: { status: 400, message: 'This invitation is no longer valid' },

	// Engagements
	ENGAGEMENT_EXISTS: {
		status: 409,
		message: 'An engagement already exists for this entity and reporting period'
	}
} satisfies Record<string, { status: number; message: string; failedAttempt?: true }>;

export type BusinessErrorCode = keyof typeof BUSINESS_ERRORS;

/** Codes the app can send to the browser: business errors plus two generic ones. */
export type ErrorCode = BusinessErrorCode | 'INVALID_INPUT' | 'UNEXPECTED';

export class BusinessError extends Error {
	readonly code: BusinessErrorCode;
	readonly status: number;
	readonly failedAttempt: boolean;

	constructor(code: BusinessErrorCode, message?: string) {
		const definition: { status: number; message: string; failedAttempt?: true } =
			BUSINESS_ERRORS[code];
		super(message ?? definition.message);
		this.name = 'BusinessError';
		this.code = code;
		this.status = definition.status;
		this.failedAttempt = definition.failedAttempt ?? false;
	}
}

/** A 404 with a specific message, for example notFound('Engagement'). */
export function notFound(thing: string) {
	return new BusinessError('NOT_FOUND', `${thing} not found`);
}

/** The PostgreSQL error code of an error, looking through Drizzle's wrapper. */
export function postgresErrorCode(error: unknown): string | undefined {
	for (let current = error; current instanceof Error; current = current.cause) {
		if ('code' in current && typeof current.code === 'string') return current.code;
	}
	return undefined;
}
