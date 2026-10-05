import { and, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../../db/connection';
import { BusinessError } from '../../errors';
import { logger } from '../../logger';
import { createSecretBox } from './identity.crypto';
import { rateLimits } from './rate-limit.entity';

export type RateLimitRule = { name: string; limit: number; windowMinutes: number };

/**
 * Every rate limit in one place.
 *
 * Goal: stop bots without ever blocking real staff. A whole firm often shares one
 * office IP address, so:
 * - sign-in and code checks count FAILURES only, never successful attempts;
 * - per-address limits are far above what an office of people would reach;
 * - per-account limits are keyed by email + address, so a bot elsewhere cannot lock
 *   a real user out of their own account.
 * The second factor is the exception: it is limited per user across all addresses,
 * because only someone who already knows the password can fail it.
 */
export const RATE_LIMITS = {
	loginFailuresPerEmailAndAddress: {
		name: 'login-failures:email+address',
		limit: 10,
		windowMinutes: 15
	},
	loginFailuresPerAddress: { name: 'login-failures:address', limit: 200, windowMinutes: 15 },
	secondFactorFailuresPerUser: {
		name: 'second-factor-failures:user',
		limit: 10,
		windowMinutes: 15
	},
	/** Wrong current password or code while signed in (step-up, password change, MFA setup). */
	confirmationFailuresPerUser: { name: 'confirmation-failures:user', limit: 10, windowMinutes: 15 },
	/** Wrong or expired emailed codes (account activation, password reset). */
	emailCodeFailuresPerAddress: {
		name: 'email-code-failures:address',
		limit: 50,
		windowMinutes: 15
	},
	/** Every request counts here, because each one sends an email. */
	signupEmailsPerEmail: { name: 'signup-emails:email', limit: 3, windowMinutes: 15 },
	signupEmailsPerAddress: { name: 'signup-emails:address', limit: 100, windowMinutes: 15 },
	resetEmailsPerEmail: { name: 'reset-emails:email', limit: 3, windowMinutes: 15 },
	resetEmailsPerAddress: { name: 'reset-emails:address', limit: 100, windowMinutes: 15 },
	invitationsPerUser: { name: 'invitations:user', limit: 100, windowMinutes: 60 }
} satisfies Record<string, RateLimitRule>;

/**
 * Rate limits stored in PostgreSQL, so every app server shares the same counts.
 * Counts are written straight to the database (not to the caller's transaction),
 * so a failed attempt is still counted when its transaction rolls back.
 */
export function createRateLimiter(db: Database, encryptionKey: string) {
	const box = createSecretBox(encryptionKey);
	const keyFor = async (rule: RateLimitRule, value: string) =>
		`${rule.name}:${await box.fingerprint(value)}`;

	async function currentCount(key: string) {
		const [row] = await db
			.select({ attempts: rateLimits.attempts })
			.from(rateLimits)
			.where(and(eq(rateLimits.key, key), gt(rateLimits.resetsAt, sql`now()`)));
		return row?.attempts ?? 0;
	}

	/** Adds one attempt and returns the new count. Starts a new window if the old one ended. */
	async function addAttempt(rule: RateLimitRule, key: string) {
		const windowEnd = sql`now() + ${rule.windowMinutes} * interval '1 minute'`;
		const windowEnded = sql`${rateLimits.resetsAt} <= now()`;
		const [row] = await db
			.insert(rateLimits)
			.values({ key, attempts: 1, resetsAt: windowEnd })
			.onConflictDoUpdate({
				target: rateLimits.key,
				set: {
					attempts: sql`case when ${windowEnded} then 1 else ${rateLimits.attempts} + 1 end`,
					resetsAt: sql`case when ${windowEnded} then ${windowEnd} else ${rateLimits.resetsAt} end`
				}
			})
			.returning({ attempts: rateLimits.attempts });
		return row.attempts;
	}

	return {
		/** Counts this attempt and throws 429 once the limit is exceeded. Use when every attempt costs something. */
		async consume(rule: RateLimitRule, value: string) {
			const key = await keyFor(rule, value);
			if ((await addAttempt(rule, key)) > rule.limit) {
				logSecurityEvent('throttled', [key]);
				throw new BusinessError('RATE_LIMITED');
			}
		},

		/**
		 * Runs `attempt` unless a rule's failure limit is already used up. If the attempt
		 * throws a failed-attempt error (wrong password, code or token, see errors.ts), one
		 * failure is counted against every rule. Successful attempts are never counted.
		 */
		async limitFailures<T>(
			rules: [rule: RateLimitRule, value: string][],
			attempt: () => Promise<T>
		): Promise<T> {
			const keys = await Promise.all(rules.map(([rule, value]) => keyFor(rule, value)));
			for (const [index, [rule]] of rules.entries()) {
				if ((await currentCount(keys[index])) >= rule.limit) {
					logSecurityEvent('throttled', keys);
					throw new BusinessError('RATE_LIMITED');
				}
			}
			try {
				return await attempt();
			} catch (error) {
				if (error instanceof BusinessError && error.failedAttempt) {
					for (const [index, [rule]] of rules.entries()) await addAttempt(rule, keys[index]);
					logSecurityEvent('failed', keys, error.code);
				}
				throw error;
			}
		},

		/** Deletes counters whose window has ended. Run by the cleanup job. */
		async removeExpired() {
			await db.delete(rateLimits).where(sql`${rateLimits.resetsAt} <= now()`);
		}
	};
}

/**
 * Logs a failed or throttled attempt for security monitoring (alert on bursts).
 * `keys` are rule names plus keyed fingerprints, never raw emails or IP addresses.
 * These go to the logs, not the audit history.
 */
function logSecurityEvent(outcome: 'failed' | 'throttled', keys: string[], code?: string) {
	logger.warn('security event', {
		event: outcome === 'failed' ? 'authentication.failed' : 'authentication.throttled',
		code,
		keys
	});
}
