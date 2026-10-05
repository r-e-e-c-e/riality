import { form, query } from '$app/server';
import { clients } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { entityScopeSchema, updateEntitySchema } from '#lib/schemas/clients.js';

export const getEntity = query(entityScopeSchema, (scope) =>
	clients.getEntity(requireUser(), scope)
);

export const updateEntity = form(updateEntitySchema, async (input) => {
	await submit(() => clients.updateEntity(requireUser(), input), {
		ENTITY_EXISTS: 'companyNumber'
	});
	await getEntity({ firmId: input.firmId, entityId: input.entityId }).refresh();
	return { message: 'Details saved.' };
});

export const refreshEntity = form(entityScopeSchema, async (scope) => {
	await submit(() => clients.refreshFromCompaniesHouse(requireUser(), scope));
	await getEntity(scope).refresh();
	return { message: 'Updated from Companies House.' };
});
