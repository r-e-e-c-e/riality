import { and, eq, gt, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/connection';
import { BusinessError } from '../../errors';
import { recordEvent, type AuditActor } from '../audit/audit-event.service';
import { credentialTokens } from './credential-token.entity';
import { hashToken, type SecretBox } from './identity.crypto';
import { mfaCredentials, recoveryCodes } from './mfa.entity';
import { verifyPassword } from './passwords';
import { sessions } from './session.entity';
import { verifyTotp } from './totp';
import { isActiveUser, users } from './user.entity';

// Small steps shared by the identity and MFA services.

/** Sessions end 7 days after sign-in at the latest. */
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
/** Sessions also end after 30 minutes without a request. */
export const IDLE_SECONDS = 30 * 60;
/** Sensitive actions need a password entered within this many minutes. */
export const RECENT_SIGN_IN_MINUTES = 10;

/** SQL condition: the session has not expired and has not been idle too long. */
export function isLiveSession() {
	return and(
		gt(sessions.expiresAt, new Date()),
		gt(sessions.lastSeenAt, new Date(Date.now() - IDLE_SECONDS * 1000))
	);
}

/** Locks the user's row until the transaction ends. Throws 401 if the account is disabled or unverified. */
export async function lockActiveUser(tx: Transaction, userId: string) {
	const [user] = await tx
		.select()
		.from(users)
		.where(and(eq(users.id, userId), isActiveUser()))
		.for('update');
	if (!user) throw new BusinessError('SIGN_IN_REQUIRED');
	return user;
}

/** Locks one of the user's live sessions. Throws 401 if it has ended or been revoked. */
async function lockLiveSession(tx: Transaction, userId: string, tokenHash: string) {
	const [session] = await tx
		.select()
		.from(sessions)
		.where(and(eq(sessions.tokenHash, tokenHash), eq(sessions.userId, userId), isLiveSession()))
		.for('update');
	if (!session) throw new BusinessError('SESSION_ENDED');
	return session;
}

/** Signs out one session matching `where` and records it. Returns the session, if there was one. */
export async function revokeOneSession(tx: Transaction, where: SQL | undefined, actorId?: string) {
	const [revoked] = await tx.delete(sessions).where(where).returning();
	if (revoked) {
		await recordEvent(tx, {
			action: 'session.revoked',
			actorId: actorId ?? revoked.userId,
			target: { type: 'session', id: revoked.id },
			details: { scope: 'one' }
		});
	}
	return revoked;
}

/** Signs the user out everywhere. `by` defaults to the user themselves. */
export async function revokeAllSessions(
	tx: Transaction,
	userId: string,
	by: AuditActor = { actorId: userId }
) {
	const revoked = await tx.delete(sessions).where(eq(sessions.userId, userId)).returning();
	if (revoked.length > 0) {
		await recordEvent(tx, {
			action: 'session.revoked',
			...by,
			subjectUserId: userId,
			details: { scope: 'all' }
		});
	}
}

/** Sets a new password, cancels pending reset links and signs the user out everywhere. */
export async function replacePassword(tx: Transaction, userId: string, passwordHash: string) {
	await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
	await tx.delete(credentialTokens).where(eq(credentialTokens.userId, userId));
	await revokeAllSessions(tx, userId);
	await recordEvent(tx, { action: 'password.changed', actorId: userId, subjectUserId: userId });
}

/** The encryption context for a user's MFA secret, so it only decrypts for that user. */
export function mfaSecretContext(userId: string) {
	return `mfa:${userId}`;
}

export async function decryptMfaSecret(box: SecretBox, encryptedSecret: string, userId: string) {
	return Buffer.from(await box.decrypt(encryptedSecret, mfaSecretContext(userId)), 'base64');
}

/**
 * Checks a signed-in user's current password. Runs outside transactions because
 * Argon2 is deliberately slow. Returns the user so the caller can later confirm,
 * inside its transaction, that the password has not changed in the meantime.
 */
export async function checkCurrentPassword(
	db: Database,
	userId: string,
	password: string,
	failure: 'CONFIRMATION_FAILED' | 'CURRENT_PASSWORD_INCORRECT' = 'CONFIRMATION_FAILED'
) {
	const [user] = await db.select().from(users).where(eq(users.id, userId));
	const valid = user ? await verifyPassword(password, user.passwordHash) : false;
	if (!user || !valid) throw new BusinessError(failure);
	return user;
}

/**
 * Checks an authenticator code or an unused recovery code.
 * - 'not-enabled': the user has no MFA, so there is nothing to check
 * - 'verified': the code was correct (a recovery code is used up)
 * - 'wrong-code': the code was wrong; callers throw their own 401 error
 */
export async function verifySecondFactor(
	tx: Transaction,
	box: SecretBox,
	userId: string,
	code: string
): Promise<'not-enabled' | 'verified' | 'wrong-code'> {
	const [credential] = await tx
		.select()
		.from(mfaCredentials)
		.where(eq(mfaCredentials.userId, userId))
		.for('update');
	if (!credential?.enabledAt) return 'not-enabled';

	const secret = await decryptMfaSecret(box, credential.encryptedSecret, userId);
	const step = await verifyTotp(secret, code, credential.lastStep);
	if (step !== null) {
		// Remember the step so the same code cannot be used again.
		await tx
			.update(mfaCredentials)
			.set({ lastStep: step })
			.where(eq(mfaCredentials.userId, userId));
		return 'verified';
	}

	const [usedRecoveryCode] = await tx
		.delete(recoveryCodes)
		.where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, await hashToken(code))))
		.returning();
	return usedRecoveryCode ? 'verified' : 'wrong-code';
}

/**
 * The checks before a sensitive change made by a signed-in user ("step-up"): the
 * account is still active, the password has not changed since `checkedUser` was
 * loaded, the session is still live, and the second factor (if enabled) is correct.
 */
export async function confirmStepUp(
	tx: Transaction,
	box: SecretBox,
	input: {
		checkedUser: { id: string; passwordHash: string };
		sessionTokenHash: string;
		code: string;
	}
) {
	const userId = input.checkedUser.id;
	const user = await lockActiveUser(tx, userId);
	if (user.passwordHash !== input.checkedUser.passwordHash)
		throw new BusinessError('SESSION_ENDED');
	const session = await lockLiveSession(tx, userId, input.sessionTokenHash);
	const secondFactor = await verifySecondFactor(tx, box, userId, input.code);
	if (secondFactor === 'wrong-code') throw new BusinessError('CONFIRMATION_FAILED');
	return { user, session, mfaEnabled: secondFactor === 'verified' };
}
