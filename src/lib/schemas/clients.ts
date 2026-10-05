import { z } from 'zod';
import {
	ACCOUNTING_FRAMEWORKS,
	COMPANY_NUMBER_PATTERN,
	ENTITY_TYPES,
	SIZE_CLASSES,
	keysOf,
	normaliseCompanyNumber
} from '../companies';
import { nameSchema } from './identity';
import { idSchema } from './tenancy';

export const entityTypeSchema = z.enum(keysOf(ENTITY_TYPES));
const frameworkSchema = z.enum(keysOf(ACCOUNTING_FRAMEWORKS));
const sizeClassSchema = z.enum(keysOf(SIZE_CLASSES));

/** A Companies House number, tidied: "sc123456" → "SC123456", "1234" → "00001234". */
export const companyNumberSchema = z
	.string()
	.transform(normaliseCompanyNumber)
	.pipe(z.string().regex(COMPANY_NUMBER_PATTERN, 'Enter an 8-character company number'));

/** An optional form field: an empty input ('') counts as not set (undefined). */
const optional = <T extends z.ZodType<unknown, string | number>>(schema: T) =>
	z
		.union([z.literal(''), schema])
		.optional()
		.transform((value) => (value === '' ? undefined : (value as z.output<T> | undefined)));

/** A day (1–31) or month (1–12), as a number or as text typed into a form. */
const dayOrMonth = (max: number) =>
	z
		.union([
			z.number(),
			z
				.string()
				.regex(/^\d{1,2}$/, 'Choose a valid date')
				.transform(Number)
		])
		.pipe(z.number().int().min(1, 'Choose a valid date').max(max, 'Choose a valid date'));

export const createClientSchema = z.object({ firmId: idSchema, name: nameSchema });

/**
 * Adding an entity. With a company number (and Companies House set up), the details
 * come from Companies House and the name is optional; otherwise name and type are
 * entered by hand.
 */
export const createEntitySchema = z
	.object({
		firmId: idSchema,
		clientId: idSchema,
		companyNumber: optional(companyNumberSchema),
		name: optional(nameSchema),
		entityType: optional(entityTypeSchema)
	})
	.refine((input) => input.companyNumber !== undefined || input.name !== undefined, {
		message: 'Enter a company number or a name',
		path: ['name']
	});

/** Editing an entity's details by hand. */
export const updateEntitySchema = z
	.object({
		firmId: idSchema,
		entityId: idSchema,
		name: nameSchema,
		entityType: entityTypeSchema,
		companyNumber: optional(companyNumberSchema),
		accountingFramework: optional(frameworkSchema),
		sizeClass: optional(sizeClassSchema),
		yearEndDay: optional(dayOrMonth(31)),
		yearEndMonth: optional(dayOrMonth(12))
	})
	.refine((input) => (input.yearEndDay === undefined) === (input.yearEndMonth === undefined), {
		message: 'Enter both the day and month of the year end, or neither',
		path: ['yearEndMonth']
	})
	.refine(
		(input) =>
			input.yearEndDay === undefined ||
			input.yearEndMonth === undefined ||
			input.yearEndDay <= new Date(Date.UTC(2024, input.yearEndMonth, 0)).getUTCDate(),
		{ message: 'That month does not have that many days', path: ['yearEndDay'] }
	);

export const entityScopeSchema = z.object({ firmId: idSchema, entityId: idSchema });

export const companySearchSchema = z.object({
	firmId: idSchema,
	query: z.string().trim().min(2, 'Type at least 2 characters').max(100)
});
