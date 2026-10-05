import { getRequestEvent, query } from '$app/server';
import { z } from 'zod';
import { identity, tenancy } from '#server/app.js';
import { isMfaPending, requireUser } from '#server/request.js';
import { isOwnerOrAdmin } from '#server/modules/tenancy/tenancy-access.js';
import { listWorkspaces } from '#lib/workspaces.js';

// Used by the app header and every firm page.

/**
 * Everything the header needs: the signed-in user, their firms (A–Z) and the firm
 * lines.ws/ opens. Users who still have to set up MFA get no workspaces, so the
 * header shows only their account menu.
 */
export const getHeader = query(async () => {
	const { user, session } = getRequestEvent().locals;
	if (!user || !session) return null;
	if (isMfaPending(user, session)) return { user, workspaces: [], homeHandle: null };

	const tenants = await tenancy.list(user);
	const roles = new Map(tenants.map((tenant) => [tenant.id, tenant.role]));
	const workspaces = listWorkspaces(tenants).map((entry) => ({
		...entry,
		role: roles.get(entry.id)!
	}));
	return { user, workspaces, homeHandle: await tenancy.findHomeFirmHandle(user) };
});

/** The firm at lines.ws/{handle} and the user's role there. Also remembered as their last firm. */
export const getWorkspace = query(z.string().max(100), async (handle) => {
	const user = requireUser();
	const workspace = await tenancy.getFirmByHandle(user, handle);
	await identity.rememberLastFirm(user.id, workspace.firm.id);
	return { ...workspace, canManage: isOwnerOrAdmin(workspace.role) };
});
