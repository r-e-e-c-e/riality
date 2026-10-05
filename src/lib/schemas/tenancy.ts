import { z } from 'zod';
import { keysOf } from '../companies';
import { HANDLE_PATTERN, isReservedHandle } from '../handles';
import { AUDIT_REGULATORS } from '../staff';
import { emailSchema, nameSchema } from './identity';

export const idSchema = z.uuid();
export const roleSchema = z.enum(['owner', 'admin', 'member']);

export const handleSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(3, 'Use at least 3 characters')
	.max(40, 'Use at most 40 characters')
	.regex(
		HANDLE_PATTERN,
		'Use lowercase letters, numbers and single hyphens, starting with a letter'
	)
	.refine((handle) => !isReservedHandle(handle), 'That handle is reserved. Choose another');

/** Creating a firm. Leave the handle empty to have one suggested from the name. */
export const createFirmSchema = z.object({
	name: nameSchema,
	handle: z
		.union([handleSchema, z.literal('')])
		.optional()
		.default('')
});

export const updateFirmSchema = z.object({
	firmId: idSchema,
	name: nameSchema,
	handle: handleSchema
});

export const membershipSchema = z.object({
	tenantId: idSchema,
	userId: idSchema,
	role: roleSchema.nullable()
});

/**
 * The Settings form for changing someone's access. HTML forms send 'remove' to take
 * them out of the firm; `handle` is where to go if you remove your own access.
 */
export const membershipFormSchema = membershipSchema
	.extend({ role: z.enum([...roleSchema.options, 'remove']), handle: handleSchema })
	.transform((input) => ({ ...input, role: input.role === 'remove' ? null : input.role }));

/**
 * Making someone a Responsible Individual at a firm, or (with no regulator) not one.
 * A regulator needs a start date.
 */
export const responsibleIndividualSchema = z
	.object({
		tenantId: idSchema,
		userId: idSchema,
		auditRegulator: z
			.union([z.literal(''), z.enum(keysOf(AUDIT_REGULATORS))])
			.optional()
			.transform((value) => value || undefined),
		since: z
			.union([z.literal(''), z.iso.date('Enter a valid date')])
			.optional()
			.transform((value) => value || undefined)
	})
	.refine((input) => !input.auditRegulator || input.since, {
		message: 'Enter the date they became a Responsible Individual',
		path: ['since']
	});

export const inviteSchema = z.object({ tenantId: idSchema, email: emailSchema, role: roleSchema });
