import { expect, test } from 'bun:test';
import { createCompaniesHouse } from '../../src/server/integrations/companies-house';

// A trimmed Companies House company profile response (synthetic company).
const profileResponse = {
	company_number: '00012345',
	company_name: 'SYNTHETIC TRADING LIMITED',
	type: 'ltd',
	company_status: 'active',
	date_of_creation: '2004-03-15',
	registered_office_address: {
		premises: 'Unit 4',
		address_line_1: 'Mill Lane',
		locality: 'Leeds',
		postal_code: 'LS1 1AA',
		country: 'England'
	},
	sic_codes: ['25620'],
	accounts: {
		accounting_reference_date: { day: '31', month: '03' },
		next_due: '2026-12-31',
		last_accounts: { made_up_to: '2025-03-31' }
	},
	links: { self: '/company/00012345' }
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('company profiles are mapped into our own shape, sent with the API key', async () => {
	let url = '';
	let headers = new Headers();
	const companiesHouse = createCompaniesHouse('synthetic-key', async (requestUrl, init) => {
		url = requestUrl;
		headers = new Headers(init.headers);
		return json(profileResponse);
	});

	expect(await companiesHouse.getCompany('00012345')).toEqual({
		companyNumber: '00012345',
		name: 'SYNTHETIC TRADING LIMITED',
		entityType: 'private_limited',
		status: 'active',
		incorporatedOn: '2004-03-15',
		registeredOffice: 'Unit 4 Mill Lane\nLeeds\nLS1 1AA\nEngland',
		sicCodes: ['25620'],
		yearEnd: { day: 31, month: 3 },
		accountsNextDueOn: '2026-12-31',
		lastAccountsMadeUpTo: '2025-03-31'
	});
	expect(url).toBe('https://api.company-information.service.gov.uk/company/00012345');
	expect(headers.get('authorization')).toBe(
		`Basic ${Buffer.from('synthetic-key:').toString('base64')}`
	);
});

test('unknown types and statuses map to "other"; search results are mapped too', async () => {
	const companiesHouse = createCompaniesHouse('synthetic-key', async (url) =>
		url.includes('/search/')
			? json({
					items: [
						{
							company_number: 'SC123456',
							title: 'SYNTHETIC HOLDINGS LIMITED',
							company_status: 'liquidation',
							address_snippet: '1 High Street, Glasgow'
						}
					]
				})
			: json({ ...profileResponse, type: 'some-new-type', company_status: 'something-new' })
	);
	expect(await companiesHouse.getCompany('00012345')).toMatchObject({
		entityType: 'other',
		status: 'other'
	});
	expect(await companiesHouse.searchCompanies('synthetic')).toEqual([
		{
			companyNumber: 'SC123456',
			name: 'SYNTHETIC HOLDINGS LIMITED',
			status: 'liquidation',
			incorporatedOn: null,
			address: '1 High Street, Glasgow'
		}
	]);
});

test('missing companies return null; outages and bad responses are "unavailable"', async () => {
	const respondWith = (response: () => Response | Promise<Response>) =>
		createCompaniesHouse('synthetic-key', async () => response());

	expect(await respondWith(() => json({}, 404)).getCompany('00000000')).toBeNull();
	for (const companiesHouse of [
		respondWith(() => json({}, 500)),
		respondWith(() => json({ unexpected: true })),
		respondWith(() => Promise.reject(new Error('network down')))
	]) {
		await expect(companiesHouse.getCompany('00012345')).rejects.toMatchObject({
			code: 'COMPANIES_HOUSE_UNAVAILABLE'
		});
	}
});
