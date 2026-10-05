import { addMonths } from './dates';

// Company and entity vocabulary shared by the browser and the server. Each list maps
// the stored value to the label people see.

/** The stored values of a label list, typed for z.enum. */
export function keysOf<T extends Record<string, string>>(labels: T) {
	return Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]];
}

/** Kinds of legal entity the firm audits. Stored on each entity. */
export const ENTITY_TYPES = {
	private_limited: 'Private limited company',
	public_limited: 'Public limited company',
	limited_by_guarantee: 'Company limited by guarantee',
	unlimited_company: 'Unlimited company',
	llp: 'Limited liability partnership',
	limited_partnership: 'Limited partnership',
	partnership: 'Partnership',
	cio: 'Charitable incorporated organisation',
	unincorporated_charity: 'Unincorporated charity',
	registered_society: 'Registered society or co-operative',
	club_or_society: 'Club or society',
	trust: 'Trust',
	other: 'Other'
} as const;
export type EntityType = keyof typeof ENTITY_TYPES;

/** Accounting frameworks used for UK SME financial statements. */
export const ACCOUNTING_FRAMEWORKS = {
	frs102: 'FRS 102',
	frs102_1a: 'FRS 102 Section 1A (small entities)',
	frs105: 'FRS 105 (micro-entities)',
	charities_sorp: 'Charities SORP (FRS 102)',
	ifrs: 'IFRS',
	other: 'Other'
} as const;
export type AccountingFramework = keyof typeof ACCOUNTING_FRAMEWORKS;

/** Companies Act size classification. */
export const SIZE_CLASSES = {
	micro: 'Micro',
	small: 'Small',
	medium: 'Medium',
	large: 'Large'
} as const;
export type SizeClass = keyof typeof SIZE_CLASSES;

/** Companies House register status, in our own words. */
export const COMPANY_STATUSES = {
	active: 'Active',
	dissolved: 'Dissolved',
	liquidation: 'In liquidation',
	administration: 'In administration',
	receivership: 'In receivership',
	voluntary_arrangement: 'Voluntary arrangement',
	insolvency_proceedings: 'Insolvency proceedings',
	closed: 'Closed',
	other: 'Other'
} as const;
export type CompanyStatus = keyof typeof COMPANY_STATUSES;

/**
 * Companies House numbers are 8 characters: digits (England and Wales), or a
 * 2-letter prefix and 6 digits (for example SC123456, OC301234). "1234" → "00001234".
 */
export function normaliseCompanyNumber(value: string) {
	const compact = value.replace(/\s+/g, '').toUpperCase();
	return /^\d{1,7}$/.test(compact) ? compact.padStart(8, '0') : compact;
}
export const COMPANY_NUMBER_PATTERN = /^[A-Z0-9]{8}$/;

/**
 * When a period's accounts are due at Companies House: six months after the year end
 * for public companies, nine for private companies and LLPs. (First accounts can have
 * a different deadline; the register's own date wins where we have it.)
 */
export function accountsDueOn(periodEnd: string, entityType: EntityType) {
	return addMonths(periodEnd, entityType === 'public_limited' ? 6 : 9);
}
