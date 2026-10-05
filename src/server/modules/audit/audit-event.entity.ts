import { sql } from 'drizzle-orm';
import { check, index, jsonb, snakeCase, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../../db/columns';
import { users } from '../identity/user.entity';
import { tenants } from '../tenancy/tenant.entity';
import type { MembershipRole } from '../tenancy/membership.entity';
import type { EngagementRole } from '../engagements/team.entity';
import type { EntityRoleKind } from '#lib/people.js';

type NoDetails = Record<string, never>;

/**
 * Every audit action, and the extra facts each one records in `details`.
 * To audit something new, add a line here and call recordEvent() in the same
 * transaction as the change. No migration is needed.
 *
 * Never put passwords, tokens, codes, raw email addresses or financial data in details.
 */
export type AuditDetails = {
	// Accounts and sign-in
	'user.provisioned': NoDetails;
	'user.registered': NoDetails;
	'user.profile_updated': { changed: ('name' | 'avatarColor')[] };
	'user.disabled': { reason: 'offboarding' | 'security_incident'; tenantsWithoutOwner: string[] };
	'password.changed': NoDetails;
	'session.created': NoDetails;
	'session.revoked': { scope: 'one' | 'all' };
	'mfa.enabled': NoDetails;
	'mfa.disabled': NoDetails;
	'mfa.reset': { reason: 'lost_authenticator' };
	'mfa.recovery_codes_replaced': NoDetails;
	'encryption_key.rotated': { mfaCredentials: number; queuedEmails: number };

	// Tenants, memberships and invitations
	'tenant.created': { kind: 'group' | 'firm'; parentId: string | null };
	'tenant.updated': {
		previousName: string;
		name: string;
		previousHandle: string | null;
		handle: string;
	};
	'tenant.moved': { previousParentId: string | null; newParentId: string | null };
	'membership.changed': { previousRole: MembershipRole | null; newRole: MembershipRole };
	'membership.removed': { previousRole: MembershipRole };
	/** recipientFingerprint is a keyed hash of the invited email, so history holds no raw emails. */
	'invitation.created': { role: MembershipRole; recipientFingerprint: string };
	'invitation.accepted': { recipientFingerprint: string };
	'invitation.revoked': { recipientFingerprint: string };

	// Engagement setup
	'client.created': NoDetails;
	'entity.created': { clientId: string; source: 'manual' | 'companies_house' };
	/** `changed` lists field names only, never values. */
	'entity.updated': { changed: string[]; source: 'manual' | 'companies_house' };
	'person.created': { source: 'manual' | 'companies_house' };
	/** `changed` lists field names only, never values. */
	'person.updated': { changed: string[] };
	// Role events target the entity, so its page and history show them.
	'entity_role.added': {
		roleId: string;
		personId: string;
		role: EntityRoleKind;
		source: 'manual' | 'companies_house';
	};
	'entity_role.updated': {
		roleId: string;
		changed: string[];
		source: 'manual' | 'companies_house';
	};
	'entity_role.removed': { roleId: string; personId: string; role: EntityRoleKind };
	'engagement.created': {
		clientId: string;
		entityId: string;
		periodId: string;
		periodStart: string;
		periodEnd: string;
	};
	'engagement.team_changed': {
		previousRole: EngagementRole | null;
		newRole: EngagementRole;
	};
	'engagement.team_removed': { previousRole: EngagementRole };
};

export type AuditAction = keyof AuditDetails;

/** The kind of record an event is about. */
export type AuditTargetType =
	'user' | 'session' | 'tenant' | 'invitation' | 'client' | 'entity' | 'person' | 'engagement';

/**
 * Append-only history of consequential actions. The app may only insert; a trigger
 * blocks updates and deletes (see the security_guards migration).
 */
export const auditEvents = snakeCase.table(
	'audit_event',
	{
		id: id(),
		action: text().$type<AuditAction>().notNull(),

		// Who did it: a signed-in user, or an operator running a command-line script.
		actorId: uuid().references(() => users.id, { onDelete: 'restrict' }),
		operatorName: text(),

		// Where it happened, for showing a firm's or an engagement's history.
		tenantId: uuid().references(() => tenants.id, { onDelete: 'restrict' }),
		engagementId: uuid(),

		// What it affected.
		subjectUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
		targetType: text().$type<AuditTargetType>(),
		targetId: uuid(),
		details: jsonb().$type<Record<string, unknown>>().notNull().default({}),

		// The request that caused it. requestId matches the app logs.
		sessionId: uuid(),
		requestId: uuid(),
		createdAt: createdAt()
	},
	(t) => [
		index('audit_event_tenant_idx').on(t.tenantId, t.createdAt),
		index('audit_event_engagement_idx').on(t.engagementId, t.createdAt),
		index('audit_event_target_idx').on(t.targetType, t.targetId),
		index('audit_event_actor_idx').on(t.actorId),
		index('audit_event_subject_idx').on(t.subjectUserId),
		check(
			'audit_event_has_one_actor',
			sql`(${t.actorId} is not null and ${t.operatorName} is null) or (${t.actorId} is null and ${t.operatorName} is not null and length(trim(${t.operatorName})) > 0)`
		)
	]
);
