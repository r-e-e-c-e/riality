import { form, query } from '$app/server';
import { clients } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { clientScopeSchema, updateClientSchema } from '#lib/schemas/clients.js';
import { getClientDirectory } from '#lib/remotes/clients.remote.js';

/** One client with its entities, latest engagements and people. */
export const getClient = query(clientScopeSchema, (scope) =>
	clients.getClient(requireUser(), scope)
);

export const updateClient = form(updateClientSchema, async (input) => {
	await submit(() => clients.updateClient(requireUser(), input));
	await getClient({ firmId: input.firmId, clientId: input.clientId }).refresh();
	await getClientDirectory(input.firmId).refresh();
	return { message: 'Client details saved.' };
});
