import { form, query } from '$app/server';
import { clients, people } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { entityScopeSchema, updateEntitySchema } from '#lib/schemas/clients.js';
import { addRoleSchema, roleScopeSchema, updateRoleSchema } from '#lib/schemas/people.js';
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
