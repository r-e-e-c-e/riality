import { form } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { engagements, tenancy } from '#server/app.js';
import { requireUser, submit } from '#server/request.js';
import { createEngagementSchema } from '#lib/schemas/engagements.js';

export const createEngagement = form(createEngagementSchema, async (input) => {
	const user = requireUser();
	const engagement = await submit(() => engagements.create(user, input), {
		ENGAGEMENT_EXISTS: 'periodStart',
		NOT_FOUND: 'entityId'
	});
	const { tenant } = await tenancy.get(user, input.firmId);
	redirect(303, `/${tenant.handle}/engagements/${engagement.id}/team`);
});
