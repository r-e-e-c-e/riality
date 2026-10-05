import { query } from '$app/server';
import { engagements } from '#server/app.js';
import { requireUser } from '#server/request.js';
import { idSchema } from '#lib/schemas/tenancy.js';

// Used by the dashboard, the engagements page and the team page (which refreshes them).

/** Engagements the user is assigned to in this firm. */
export const getMyEngagements = query(idSchema, (firmId) =>
	engagements.listAssigned(requireUser(), firmId)
);

/** The firm's engagements, as the user is allowed to see them. */
export const getFirmEngagements = query(idSchema, (firmId) =>
	engagements.listForFirm(requireUser(), firmId)
);
