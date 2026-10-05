import { query } from '$app/server';
import { engagements } from '#server/app.js';
import { requireUser } from '#server/request.js';
import { engagementScopeSchema } from '#lib/schemas/engagements.js';

export const getEngagement = query(engagementScopeSchema, (scope) =>
	engagements.get(requireUser(), scope)
);
