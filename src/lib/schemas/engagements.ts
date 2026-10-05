import { z } from 'zod';
import { idSchema } from './tenancy';

export const engagementScopeSchema = z.object({ firmId: idSchema, engagementId: idSchema });
export const createEngagementSchema = z
	.object({
		firmId: idSchema,
		entityId: idSchema,
		periodStart: z.iso.date(),
		periodEnd: z.iso.date()
	})
	.refine((input) => input.periodStart <= input.periodEnd, {
		message: 'Period end must be on or after period start',
		path: ['periodEnd']
	});
export const engagementRoleSchema = z.enum(['auditor', 'manager', 'partner']);
export const teamAssignmentSchema = engagementScopeSchema.extend({
	userId: idSchema,
	role: engagementRoleSchema.nullable()
});
/** HTML forms send 'remove' to take someone off the team. */
export const teamAssignmentFormSchema = engagementScopeSchema
	.extend({
		userId: idSchema,
		role: z.enum([...engagementRoleSchema.options, 'remove'])
	})
	.transform((input) => ({ ...input, role: input.role === 'remove' ? null : input.role }));
