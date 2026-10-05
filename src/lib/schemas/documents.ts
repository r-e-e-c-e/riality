import { z } from 'zod';
import { keysOf } from '../companies';
import { DOCUMENT_CATEGORIES, MAX_DOCUMENT_BYTES } from '../documents';
import { optional } from './clients';
import { idSchema } from './tenancy';

/**
 * An uploaded file. SvelteKit passes its own File-like object (not a real `File`), so
 * this checks what we use (a name, a size and readable contents) rather than the class.
 */
const uploadedFileSchema = z
	.custom<File>(
		(value) =>
			typeof value === 'object' &&
			value !== null &&
			typeof (value as File).name === 'string' &&
			typeof (value as File).size === 'number' &&
			typeof (value as File).arrayBuffer === 'function',
		'Choose a file'
	)
	.refine((file) => file.size > 0, 'The file is empty')
	.refine((file) => file.size <= MAX_DOCUMENT_BYTES, 'Files can be up to 25 MB');

/** Uploading a file to an entity's permanent file. Without a title, the file name is used. */
export const uploadDocumentSchema = z.object({
	firmId: idSchema,
	entityId: idSchema,
	category: z.enum(keysOf(DOCUMENT_CATEGORIES)),
	title: optional(z.string().trim().min(1).max(200)),
	file: uploadedFileSchema
});

export const documentScopeSchema = z.object({ firmId: idSchema, documentId: idSchema });
