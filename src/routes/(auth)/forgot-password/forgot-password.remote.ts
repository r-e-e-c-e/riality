import { form, getRequestEvent } from '$app/server';
import { identity } from '#server/app.js';
import { submit, withMinimumDuration } from '#server/request.js';
import { emailRequestSchema } from '#lib/schemas/identity.js';

export const requestReset = form(emailRequestSchema, async (input) => {
	const address = getRequestEvent().getClientAddress();
	await withMinimumDuration(() => submit(() => identity.requestReset({ ...input, address })));
	return { message: 'If an active account exists, a password reset link will arrive shortly.' };
});
