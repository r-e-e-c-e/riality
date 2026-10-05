import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { AvatarColor } from '#lib/avatar.js';
import type { Config } from '../../config';
import type { Database, Transaction } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError } from '../../errors';
import {
	emailSchema,
	nameSchema,
	passwordSchema,
	profileSchema,
	signupSchema,
	tokenSchema
} from '#lib/schemas/identity.js';
import { auditEvents } from '../audit/audit-event.entity';
import { recordEvent } from '../audit/audit-event.service';
import { createMailService } from '../notifications/mail.service';
import { invitations } from '../tenancy/invitation.entity';
import { memberships } from '../tenancy/membership.entity';
import { tenants } from '../tenancy/tenant.entity';
import { credentialTokens } from './credential-token.entity';
import { createRandomToken, createSecretBox, hashToken } from './identity.crypto';
import {
	IDLE_SECONDS,
	SESSION_SECONDS,
	checkCurrentPassword,
	confirmStepUp,
	isLiveSession,
	lockActiveUser,
	replacePassword,
	revokeOneSession,
	verifySecondFactor
} from './identity.shared';
import { mfaCredentials } from './mfa.entity';
import {
	createPasswordPolicy,
	hashPassword,
	verifyPassword,
	type PasswordCheck
} from './passwords';
import { RATE_LIMITS, createRateLimiter, type RateLimitRule } from './rate-limit.service';
import { sessions } from './session.entity';
import { isActiveUser, users } from './user.entity';

export type AuthUser = {
	id: string;
	name: string;
	email: string;
	avatarColor: AvatarColor;
	mfaEnabled: boolean;
};
export type AuthSession = Pick<
	typeof sessions.$inferSelect,
	'id' | 'tokenHash' | 'expiresAt' | 'authenticatedAt' | 'mfaVerifiedAt'
>;

export type IdentityConfig = Pick<
	Config,
	'origin' | 'isLocal' | 'encryptionKey' | 'requireMfa' | 'signup'
>;

/** Replaceable parts, so tests never call the breach-check service. */
export type IdentityOverrides = { passwordCheck?: PasswordCheck };

const SIGNUP_CODE_MINUTES = 60;
const RESET_CODE_MINUTES = 20;

// A real hash to compare against when the email is unknown, so unknown and known
// emails take the same time to check.
let unknownUserHash: Promise<string> | undefined;
function getUnknownUserHash() {
	unknownUserHash ??= hashPassword(createRandomToken()).catch((error) => {
		unknownUserHash = undefined;
		throw error;
	});
	return unknownUserHash;
}

/**
 * Accounts, sign-in and sessions. Authenticator (MFA) setup is in mfa.service.ts.
 *
 * Methods receive a trusted user ID from the request's session (never from form
 * input) and an `address` (the client IP) for rate limiting.
 */
