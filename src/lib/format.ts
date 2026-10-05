const dateFormat = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});
export function formatDate(date: string | Date) {
	return dateFormat.format(typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date);
}
const monthFormat = new Intl.DateTimeFormat('en-GB', {
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC'
});
/** "April 1971". */
export function formatMonth(year: number, month: number) {
	return monthFormat.format(new Date(Date.UTC(year, month - 1, 1)));
}
export const teamRoleLabels = {
	auditor: 'Auditor',
	manager: 'Manager',
	partner: 'Partner'
} as const;
