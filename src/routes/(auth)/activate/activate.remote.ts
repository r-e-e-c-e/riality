import { form, getRequestEvent } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { identity } from '#server/app.js';
import { NEW_PASSWORD_FIELD, submit } from '#server/request.js';
import { activateSchema } from '#lib/schemas/identity.js';

export const activate = form(activateSchema, async (input) => {
	await submit(
		() =>
			identity.activate({
				token: input._token,
				password: input._password,
				address: getRequestEvent().getClientAddress()
			}),
		{ ...NEW_PASSWORD_FIELD, EMAIL_CODE_INVALID: '_token' }
	);
	redirect(303, '/login?created=1');
});
