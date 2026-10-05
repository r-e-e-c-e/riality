import { form } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { tenancy } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { createFirmSchema } from '#lib/schemas/tenancy.js';

export const createFirm = form(createFirmSchema, async (input) => {
	const firm = await submit(() => tenancy.createFirm(requireUser(), input), {
		HANDLE_TAKEN: 'handle'
	});
	redirect(303, `/${firm.handle}`);
});
