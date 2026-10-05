import type { Transaction } from '../../db/connection';
import { getRequestContext } from '../../request-context';
import {
	auditEvents,
	type AuditAction,
	type AuditDetails,
	type AuditTargetType
} from './audit-event.entity';

/** Who did it: a signed-in user, or an operator running a command-line script. */
export type AuditActor =
	{ actorId: string; operatorName?: never } | { operatorName: string; actorId?: never };

// Actions with no details may leave `details` out; every other action must include them.
type DetailsFor<Action extends AuditAction> =
	AuditDetails[Action] extends Record<string, never>
		? { details?: AuditDetails[Action] }
		: { details: AuditDetails[Action] };

type AuditEvent<Action extends AuditAction> = AuditActor &
	DetailsFor<Action> & {
		action: Action;
		tenantId?: string | null;
		engagementId?: string;
		subjectUserId?: string;
		/** The main record the action created or changed, when it has its own ID. */
		target?: { type: AuditTargetType; id: string };
	};

/**
 * Records an audit event. Always pass the transaction that makes the change, so the
 * change and its audit record are saved together or not at all.
 * The current request and session IDs are added automatically.
 */
export async function recordEvent<Action extends AuditAction>(
	tx: Transaction,
	event: AuditEvent<Action>
) {
	const request = getRequestContext();
	await tx.insert(auditEvents).values({
		action: event.action,
		actorId: event.actorId ?? null,
		operatorName: event.operatorName ?? null,
		tenantId: event.tenantId ?? null,
		engagementId: event.engagementId ?? null,
		subjectUserId: event.subjectUserId ?? null,
		targetType: event.target?.type ?? null,
		targetId: event.target?.id ?? null,
		details: event.details ?? {},
		sessionId: request?.sessionId ?? null,
		requestId: request?.requestId ?? null
	});
}
