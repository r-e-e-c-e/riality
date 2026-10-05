import type { AuditAction, AuditTargetType } from '#server/modules/audit/audit-event.entity.js';

/**
 * A change someone made, as the live-updates stream sends it to browser windows.
 * IDs only: windows use it to decide which of their queries to fetch again.
 */
export type Change = {
	action: AuditAction;
	tenantId: string | null;
	engagementId: string | null;
	subjectUserId: string | null;
	targetType: AuditTargetType | null;
	targetId: string | null;
};
