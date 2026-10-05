import { form, query } from '$app/server';
import { clients, config } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import {
	companySearchSchema,
	createClientSchema,
	createEntitySchema
} from '#lib/schemas/clients.js';
import { idSchema } from '#lib/schemas/tenancy.js';

// Used by the Clients page and the New engagement page.

/** Clients with their legal entities, as the user is allowed to see them. */
export const getClientDirectory = query(idSchema, (firmId) =>
	clients.listClientDirectory(requireUser(), firmId)
);

/** All clients (admins only), for choosing one when adding an entity. */
export const getClients = query(idSchema, (firmId) => clients.listClients(requireUser(), firmId));

/** All legal entities (admins only), for choosing one when creating an engagement. */
export const getEntities = query(idSchema, (firmId) => clients.listEntities(requireUser(), firmId));

/** Whether Companies House lookups are available (an API key is configured). */
export const getCompaniesHouseEnabled = query(() => config.companiesHouseApiKey !== null);

/** Companies House search by name or number (admins only). */
export const searchCompanies = query(companySearchSchema, (input) =>
	clients.searchCompanies(requireUser(), input)
);

export const createClient = form(createClientSchema, async (input) => {
	await submit(() => clients.createClient(requireUser(), input));
	await getClients(input.firmId).refresh();
	await getClientDirectory(input.firmId).refresh();
	return { message: 'Client created.' };
});

export const createEntity = form(createEntitySchema, async (input) => {
	const entity = await submit(() => clients.createEntity(requireUser(), input), {
		NOT_FOUND: 'clientId',
		ENTITY_EXISTS: 'companyNumber',
		COMPANY_NOT_FOUND: 'companyNumber',
		COMPANIES_HOUSE_UNAVAILABLE: 'companyNumber',
		COMPANIES_HOUSE_NOT_CONFIGURED: 'companyNumber'
	});
	await getEntities(input.firmId).refresh();
	await getClientDirectory(input.firmId).refresh();
	return { message: `${entity.name} added.` };
});
