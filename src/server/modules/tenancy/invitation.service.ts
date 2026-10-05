import { and, eq, gt, lt } from 'drizzle-orm';
import type { Config } from '../../config';
import type { Database } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError } from '../../errors';
import { tokenSchema } from '#lib/schemas/identity.js';
import { idSchema, inviteSchema } from '#lib/schemas/tenancy.js';
import { recordEvent } from '../audit/audit-event.service';
import { createRandomToken, createSecretBox, hashToken } from '../identity/identity.crypto';
import { RATE_LIMITS, createRateLimiter } from '../identity/rate-limit.service';
import { isActiveUser, users } from '../identity/user.entity';
import { createMailService } from '../notifications/mail.service';
import { invitations } from './invitation.entity';
import { memberships, type MembershipRole } from './membership.entity';
import {
	OWNER,
	OWNER_OR_ADMIN,
	lockTenancyAdministration,
	requireTenantRole,
	type Actor
} from './tenancy-access';

const INVITATION_DAYS = 7;

/**
 * Invitations to join a tenant, sent by owners and admins (only owners can invite an
 * owner). An invitation alone grants nothing: accepting needs the invited, verified
 * email, and the inviter must still be allowed to grant that role at that moment.
 */
export function createInvitationService(
	db: Database,
	config: Pick<Config, 'origin' | 'encryptionKey'>
) {
	const mail = createMailService(db, config.encryptionKey);
	const limiter = createRateLimiter(db, config.encryptionKey);
	const box = createSecretBox(config.encryptionKey);

	/** A keyed hash of the invited email, so audit history never stores the raw address. */
	const recipientFingerprint = (email: string) => box.fingerprint(`invitation-recipient:${email}`);

	return {
		/** Invites an email to the tenant. Inviting the same email again replaces the old link. */
		async invite(actor: Actor, input: { tenantId: string; email: string; role: MembershipRole }) {
			const values = inviteSchema.parse(input);
			await limiter.consume(RATE_LIMITS.invitationsPerUser, actor.id);

			return inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				// Owners and admins can invite; only owners can invite another owner.
				const { tenant } = await requireTenantRole(
					tx,
					actor,
					values.tenantId,
					values.role === 'owner' ? OWNER : OWNER_OR_ADMIN
				);
				const code = createRandomToken();
				const tokenHash = await hashToken(code);
				const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60_000);

				const [invitation] = await tx
					.insert(invitations)
					.values({ ...values, invitedBy: actor.id, tokenHash, expiresAt })
					.onConflictDoUpdate({
						target: [invitations.tenantId, invitations.email],
						set: {
							role: values.role,
							invitedBy: actor.id,
							tokenHash,
							expiresAt,
							createdAt: new Date()
						}
					})
					.returning({ id: invitations.id });

				await mail.enqueue(
					tx,
					{
						to: values.email,
						subject: 'Invitation to Lines',
						text: [
							`You have been invited to ${tenant.name} on Lines. Sign up or sign in using this email, then open:`,
							`${config.origin}/invite#${code}`,
							'',
							`Code: ${code}`,
							`This invitation expires in ${INVITATION_DAYS} days. Ignore it if unexpected.`
						].join('\n')
					},
					expiresAt
				);
				await recordEvent(tx, {
					action: 'invitation.created',
					actorId: actor.id,
					tenantId: values.tenantId,
					target: { type: 'invitation', id: invitation.id },
					details: {
						role: values.role,
						recipientFingerprint: await recipientFingerprint(values.email)
					}
				});
				return invitation;
			});
		},

		/** Live invitations for a tenant (owners and admins). */
		async list(actor: Actor, tenantId: string) {
			const id = idSchema.parse(tenantId);
			await requireTenantRole(db, actor, id, OWNER_OR_ADMIN);
			return db
				.select({
					id: invitations.id,
					email: invitations.email,
					role: invitations.role,
					expiresAt: invitations.expiresAt
				})
				.from(invitations)
				.where(and(eq(invitations.tenantId, id), gt(invitations.expiresAt, new Date())));
		},

		async revoke(actor: Actor, tenantId: string, invitationId: string) {
			const validTenantId = idSchema.parse(tenantId);
			const validInvitationId = idSchema.parse(invitationId);
			await inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				const { role: actorRole } = await requireTenantRole(
					tx,
					actor,
					validTenantId,
					OWNER_OR_ADMIN
				);
				const [revoked] = await tx
					.delete(invitations)
					.where(
						and(eq(invitations.id, validInvitationId), eq(invitations.tenantId, validTenantId))
					)
					.returning();
				if (!revoked) return;
				// Admins cannot cancel an owner invitation.
				if (revoked.role === 'owner' && actorRole !== 'owner')
					throw new BusinessError('OWNER_REQUIRED');
				await recordEvent(tx, {
					action: 'invitation.revoked',
					actorId: actor.id,
					tenantId: validTenantId,
					target: { type: 'invitation', id: revoked.id },
					details: { recipientFingerprint: await recipientFingerprint(revoked.email) }
				});
			});
		},

		/**
		 * Accepts an invitation with the emailed code. The signed-in user's email must
		 * match. An existing membership is kept as it is, never changed by an old invitation.
		 */
		async accept(actor: Actor, code: string) {
			const tokenHash = await hashToken(tokenSchema.parse(code));
			return inTransaction(db, async (tx) => {
				await lockTenancyAdministration(tx);
				const [user] = await tx
					.select({ email: users.email })
					.from(users)
					.where(and(eq(users.id, actor.id), isActiveUser()));
				const [invitation] = await tx
					.select()
					.from(invitations)
					.where(and(eq(invitations.tokenHash, tokenHash), gt(invitations.expiresAt, new Date())));
				if (!user || !invitation || invitation.email !== user.email)
					throw new BusinessError('INVITATION_INVALID');

				// If the inviter can no longer grant this role, the invitation is no longer valid.
				await requireTenantRole(
					tx,
					{ id: invitation.invitedBy },
					invitation.tenantId,
					invitation.role === 'owner' ? OWNER : OWNER_OR_ADMIN
				).catch(() => {
					throw new BusinessError('INVITATION_NO_LONGER_VALID');
				});

				const [added] = await tx
					.insert(memberships)
					.values({ tenantId: invitation.tenantId, userId: actor.id, role: invitation.role })
					.onConflictDoNothing()
					.returning();
				await tx.delete(invitations).where(eq(invitations.id, invitation.id));

				await recordEvent(tx, {
					action: 'invitation.accepted',
					actorId: actor.id,
					tenantId: invitation.tenantId,
					subjectUserId: actor.id,
					target: { type: 'invitation', id: invitation.id },
					details: { recipientFingerprint: await recipientFingerprint(invitation.email) }
				});
				if (added) {
					await recordEvent(tx, {
						action: 'membership.changed',
						actorId: actor.id,
						tenantId: invitation.tenantId,
						subjectUserId: actor.id,
						details: { previousRole: null, newRole: invitation.role }
					});
				}
				return { tenantId: invitation.tenantId };
			});
		},

		/** Deletes expired invitations. Run by the cleanup job. */
		async removeExpired() {
			await db.delete(invitations).where(lt(invitations.expiresAt, new Date()));
		}
	};
}
