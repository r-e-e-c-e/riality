// The workspace switcher's list: the user's firms, A–Z. Ownership groups are not
// shown as a tree; a firm's group appears only when it helps tell firms apart.

export type WorkspaceTenant = {
	id: string;
	name: string;
	kind: 'group' | 'firm';
	handle: string | null;
	parentId: string | null;
};

export type Workspace = { id: string; name: string; handle: string; groupName: string | null };

/** Show a search box in the switcher when the user has more firms than this. */
export const WORKSPACE_SEARCH_THRESHOLD = 7;

/**
 * The firms in `tenants`, sorted by name. `groupName` is the firm's parent group,
 * but only if the user belongs to that group and their firms span more than one
 * group; otherwise it is null, because it would not help them choose.
 */
export function listWorkspaces(tenants: WorkspaceTenant[]): Workspace[] {
	const groupNames = new Map(
		tenants.filter((tenant) => tenant.kind === 'group').map((group) => [group.id, group.name])
	);
	const firms = tenants
		.filter((tenant) => tenant.kind === 'firm' && tenant.handle)
		.map((firm) => ({
			id: firm.id,
			name: firm.name,
			handle: firm.handle!,
			groupName: (firm.parentId && groupNames.get(firm.parentId)) || null
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	const distinctGroups = new Set(firms.map((firm) => firm.groupName));
	const groupsHelp = distinctGroups.size > 1;
	return firms.map((firm) => ({ ...firm, groupName: groupsHelp ? firm.groupName : null }));
}
