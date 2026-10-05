import { form, query } from '$app/server';
import { clients, config, documents, people } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { entityScopeSchema, updateEntitySchema } from '#lib/schemas/clients.js';
import { addRoleSchema, roleScopeSchema, updateRoleSchema } from '#lib/schemas/people.js';
import { documentScopeSchema, uploadDocumentSchema } from '#lib/schemas/documents.js';
import { getPeople } from '#lib/remotes/people.remote.js';

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

/** Everyone with a role at the entity, current and past. */
export const getEntityPeople = query(entityScopeSchema, (scope) =>
	people.listEntityPeople(requireUser(), scope)
);

export const addRole = form(addRoleSchema, async (input) => {
	const { person } = await submit(() => people.addRole(requireUser(), input), {
		NOT_FOUND: 'personId',
		ROLE_EXISTS: 'role'
	});
	await getEntityPeople({ firmId: input.firmId, entityId: input.entityId }).refresh();
	await getPeople(input.firmId).refresh();
	return { message: `${person.name} added.` };
});

export const updateRole = form(updateRoleSchema, async (input) => {
	const role = await submit(() => people.updateRole(requireUser(), input), {
		ROLE_EXISTS: 'startedOn'
	});
	await getEntityPeople({ firmId: input.firmId, entityId: role.entityId }).refresh();
	return { message: 'Role saved.' };
});

export const removeRole = form(roleScopeSchema, async (input) => {
	const role = await submit(() => people.removeRole(requireUser(), input));
	await getEntityPeople({ firmId: input.firmId, entityId: role.entityId }).refresh();
	await getPeople(input.firmId).refresh();
	return { message: 'Role removed.' };
});

export const importPeople = form(entityScopeSchema, async (scope) => {
	const counts = await submit(() => people.importFromCompaniesHouse(requireUser(), scope));
	await getEntityPeople(scope).refresh();
	await getPeople(scope.firmId).refresh();
	const changes = counts.rolesAdded + counts.rolesUpdated;
	return {
		message:
			changes === 0
				? 'Already up to date with Companies House.'
				: `Imported from Companies House: ${counts.rolesAdded} roles added, ${counts.rolesUpdated} updated.`
	};
});

/** The entity's permanent file, and whether uploads are possible (storage is set up). */
export const getEntityDocuments = query(entityScopeSchema, async (scope) => ({
	documents: await documents.listForEntity(requireUser(), scope),
	canUpload: config.storage !== null
}));

export const uploadDocument = form(uploadDocumentSchema, async (input) => {
	const document = await submit(() => documents.upload(requireUser(), input), {
		DOCUMENT_TYPE_NOT_ALLOWED: 'file',
		DOCUMENT_TOO_LARGE: 'file'
	});
	await getEntityDocuments({ firmId: input.firmId, entityId: input.entityId }).refresh();
	return { message: `${document.title} uploaded.` };
});

export const removeDocument = form(documentScopeSchema, async (input) => {
	const document = await submit(() => documents.remove(requireUser(), input));
	await getEntityDocuments({ firmId: input.firmId, entityId: document.entityId }).refresh();
	return { message: 'Document removed.' };
});
