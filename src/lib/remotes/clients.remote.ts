import { form, query } from '$app/server';
import { engagements } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { createClientSchema, createEntitySchema } from '#lib/schemas/engagements.js';
import { idSchema } from '#lib/schemas/tenancy.js';

// Used by the Clients page and the New engagement page.

/** Clients with their legal entities, as the user is allowed to see them. */
export const getClientDirectory = query(idSchema, (firmId) =>
	engagements.listClientDirectory(requireUser(), firmId)
);

/** All clients (admins only), for choosing one when adding an entity. */
export const getClients = query(idSchema, (firmId) =>
	engagements.listClients(requireUser(), firmId)
);

/** All legal entities (admins only), for choosing one when creating an engagement. */
export const getEntities = query(idSchema, (firmId) =>
	engagements.listEntities(requireUser(), firmId)
);

export const createClient = form(createClientSchema, async (input) => {
	await submit(() => engagements.createClient(requireUser(), input));
	await getClients(input.firmId).refresh();
	await getClientDirectory(input.firmId).refresh();
	return { message: 'Client created.' };
});

export const createEntity = form(createEntitySchema, async (input) => {
	await submit(() => engagements.createEntity(requireUser(), input), { NOT_FOUND: 'clientId' });
	await getEntities(input.firmId).refresh();
	await getClientDirectory(input.firmId).refresh();
	return { message: 'Entity created.' };
});
