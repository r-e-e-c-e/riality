// People vocabulary shared by the browser and the server. Each list maps the stored
// value to the label people see.

/** A person is a human or an organisation (for example a corporate director or shareholder). */
export const PERSON_KINDS = {
	individual: 'Individual',
	organisation: 'Organisation'
} as const;
export type PersonKind = keyof typeof PERSON_KINDS;

/** The parts a person plays at an entity. */
export const ENTITY_ROLES = {
	director: 'Director',
	secretary: 'Company secretary',
	llp_member: 'LLP member',
	llp_designated_member: 'LLP designated member',
	shareholder: 'Shareholder',
	psc: 'Person with significant control',
	signatory: 'Signatory',
	contact: 'Contact'
} as const;
export type EntityRoleKind = keyof typeof ENTITY_ROLES;

/** How a person with significant control (PSC) controls the entity. */
export const CONTROL_KINDS = {
	shares_25_to_50: 'Owns 25–50% of shares',
	shares_50_to_75: 'Owns 50–75% of shares',
	shares_75_to_100: 'Owns 75–100% of shares',
	votes_25_to_50: 'Holds 25–50% of votes',
	votes_50_to_75: 'Holds 50–75% of votes',
	votes_75_to_100: 'Holds 75–100% of votes',
	appoints_directors: 'Can appoint or remove directors',
	significant_influence: 'Significant influence or control',
	other: 'Other control'
} as const;
export type ControlKind = keyof typeof CONTROL_KINDS;

/** A role is current until its end date has passed (or if it has none). */
export function isCurrentRole(role: { endedOn: string | null }, today = new Date()) {
	return !role.endedOn || role.endedOn >= today.toISOString().slice(0, 10);
}

/** A role in one line: "Director", "80% shareholder", "PSC". */
export function roleLabel(role: { role: EntityRoleKind; shareholdingPercent: number | null }) {
	if (role.role === 'psc') return 'PSC';
	if (role.role === 'shareholder' && role.shareholdingPercent !== null)
		return `${role.shareholdingPercent}% shareholder`;
	return ENTITY_ROLES[role.role];
}

const roleOrder = Object.keys(ENTITY_ROLES);

/** Someone's roles at one entity, in a fixed order: "Director · 80% shareholder · PSC". */
export function summariseRoles(
	roles: { role: EntityRoleKind; shareholdingPercent: number | null }[]
) {
	return roles
		.toSorted((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))
		.map(roleLabel)
		.join(' · ');
}
