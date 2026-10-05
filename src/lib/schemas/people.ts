import { z } from 'zod';
import { ENTITY_ROLES, PERSON_KINDS } from '../people';
import { keysOf } from '../companies';
import { optional } from './clients';
import { emailSchema, nameSchema } from './identity';
import { idSchema } from './tenancy';

export const personKindSchema = z.enum(keysOf(PERSON_KINDS));
export const entityRoleSchema = z.enum(keysOf(ENTITY_ROLES));

const dateSchema = z.iso.date('Enter a valid date');
const phoneSchema = z
	.string()
	.trim()
	.regex(/^[0-9+()\s-]{6,40}$/, 'Enter a valid phone number');
/** A percentage above 0 and up to 100, with at most two decimal places. */
const percentSchema = z
	.union([
		z.number(),
		z
			.string()
			.trim()
			.regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a percentage')
			.transform(Number)
	])
	.pipe(z.number().gt(0, 'Enter a percentage above 0').max(100, 'Enter 100 or less'));

/** The dates and shareholding of a role, shared by adding and editing one. */
const roleDetails = {
	startedOn: optional(dateSchema),
	endedOn: optional(dateSchema),
	shareholdingPercent: optional(percentSchema)
};

function datesInOrder(input: { startedOn?: string; endedOn?: string }) {
	return !input.startedOn || !input.endedOn || input.endedOn >= input.startedOn;
}
const datesMessage = {
	message: 'The end date must be on or after the start date',
	path: ['endedOn']
};

/** Adding a role at an entity, for an existing person (personId) or a new one (name and kind). */
export const addRoleSchema = z
	.object({
		firmId: idSchema,
		entityId: idSchema,
		personId: optional(idSchema),
		name: optional(nameSchema),
		kind: optional(personKindSchema),
		role: entityRoleSchema,
		...roleDetails
	})
	.refine((input) => input.personId !== undefined || input.name !== undefined, {
		message: 'Choose a person or enter a new name',
		path: ['name']
	})
	.refine(datesInOrder, datesMessage)
	.refine((input) => input.shareholdingPercent === undefined || input.role === 'shareholder', {
		message: 'Only shareholders have a shareholding',
		path: ['shareholdingPercent']
	});

/** Editing a role's dates and shareholding. */
export const updateRoleSchema = z
	.object({ firmId: idSchema, roleId: idSchema, ...roleDetails })
	.refine(datesInOrder, datesMessage);

export const roleScopeSchema = z.object({ firmId: idSchema, roleId: idSchema });
export const personScopeSchema = z.object({ firmId: idSchema, personId: idSchema });

/** Editing a person's name and contact details. */
export const updatePersonSchema = z.object({
	firmId: idSchema,
	personId: idSchema,
	name: nameSchema,
	email: optional(emailSchema),
	phone: optional(phoneSchema)
});
