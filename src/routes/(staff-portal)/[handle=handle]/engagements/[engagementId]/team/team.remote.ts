import { form, query } from '$app/server';
import { engagements } from '#server/app.js';
import { requireRecentUser, requireUser, submit } from '#server/request.js';
import { engagementScopeSchema, teamAssignmentFormSchema } from '#lib/schemas/engagements.js';
import { getFirmEngagements, getMyEngagements } from '#lib/remotes/engagements.remote.js';

export const getTeamSetup = query(engagementScopeSchema, (scope) =>
	engagements.getTeamSetup(requireUser(), scope)
);

export const updateAssignment = form(teamAssignmentFormSchema, async (input) => {
	await submit(() => engagements.setAssignment(requireRecentUser(), input));
	await getTeamSetup({ firmId: input.firmId, engagementId: input.engagementId }).refresh();
	await getFirmEngagements(input.firmId).refresh();
	await getMyEngagements(input.firmId).refresh();
	return { message: input.role ? `Team role saved: ${input.role}.` : 'Team access removed.' };
});