export function createIdentityService(
	db: Database,
	config: IdentityConfig,
	overrides: IdentityOverrides = {}
) {
	const box = createSecretBox(config.encryptionKey);
	const limiter = createRateLimiter(db, config.encryptionKey);
	const mail = createMailService(db, config.encryptionKey);
	const checkPasswordPolicy = overrides.passwordCheck ?? createPasswordPolicy(!config.isLocal);

	async function prepareNewPassword(password: string) {
		const valid = passwordSchema.parse(password);
		await checkPasswordPolicy(valid);
		return hashPassword(valid);
	}

	async function hasLiveInvitation(tx: Transaction, email: string) {
		const [invitation] = await tx
			.select({ id: invitations.id })
			.from(invitations)
			.where(and(eq(invitations.email, email), gt(invitations.expiresAt, new Date())))
			.limit(1);
		return Boolean(invitation);
	}

	/** Stores a one-use code and queues the email containing it, in the same transaction. */
	async function sendEmailCode(
		tx: Transaction,
		input: { purpose: 'signup' | 'reset'; email: string; name?: string; userId?: string }
	) {
		const code = createRandomToken();
		const minutes = input.purpose === 'signup' ? SIGNUP_CODE_MINUTES : RESET_CODE_MINUTES;
		const expiresAt = new Date(Date.now() + minutes * 60_000);
		await tx
			.insert(credentialTokens)
			.values({ ...input, tokenHash: await hashToken(code), expiresAt });

		// The code goes after # so it is never sent to the server in a URL or logged.
		const isSignup = input.purpose === 'signup';
		const link = `${config.origin}${isSignup ? '/activate' : '/reset-password'}#${code}`;
		const action = isSignup ? 'verify your email and choose a password' : 'reset your password';
		await mail.enqueue(
			tx,
			{
				to: input.email,
				subject: isSignup ? 'Create your Lines account' : 'Reset your Lines password',
				text: [
					`Open this link to ${action}:`,
					link,
					'',
					`If needed, paste this code into the page: ${code}`,
					`This single-use code expires in ${minutes} minutes. If you did not request this, ignore this message.`
				].join('\n')
			},
			expiresAt
		);
	}

	/** Finds a live emailed code without using it up. */
	async function findEmailCode(purpose: 'signup' | 'reset', tokenHash: string) {
		const [code] = await db
			.select()
			.from(credentialTokens)
			.where(
				and(
					eq(credentialTokens.tokenHash, tokenHash),
					eq(credentialTokens.purpose, purpose),
					gt(credentialTokens.expiresAt, new Date())
				)
			);
		return code;
	}

	/** Deletes a live emailed code, so it can only be used once. Returns it, or undefined if already used. */
	async function useEmailCode(tx: Transaction, purpose: 'signup' | 'reset', tokenHash: string) {
		const [code] = await tx
			.delete(credentialTokens)
			.where(
				and(
					eq(credentialTokens.tokenHash, tokenHash),
					eq(credentialTokens.purpose, purpose),
					gt(credentialTokens.expiresAt, new Date())
				)
			)
			.returning();
		return code;
	}

	return {
		/** Creates a verified account from the operator command line (auth:provision). */
		async provision(
			input: { name: string; email: string; password: string },
			operator: { name: string }
		) {
			const name = nameSchema.parse(input.name);
			const email = emailSchema.parse(input.email);
			const operatorName = nameSchema.parse(operator.name);
			const passwordHash = await prepareNewPassword(input.password);
			return inTransaction(db, async (tx) => {
				const [user] = await tx
					.insert(users)
					.values({ name, email, passwordHash, emailVerifiedAt: new Date() })
					.onConflictDoNothing({ target: users.email })
					.returning({ id: users.id, name: users.name, email: users.email });
				if (!user) throw new BusinessError('ACCOUNT_EXISTS');
				await recordEvent(tx, {
					action: 'user.provisioned',
					operatorName,
					subjectUserId: user.id,
					target: { type: 'user', id: user.id }
				});
				return { ...user, mfaEnabled: false };
			});
		},

		/**
		 * Step 1 of signup: email a verification link. No password is stored until the
		 * person proves they own the email. The response is the same whether or not
		 * the email already has an account.
		 */
		async signup(input: { name: string; email: string; address: string }) {
			const { name, email } = signupSchema.parse(input);
			await limiter.consume(RATE_LIMITS.signupEmailsPerAddress, input.address);
			await limiter.consume(RATE_LIMITS.signupEmailsPerEmail, email);
			await inTransaction(db, async (tx) => {
				const [existing] = await tx
					.select({ id: users.id })
					.from(users)
					.where(eq(users.email, email));
				if (existing) return;
				if (config.signup === 'invitation' && !(await hasLiveInvitation(tx, email))) return;
				await sendEmailCode(tx, { purpose: 'signup', email, name });
			});
		},

		/** Step 2 of signup: the emailed code plus a chosen password creates the account. */
		activate(input: { token: string; password: string; address: string }) {
			return limiter.limitFailures(
				[[RATE_LIMITS.emailCodeFailuresPerAddress, input.address]],
				async () => {
					const tokenHash = await hashToken(tokenSchema.parse(input.token));
					if (!(await findEmailCode('signup', tokenHash)))
						throw new BusinessError('EMAIL_CODE_INVALID');
					const passwordHash = await prepareNewPassword(input.password);

					await inTransaction(db, async (tx) => {
						const code = await useEmailCode(tx, 'signup', tokenHash);
						if (!code) throw new BusinessError('EMAIL_CODE_INVALID');
						if (config.signup === 'invitation' && !(await hasLiveInvitation(tx, code.email)))
							throw new BusinessError('INVITATION_NO_LONGER_VALID');

						const [user] = await tx
							.insert(users)
							.values({
								email: code.email,
								name: code.name ?? code.email,
								passwordHash,
								emailVerifiedAt: new Date()
							})
							.onConflictDoNothing({ target: users.email })
							.returning({ id: users.id });
						if (!user) throw new BusinessError('EMAIL_CODE_INVALID');

						// Other pending signup links for this email are no longer needed.
						await tx
							.delete(credentialTokens)
							.where(
								and(eq(credentialTokens.email, code.email), eq(credentialTokens.purpose, 'signup'))
							);
						await recordEvent(tx, {
							action: 'user.registered',
							actorId: user.id,
							subjectUserId: user.id,
							target: { type: 'user', id: user.id }
						});
					});
				}
			);
		},

		/** Emails a password reset link to an active account. The response never reveals whether one exists. */
		async requestReset(input: { email: string; address: string }) {
			const email = emailSchema.parse(input.email);
			await limiter.consume(RATE_LIMITS.resetEmailsPerAddress, input.address);
			await limiter.consume(RATE_LIMITS.resetEmailsPerEmail, email);
			await inTransaction(db, async (tx) => {
				const [user] = await tx
					.select({ id: users.id })
					.from(users)
					.where(and(eq(users.email, email), isActiveUser()));
				if (user) await sendEmailCode(tx, { purpose: 'reset', email, userId: user.id });
			});
		},

		/**
		 * Sets a new password using an emailed reset code, then signs the user out
		 * everywhere. It does not sign them in or turn off MFA.
		 */
		resetPassword(input: { token: string; password: string; address: string }) {
			return limiter.limitFailures(
				[[RATE_LIMITS.emailCodeFailuresPerAddress, input.address]],
				async () => {
					const tokenHash = await hashToken(tokenSchema.parse(input.token));
					const pending = await findEmailCode('reset', tokenHash);
					if (!pending?.userId) throw new BusinessError('EMAIL_CODE_INVALID');
					const passwordHash = await prepareNewPassword(input.password);

					await inTransaction(db, async (tx) => {
						// Lock the user before the code and sessions, in the same order as sign-in.
						const user = await lockActiveUser(tx, pending.userId!);
						if (!(await useEmailCode(tx, 'reset', tokenHash)))
							throw new BusinessError('EMAIL_CODE_INVALID');
						await replacePassword(tx, user.id, passwordHash);
					});
				}
			);
		},

		/**
		 * Signs in with email, password and (if enabled) a second-factor code.
		 * `previousToken` is the browser's old session cookie, which is revoked.
		 */
		login(input: {
			email: string;
			password: string;
			code?: string;
			address: string;
			previousToken?: string;
		}) {
			const email = emailSchema.parse(input.email);
			const rules: [RateLimitRule, string][] = [
				[RATE_LIMITS.loginFailuresPerEmailAndAddress, `${email} ${input.address}`],
				[RATE_LIMITS.loginFailuresPerAddress, input.address]
			];

			return limiter.limitFailures(rules, async () => {
				if (!input.password || input.password.length > 128)
					throw new BusinessError('SIGN_IN_FAILED');
				const [user] = await db.select().from(users).where(eq(users.email, email));
				const passwordMatches = await verifyPassword(
					input.password,
					user?.passwordHash ?? (await getUnknownUserHash())
				);
				if (!user || !passwordMatches || user.disabledAt || !user.emailVerifiedAt)
					throw new BusinessError('SIGN_IN_FAILED');

				const token = createRandomToken();
				const tokenHash = await hashToken(token);
				const previousHash = input.previousToken ? await hashToken(input.previousToken) : null;

				return inTransaction(db, async (tx) => {
					const current = await lockActiveUser(tx, user.id);
					// The password may have been reset while we were checking it.
					if (current.passwordHash !== user.passwordHash) throw new BusinessError('SIGN_IN_FAILED');

					const secondFactor = await limiter.limitFailures(
						[[RATE_LIMITS.secondFactorFailuresPerUser, user.id]],
						async () => {
							const result = await verifySecondFactor(tx, box, user.id, input.code ?? '');
							if (result === 'wrong-code') throw new BusinessError('SIGN_IN_FAILED');
							return result;
						}
					);
					const mfaEnabled = secondFactor === 'verified';

					if (previousHash) await revokeOneSession(tx, eq(sessions.tokenHash, previousHash));

					const now = new Date();
					const [session] = await tx
						.insert(sessions)
						.values({
							tokenHash,
							userId: user.id,
							expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000),
							mfaVerifiedAt: mfaEnabled ? now : null,
							authenticatedAt: now,
							lastSeenAt: now
						})
						.returning();
					await recordEvent(tx, {
						action: 'session.created',
						actorId: user.id,
						target: { type: 'session', id: session.id }
					});
					const authUser: AuthUser = {
						id: user.id,
						name: user.name,
						email: user.email,
						avatarColor: user.avatarColor,
						mfaEnabled
					};
					return { token, session, user: authUser };
				});
			});
		},

		/**
		 * Looks up the session for a cookie token on every request. Returns null if the
		 * session is missing, expired, idle too long, belongs to a disabled account, or
		 * skipped a second factor the account now has.
		 */
		async authenticate(
			token: string | undefined
		): Promise<{ user: AuthUser; session: AuthSession } | null> {
			if (!token || !tokenSchema.safeParse(token).success) return null;
			const tokenHash = await hashToken(token);
			const [result] = await db
				.select({
					user: {
						id: users.id,
						name: users.name,
						email: users.email,
						avatarColor: users.avatarColor
					},
					session: sessions,
					mfaEnabledAt: mfaCredentials.enabledAt
				})
				.from(sessions)
				.innerJoin(users, eq(users.id, sessions.userId))
				.leftJoin(mfaCredentials, eq(mfaCredentials.userId, users.id))
				.where(and(eq(sessions.tokenHash, tokenHash), isLiveSession(), isActiveUser()));
			if (!result) return null;
			if (result.mfaEnabledAt && !result.session.mfaVerifiedAt) return null;

			// Record activity at most once a minute, to keep writes low.
			await db
				.update(sessions)
				.set({ lastSeenAt: new Date() })
				.where(
					and(
						eq(sessions.tokenHash, tokenHash),
						lt(sessions.lastSeenAt, new Date(Date.now() - 60_000))
					)
				);
			return {
				user: { ...result.user, mfaEnabled: Boolean(result.mfaEnabledAt) },
				session: result.session
			};
		},

		async logout(tokenHash: string) {
			await inTransaction(db, (tx) => revokeOneSession(tx, eq(sessions.tokenHash, tokenHash)));
		},

		/** The user's live sessions. Never returns token hashes. */
		listSessions(userId: string) {
			return db
				.select({
					id: sessions.id,
					createdAt: sessions.createdAt,
					lastSeenAt: sessions.lastSeenAt,
					expiresAt: sessions.expiresAt
				})
				.from(sessions)
				.where(and(eq(sessions.userId, userId), isLiveSession()));
		},

		async revokeSession(userId: string, sessionId: string) {
			const thisUsersSession = and(eq(sessions.id, sessionId), eq(sessions.userId, userId));
			await inTransaction(db, (tx) => revokeOneSession(tx, thisUsersSession, userId));
		},

		/** Changes the password of a signed-in user, then signs them out everywhere. */
		changePassword(
			userId: string,
			input: { currentPassword: string; password: string; address: string }
		) {
			return limiter.limitFailures(
				[[RATE_LIMITS.confirmationFailuresPerUser, userId]],
				async () => {
					const checked = await checkCurrentPassword(
						db,
						userId,
						input.currentPassword,
						'CURRENT_PASSWORD_INCORRECT'
					);
					const passwordHash = await prepareNewPassword(input.password);
					await inTransaction(db, async (tx) => {
						const user = await lockActiveUser(tx, userId);
						if (user.passwordHash !== checked.passwordHash)
							throw new BusinessError('SESSION_ENDED');
						await replacePassword(tx, userId, passwordHash);
					});
				}
			);
		},

		/**
		 * "Confirm it's you": re-checks the password and second factor so sensitive
		 * actions are allowed for the next few minutes. Replaces the session token but
		 * keeps the original expiry.
		 */
		reauthenticate(userId: string, sessionTokenHash: string, password: string, code: string) {
			return limiter.limitFailures(
				[[RATE_LIMITS.confirmationFailuresPerUser, userId]],
				async () => {
					const checkedUser = await checkCurrentPassword(db, userId, password);
					const token = createRandomToken();
					const tokenHash = await hashToken(token);

					return inTransaction(db, async (tx) => {
						const { session: previous, mfaEnabled } = await confirmStepUp(tx, box, {
							checkedUser,
							sessionTokenHash,
							code
						});
						await revokeOneSession(tx, eq(sessions.tokenHash, sessionTokenHash), userId);
						const now = new Date();
						const [session] = await tx
							.insert(sessions)
							.values({
								tokenHash,
								userId,
								expiresAt: previous.expiresAt,
								authenticatedAt: now,
								lastSeenAt: now,
								mfaVerifiedAt: mfaEnabled ? now : null
							})
							.returning();
						await recordEvent(tx, {
							action: 'session.created',
							actorId: userId,
							target: { type: 'session', id: session.id }
						});
						return { token, session };
					});
				}
			);
		},

		/** Changes the user's display name and avatar colour. */
		async updateProfile(userId: string, input: { name: string; avatarColor: AvatarColor }) {
			const { name, avatarColor } = profileSchema.parse(input);
			await inTransaction(db, async (tx) => {
				const user = await lockActiveUser(tx, userId);
				const changed: ('name' | 'avatarColor')[] = [];
				if (user.name !== name) changed.push('name');
				if (user.avatarColor !== avatarColor) changed.push('avatarColor');
				if (changed.length === 0) return;
				await tx.update(users).set({ name, avatarColor }).where(eq(users.id, userId));
				await recordEvent(tx, {
					action: 'user.profile_updated',
					actorId: userId,
					subjectUserId: userId,
					details: { changed }
				});
			});
		},

		/**
		 * Remembers the firm the user opened, so lines.ws/ returns to it. A navigation
		 * preference, not a consequential change, so it is not audited.
		 */
		async rememberLastFirm(userId: string, firmId: string) {
			await db
				.update(users)
				.set({ lastFirmId: firmId })
				.where(and(eq(users.id, userId), sql`${users.lastFirmId} is distinct from ${firmId}`));
		},

		/** A small summary of the user's own account data (profile, memberships, recent activity). */
		async exportAccount(userId: string) {
			const EVENT_LIMIT = 1000;
			const [profile] = await db
				.select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt })
				.from(users)
				.where(and(eq(users.id, userId), isActiveUser()));
			if (!profile) throw new BusinessError('SIGN_IN_REQUIRED');
			const accountMemberships = await db
				.select({ tenantId: tenants.id, tenantName: tenants.name, role: memberships.role })
				.from(memberships)
				.innerJoin(tenants, eq(tenants.id, memberships.tenantId))
				.where(eq(memberships.userId, userId));
			const events = await db
				.select({
					action: auditEvents.action,
					tenantId: auditEvents.tenantId,
					createdAt: auditEvents.createdAt
				})
				.from(auditEvents)
				.where(or(eq(auditEvents.actorId, userId), eq(auditEvents.subjectUserId, userId)))
				.orderBy(auditEvents.createdAt)
				.limit(EVENT_LIMIT);
			return { profile, memberships: accountMemberships, events, eventsLimitedTo: EVENT_LIMIT };
		},

		/** Deletes expired sessions, codes, abandoned MFA setups and rate-limit counters. Run by the cleanup job. */
		async removeExpiredRecords() {
			const now = new Date();
			await db
				.delete(sessions)
				.where(
					or(
						lt(sessions.expiresAt, now),
						lt(sessions.lastSeenAt, new Date(now.getTime() - IDLE_SECONDS * 1000))
					)
				);
			await db.delete(credentialTokens).where(lt(credentialTokens.expiresAt, now));
			await db
				.delete(mfaCredentials)
				.where(
					and(
						isNull(mfaCredentials.enabledAt),
						lt(mfaCredentials.createdAt, new Date(now.getTime() - 10 * 60_000))
					)
				);
			await limiter.removeExpired();
		}
	};
}
