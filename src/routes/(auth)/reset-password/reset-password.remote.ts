import { form, getRequestEvent } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { identity } from '#server/app.js';
import { NEW_PASSWORD_FIELD, clearIdentity, submit } from '#server/request.js';
import { resetPasswordSchema } from '#lib/schemas/identity.js';

export const resetPassword = form(resetPasswordSchema, async (input) => {
	await submit(
		() =>
			identity.resetPassword({
				token: input._token,
				password: input._password,
				address: getRequestEvent().getClientAddress()
			}),
		{ ...NEW_PASSWORD_FIELD, EMAIL_CODE_INVALID: '_token' }
	);
	clearIdentity();
	redirect(303, '/login?reset=1');
});
