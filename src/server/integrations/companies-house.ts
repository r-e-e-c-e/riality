import { z } from 'zod';
import type { CompanyStatus, EntityType } from '#lib/companies.js';
import { BusinessError } from '../errors';
import { logger } from '../logger';

// Companies House public data API. Responses are checked and mapped into our own
// CompanyProfile here, so Companies House field names never reach services or the
// database. https://developer.company-information.service.gov.uk/

const API = 'https://api.company-information.service.gov.uk';

export type CompanyProfile = {
	companyNumber: string;
	name: string;
	entityType: EntityType;
	status: CompanyStatus;
	incorporatedOn: string | null;
	registeredOffice: string | null;
	sicCodes: string[];
	/** The accounting reference date, i.e. the year end. */
	yearEnd: { day: number; month: number } | null;
	accountsNextDueOn: string | null;
	lastAccountsMadeUpTo: string | null;
};

export type CompanySearchResult = {
	companyNumber: string;
	name: string;
	status: CompanyStatus;
	incorporatedOn: string | null;
	address: string | null;
};

export type CompaniesHouse = {
	/** The company, or null if Companies House has no company with that number. */
	getCompany(companyNumber: string): Promise<CompanyProfile | null>;
	searchCompanies(query: string): Promise<CompanySearchResult[]>;
};

const addressSchema = z
	.object({
		premises: z.string().optional(),
		address_line_1: z.string().optional(),
		address_line_2: z.string().optional(),
		locality: z.string().optional(),
		region: z.string().optional(),
		postal_code: z.string().optional(),
		country: z.string().optional()
	})
	.optional();

const profileSchema = z.object({
	company_number: z.string(),
	company_name: z.string(),
	type: z.string(),
	company_status: z.string().optional(),
	date_of_creation: z.string().optional(),
	registered_office_address: addressSchema,
	sic_codes: z.array(z.string()).optional(),
	accounts: z
		.object({
			accounting_reference_date: z.object({ day: z.string(), month: z.string() }).optional(),
			next_due: z.string().optional(),
			last_accounts: z.object({ made_up_to: z.string().optional() }).optional()
		})
		.optional()
});

const searchSchema = z.object({
	items: z
		.array(
			z.object({
				company_number: z.string(),
				title: z.string(),
				company_status: z.string().optional(),
				date_of_creation: z.string().optional(),
				address_snippet: z.string().optional()
			})
		)
		.default([])
});

const ENTITY_TYPE_BY_COMPANY_TYPE: Record<string, EntityType> = {
	ltd: 'private_limited',
	'private-limited-shares-section-30-exemption': 'private_limited',
	plc: 'public_limited',
	'private-limited-guarant-nsc': 'limited_by_guarantee',
	'private-limited-guarant-nsc-limited-exemption': 'limited_by_guarantee',
	'private-unlimited': 'unlimited_company',
	'private-unlimited-nsc': 'unlimited_company',
	llp: 'llp',
	'limited-partnership': 'limited_partnership',
	'charitable-incorporated-organisation': 'cio',
	'scottish-charitable-incorporated-organisation': 'cio',
	'registered-society-non-jurisdictional': 'registered_society',
	'industrial-and-provident-society': 'registered_society'
};

const STATUS_BY_COMPANY_STATUS: Record<string, CompanyStatus> = {
	active: 'active',
	open: 'active',
	registered: 'active',
	dissolved: 'dissolved',
	removed: 'dissolved',
	'converted-closed': 'closed',
	closed: 'closed',
	liquidation: 'liquidation',
	administration: 'administration',
	receivership: 'receivership',
	'voluntary-arrangement': 'voluntary_arrangement',
	'insolvency-proceedings': 'insolvency_proceedings'
};

function formatAddress(address: z.infer<typeof addressSchema>) {
	if (!address) return null;
	const firstLine = [address.premises, address.address_line_1].filter(Boolean).join(' ');
	const lines = [
		firstLine,
		address.address_line_2,
		address.locality,
		address.region,
		address.postal_code,
		address.country
	].filter((line): line is string => Boolean(line?.trim()));
	return lines.length > 0 ? lines.join('\n') : null;
}

function toProfile(data: z.infer<typeof profileSchema>): CompanyProfile {
	const referenceDate = data.accounts?.accounting_reference_date;
	return {
		companyNumber: data.company_number,
		name: data.company_name,
		entityType: ENTITY_TYPE_BY_COMPANY_TYPE[data.type] ?? 'other',
		status: STATUS_BY_COMPANY_STATUS[data.company_status ?? ''] ?? 'other',
		incorporatedOn: data.date_of_creation ?? null,
		registeredOffice: formatAddress(data.registered_office_address),
		sicCodes: data.sic_codes ?? [],
		yearEnd: referenceDate
			? { day: Number(referenceDate.day), month: Number(referenceDate.month) }
			: null,
		accountsNextDueOn: data.accounts?.next_due ?? null,
		lastAccountsMadeUpTo: data.accounts?.last_accounts?.made_up_to ?? null
	};
}

/**
 * A Companies House client. `request` is replaceable so tests never call the real API.
 * Any network error, timeout or unexpected response becomes COMPANIES_HOUSE_UNAVAILABLE,
 * so users can always fall back to entering details by hand.
 */
export function createCompaniesHouse(
	apiKey: string,
	request: (url: string, init: RequestInit) => Promise<Response> = fetch
): CompaniesHouse {
	// The API key is the Basic-auth username, with an empty password.
	const authorization = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;

	async function get(path: string): Promise<unknown | null> {
		let response: Response;
		try {
			response = await request(`${API}${path}`, {
				headers: { authorization, accept: 'application/json' },
				redirect: 'error',
				signal: AbortSignal.timeout(5000)
			});
		} catch {
			logger.warn('companies house request failed');
			throw new BusinessError('COMPANIES_HOUSE_UNAVAILABLE');
		}
		if (response.status === 404) return null;
		if (!response.ok) {
			logger.warn('companies house request failed', { status: response.status });
			throw new BusinessError('COMPANIES_HOUSE_UNAVAILABLE');
		}
		return response.json();
	}

	function parse<T>(schema: z.ZodType<T>, data: unknown): T {
		const parsed = schema.safeParse(data);
		if (!parsed.success) {
			logger.warn('companies house response was not in the expected format');
			throw new BusinessError('COMPANIES_HOUSE_UNAVAILABLE');
		}
		return parsed.data;
	}

	return {
		async getCompany(companyNumber) {
			const data = await get(`/company/${encodeURIComponent(companyNumber)}`);
			return data === null ? null : toProfile(parse(profileSchema, data));
		},

		async searchCompanies(query) {
			const params = new URLSearchParams({ q: query, items_per_page: '10' });
			const data = await get(`/search/companies?${params}`);
			if (data === null) return [];
			return parse(searchSchema, data).items.map((item) => ({
				companyNumber: item.company_number,
				name: item.title,
				status: STATUS_BY_COMPANY_STATUS[item.company_status ?? ''] ?? 'other',
				incorporatedOn: item.date_of_creation ?? null,
				address: item.address_snippet ?? null
			}));
		}
	};
}
