import { eq } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError } from '../../errors';
import { recordEvent } from '../audit/audit-event.service';
import { createRandomToken, createSecretBox, hashToken } from './identity.crypto';
import type { IdentityConfig } from './identity.service';
import {
	checkCurrentPassword,
	confirmStepUp,
	decryptMfaSecret,
	mfaSecretContext,
	lockActiveUser,
	revokeAllSessions
} from './identity.shared';
import { mfaCredentials, recoveryCodes } from './mfa.entity';
import { RATE_LIMITS, createRateLimiter } from './rate-limit.service';
import { encodeBase32, verifyTotp } from './totp';

const SETUP_MINUTES = 10;
const RECOVERY_CODE_COUNT = 10;

/** Ten random codes, each 22 base64url characters (132 bits). */
function createRecoveryCodes() {
	return Array.from({ length: RECOVERY_CODE_COUNT }, () => createRandomToken().slice(0, 22));
}

async function replaceRecoveryCodes(tx: Transaction, userId: string, codes: string[]) {
	await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
	const rows = await Promise.all(
		codes.map(async (code) => ({ userId, codeHash: await hashToken(code) }))
	);
	await tx.insert(recoveryCodes).values(rows);
}

/**
 * Authenticator app (TOTP) setup and removal. Every change here signs the user out
 * of all sessions, so they sign in again with the new settings.
 */
export function createMfaService(
	db: Database,
	config: Pick<IdentityConfig, 'encryptionKey' | 'requireMfa'>
) {
	const box = createSecretBox(config.encryptionKey);
	const limiter = createRateLimiter(db, config.encryptionKey);

	return {
		/** Starts setup: creates a new secret and returns it for the authenticator app (as text and an otpauth:// link). */
		async begin(userId: string) {
			return inTransaction(db, async (tx) => {
				const user = await lockActiveUser(tx, userId);
				const [existing] = await tx
					.select()
					.from(mfaCredentials)
					.where(eq(mfaCredentials.userId, userId));
				if (existing?.enabledAt) throw new BusinessError('MFA_ALREADY_ENABLED');

				const secret = crypto.getRandomValues(new Uint8Array(20));
				const encryptedSecret = await box.encrypt(
					Buffer.from(secret).toString('base64'),
					mfaSecretContext(userId)
				);
				await tx
					.insert(mfaCredentials)
					.values({ userId, encryptedSecret })
					.onConflictDoUpdate({
						target: mfaCredentials.userId,
						set: { encryptedSecret, createdAt: new Date(), lastStep: -1 }
					});

				const encoded = encodeBase32(secret);
				const label = encodeURIComponent(`Lines:${user.email}`);
				return {
					secret: encoded,
					uri: `otpauth://totp/${label}?secret=${encoded}&issuer=Lines&algorithm=SHA1&digits=6&period=30`
				};
			});
		},

		/** Finishes setup with a first code from the app. Returns recovery codes, shown to the user once. */
		confirm(userId: string, code: string) {
			return limiter.limitFailures([[RATE_LIMITS.confirmationFailuresPerUser, userId]], () =>
				inTransaction(db, async (tx) => {
					await lockActiveUser(tx, userId);
					const [credential] = await tx
						.select()
						.from(mfaCredentials)
						.where(eq(mfaCredentials.userId, userId))
						.for('update');
					const setupExpired =
						!credential || credential.createdAt.getTime() < Date.now() - SETUP_MINUTES * 60_000;
					if (!credential || credential.enabledAt || setupExpired)
						throw new BusinessError('MFA_SETUP_EXPIRED');

					const secret = await decryptMfaSecret(box, credential.encryptedSecret, userId);
					const step = await verifyTotp(secret, code, credential.lastStep);
					if (step === null) throw new BusinessError('AUTHENTICATOR_CODE_INCORRECT');

					await tx
						.update(mfaCredentials)
						.set({ enabledAt: new Date(), lastStep: step })
						.where(eq(mfaCredentials.userId, userId));
					const codes = createRecoveryCodes();
					await replaceRecoveryCodes(tx, userId, codes);
					await revokeAllSessions(tx, userId);
					await recordEvent(tx, {
						action: 'mfa.enabled',
						actorId: userId,
						subjectUserId: userId
					});
					return codes;
				})
			);
		},

		/** Replaces all recovery codes. Needs the password and a current code. */
		replaceRecoveryCodes(userId: string, sessionTokenHash: string, password: string, code: string) {
			return limiter.limitFailures(
				[[RATE_LIMITS.confirmationFailuresPerUser, userId]],
				async () => {
					const checkedUser = await checkCurrentPassword(db, userId, password);
					return inTransaction(db, async (tx) => {
						const { mfaEnabled } = await confirmStepUp(tx, box, {
							checkedUser,
							sessionTokenHash,
							code
						});
						if (!mfaEnabled) throw new BusinessError('MFA_NOT_ENABLED');
						const codes = createRecoveryCodes();
						await replaceRecoveryCodes(tx, userId, codes);
						await revokeAllSessions(tx, userId);
						await recordEvent(tx, {
							action: 'mfa.recovery_codes_replaced',
							actorId: userId,
							subjectUserId: userId
						});
						return codes;
					});
				}
			);
		},

		/** Turns MFA off. Only allowed where MFA is optional (local development). */
		async disable(userId: string, sessionTokenHash: string, password: string, code: string) {
			if (config.requireMfa) throw new BusinessError('MFA_CANNOT_BE_DISABLED');
			await limiter.limitFailures([[RATE_LIMITS.confirmationFailuresPerUser, userId]], async () => {
				const checkedUser = await checkCurrentPassword(db, userId, password);
				await inTransaction(db, async (tx) => {
					const { mfaEnabled } = await confirmStepUp(tx, box, {
						checkedUser,
						sessionTokenHash,
						code
					});
					if (!mfaEnabled) throw new BusinessError('MFA_NOT_ENABLED');
					await tx.delete(mfaCredentials).where(eq(mfaCredentials.userId, userId));
					await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
					await revokeAllSessions(tx, userId);
					await recordEvent(tx, {
						action: 'mfa.disabled',
						actorId: userId,
						subjectUserId: userId
					});
				});
			});
		}
	};
}
