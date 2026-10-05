import { and, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError, notFound } from '../../errors';
import { emailSchema, nameSchema } from '#lib/schemas/identity.js';
import { idSchema } from '#lib/schemas/tenancy.js';
import { recordEvent } from '../audit/audit-event.service';
import { mailOutbox } from '../notifications/mail.entity';
import { invitations } from '../tenancy/invitation.entity';
import { memberships } from '../tenancy/membership.entity';
import { activeOwnerIds, lockTenancyAdministration } from '../tenancy/tenancy-access';
import { credentialTokens } from './credential-token.entity';
import { createSecretBox } from './identity.crypto';
import { mfaSecretContext, revokeAllSessions } from './identity.shared';
import { mfaCredentials, recoveryCodes } from './mfa.entity';
import { rateLimits } from './rate-limit.entity';
import { isActiveUser, users } from './user.entity';

type Operator = { name: string };

/**
 * Support and incident actions run by an operator from the command line (see
 * scripts/). They are never exposed in the web app. Each one is recorded in the
 * audit history with the operator's name instead of a user ID.
 */
export function createIdentityAdministrationService(db: Database) {
	return {
		/**
		 * Blocks an account: revokes sessions, pending codes and invitations, but keeps
		 * memberships and history. 'offboarding' refuses if the user is a tenant's only
		 * owner; 'security_incident' always proceeds, and returns the tenants that now
		 * need a new owner.
		 */
		async disableUser(
			userId: string,
			operator: Operator,
			reason: 'offboarding' | 'security_incident'
		) {
			const id = idSchema.parse(userId);
			const operatorName = nameSchema.parse(operator.name);
			const validReason = z.enum(['offboarding', 'security_incident']).parse(reason);

			return inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
				if (!user) throw notFound('Account');

				const ownedTenants = await tx
					.select({ tenantId: memberships.tenantId })
					.from(memberships)
					.where(and(eq(memberships.userId, id), eq(memberships.role, 'owner')));
				const tenantsWithoutOwner: string[] = [];
				for (const { tenantId } of ownedTenants) {
					const owners = await activeOwnerIds(tx, tenantId);
					if (!owners.some((ownerId) => ownerId !== id)) tenantsWithoutOwner.push(tenantId);
				}
				if (tenantsWithoutOwner.length > 0 && validReason === 'offboarding')
					throw new BusinessError('SOLE_OWNER');

				await tx
					.update(users)
					.set({ disabledAt: user.disabledAt ?? new Date() })
					.where(eq(users.id, id));
				await revokeAllSessions(tx, id, { operatorName });
				await tx
					.delete(credentialTokens)
					.where(or(eq(credentialTokens.userId, id), eq(credentialTokens.email, user.email)));
				await tx
					.delete(invitations)
					.where(or(eq(invitations.invitedBy, id), eq(invitations.email, user.email)));
				await recordEvent(tx, {
					action: 'user.disabled',
					operatorName,
					subjectUserId: id,
					target: { type: 'user', id },
					details: { reason: validReason, tenantsWithoutOwner }
				});
				return { userId: id, tenantsRequiringOwner: tenantsWithoutOwner };
			});
		},

		/**
		 * Removes a user's authenticator and recovery codes after they lost both, and
		 * signs them out. Only run this after verifying the person's identity through a
		 * separate, trusted channel. Where MFA is required they must set it up again at
		 * their next sign-in.
		 */
		async resetMfa(email: string, operator: Operator) {
			const normalizedEmail = emailSchema.parse(email);
			const operatorName = nameSchema.parse(operator.name);

			return inTransaction(db, async (tx) => {
				const [user] = await tx
					.select({ id: users.id })
					.from(users)
					.where(and(eq(users.email, normalizedEmail), isActiveUser()))
					.for('update');
				if (!user) throw notFound('Active account');

				const removed = await tx
					.delete(mfaCredentials)
					.where(eq(mfaCredentials.userId, user.id))
					.returning();
				if (removed.length === 0) throw new BusinessError('MFA_NOT_SET_UP');
				await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
				await revokeAllSessions(tx, user.id, { operatorName });
				await recordEvent(tx, {
					action: 'mfa.reset',
					operatorName,
					subjectUserId: user.id,
					target: { type: 'user', id: user.id },
					details: { reason: 'lost_authenticator' }
				});
				return { userId: user.id };
			});
		},

		/**
		 * Re-encrypts every MFA secret and queued email with a new key, all in one
		 * transaction. Stop the app first; then switch AUTH_ENCRYPTION_KEY everywhere.
		 */
		async rotateEncryptionKey(oldKey: string, nextKey: string, operator: Operator) {
			if (oldKey === nextKey) throw new Error('New encryption key must differ');
			const oldBox = createSecretBox(oldKey);
			const nextBox = createSecretBox(nextKey);
			const operatorName = nameSchema.parse(operator.name);

			return inTransaction(db, async (tx) => {
				// Block any writes to these tables until the rotation commits.
				await tx.execute(
					sql`lock table mfa_credential, mail_outbox, rate_limit in access exclusive mode`
				);

				const credentials = await tx.select().from(mfaCredentials);
				for (const credential of credentials) {
					const context = mfaSecretContext(credential.userId);
					const secret = await oldBox.decrypt(credential.encryptedSecret, context);
					await tx
						.update(mfaCredentials)
						.set({ encryptedSecret: await nextBox.encrypt(secret, context) })
						.where(eq(mfaCredentials.userId, credential.userId));
				}

				const queuedEmails = await tx.select().from(mailOutbox);
				for (const email of queuedEmails) {
					const context = `mail:${email.id}`;
					const message = await oldBox.decrypt(email.encryptedMessage, context);
					await tx
						.update(mailOutbox)
						.set({ encryptedMessage: await nextBox.encrypt(message, context) })
						.where(eq(mailOutbox.id, email.id));
				}

				// Rate-limit keys are fingerprints made with the old key, so they no longer match.
				await tx.delete(rateLimits);
				const counts = { mfaCredentials: credentials.length, queuedEmails: queuedEmails.length };
				await recordEvent(tx, { action: 'encryption_key.rotated', operatorName, details: counts });
				return counts;
			});
		}
	};
}
