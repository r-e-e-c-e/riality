import { form, query } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { invitations, tenancy } from '#server/app.js';
import { isOwnerOrAdmin } from '#server/modules/tenancy/tenancy-access.js';
import { requireRecentUser, requireUser, submit } from '#server/request.js';
import {
	idSchema,
	inviteSchema,
	membershipFormSchema,
	updateFirmSchema
} from '#lib/schemas/tenancy.js';

export const getMembers = query(idSchema, (firmId) => tenancy.listMembers(requireUser(), firmId));

export const getInvitations = query(idSchema, (firmId) => invitations.list(requireUser(), firmId));

export const updateMembership = form(membershipFormSchema, async (input) => {
	const actor = await submit(async () => {
		const user = requireRecentUser();
		await tenancy.setMembership(user, input);
		return user;
	});
	// If you lowered your own access you can no longer see Settings.
	const lostOwnAccess = input.userId === actor.id && !(input.role && isOwnerOrAdmin(input.role));
	if (lostOwnAccess) redirect(303, input.role ? `/${input.handle}` : '/');
	await getMembers(input.tenantId).refresh();
	return { message: 'Access updated.' };
});

export const inviteMember = form(inviteSchema, async (input) => {
	await submit(() => invitations.invite(requireRecentUser(), input));
	await getInvitations(input.tenantId).refresh();
	return { message: 'Invitation sent.' };
});

export const revokeInvitation = form(
	z.object({ tenantId: idSchema, invitationId: idSchema }),
	async (input) => {
		await submit(() => invitations.revoke(requireRecentUser(), input.tenantId, input.invitationId));
		await getInvitations(input.tenantId).refresh();
		return { message: 'Invitation revoked.' };
	}
);

export const updateFirm = form(updateFirmSchema, async (input) => {
	const firm = await submit(() => tenancy.updateFirm(requireRecentUser(), input), {
		HANDLE_TAKEN: 'handle'
	});
	// A new handle means a new address for every page.
	redirect(303, `/${firm.handle}/settings`);
});
