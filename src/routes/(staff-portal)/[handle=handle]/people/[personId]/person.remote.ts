import { form, query } from '$app/server';
import { people } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { personScopeSchema, updatePersonSchema } from '#lib/schemas/people.js';
import { getPeople } from '#lib/remotes/people.remote.js';

export const getPerson = query(personScopeSchema, (scope) =>
	people.getPerson(requireUser(), scope)
);

export const updatePerson = form(updatePersonSchema, async (input) => {
	await submit(() => people.updatePerson(requireUser(), input));
	await getPerson({ firmId: input.firmId, personId: input.personId }).refresh();
	await getPeople(input.firmId).refresh();
	return { message: 'Details saved.' };
});
