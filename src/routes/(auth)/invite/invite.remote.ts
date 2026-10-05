import { form } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { invitations, tenancy } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { tokenSchema } from '#lib/schemas/identity.js';

export const acceptInvitation = form(z.object({ _token: tokenSchema }), async (input) => {
	const { user, tenantId } = await submit(
		async () => {
			const user = requireUser();
			return { user, ...(await invitations.accept(user, input._token)) };
		},
		{ INVITATION_INVALID: '_token' }
	);
	// Firms open at their handle; a group invitation opens the user's home firm.
	const { tenant } = await tenancy.get(user, tenantId);
	redirect(303, tenant.handle ? `/${tenant.handle}` : '/');
});
