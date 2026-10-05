import { form, getRequestEvent } from '$app/server';
import { identity } from '#server/app.js';
import { submit, withMinimumDuration } from '#server/request.js';
import { signupSchema } from '#lib/schemas/identity.js';

export const signup = form(signupSchema, async (input) => {
	const address = getRequestEvent().getClientAddress();
	await withMinimumDuration(() => submit(() => identity.signup({ ...input, address })));
	return {
		message:
			'If this email is eligible, a verification link will arrive shortly. Existing accounts can sign in or reset their password.'
	};
});
