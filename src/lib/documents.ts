// Document vocabulary shared by the browser and the server.

/**
 * Sections of an entity's permanent file: documents of lasting importance that every
 * year's audit refers back to.
 */
export const DOCUMENT_CATEGORIES = {
	constitution: 'Incorporation and constitution',
	ownership: 'Ownership and group structure',
	governance: 'Board minutes and resolutions',
	agreements: 'Key contracts and agreements',
	financing: 'Loans and financing',
	property: 'Property and leases',
	tax: 'Tax and registrations',
	engagement: 'Engagement letters',
	other: 'Other'
} as const;
export type DocumentCategory = keyof typeof DOCUMENT_CATEGORIES;

/** The largest file that can be uploaded. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * File types that can be uploaded, by extension, with the content type we store and
 * send back. Anything else is refused.
 */
export const DOCUMENT_TYPES = {
	pdf: { contentType: 'application/pdf', label: 'PDF' },
	docx: {
		contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		label: 'Word'
	},
	doc: { contentType: 'application/msword', label: 'Word' },
	xlsx: {
		contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		label: 'Excel'
	},
	xls: { contentType: 'application/vnd.ms-excel', label: 'Excel' },
	csv: { contentType: 'text/csv', label: 'CSV' },
	msg: { contentType: 'application/vnd.ms-outlook', label: 'Outlook email' },
	png: { contentType: 'image/png', label: 'Image' },
	jpg: { contentType: 'image/jpeg', label: 'Image' },
	jpeg: { contentType: 'image/jpeg', label: 'Image' }
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

/** For the file input's `accept` attribute. */
export const ACCEPTED_EXTENSIONS = Object.keys(DOCUMENT_TYPES)
	.map((extension) => `.${extension}`)
	.join(',');

/** The lower-case extension of a file name, if it is one we accept. */
export function documentTypeOf(fileName: string): DocumentType | null {
	const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
	return extension in DOCUMENT_TYPES ? (extension as DocumentType) : null;
}

/** "1.2 MB", "340 KB". */
export function formatFileSize(bytes: number) {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
