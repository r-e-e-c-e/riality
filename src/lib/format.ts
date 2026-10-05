const dateFormat = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});
export function formatDate(date: string | Date) {
	return dateFormat.format(typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date);
}
export const teamRoleLabels = {
	auditor: 'Auditor',
	manager: 'Manager',
	partner: 'Partner'
} as const;
