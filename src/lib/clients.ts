// Client vocabulary shared by the browser and the server. Each list maps the stored
// value to the label people see.

/** Where the firm is in its relationship with the client. */
export const CLIENT_STATUSES = {
	prospect: 'Prospect',
	active: 'Active',
	former: 'Former client'
} as const;
export type ClientStatus = keyof typeof CLIENT_STATUSES;

/** The firm's overall risk assessment of the client, from acceptance and continuance. */
export const RISK_RATINGS = {
	low: 'Low',
	normal: 'Normal',
	high: 'High'
} as const;
export type RiskRating = keyof typeof RISK_RATINGS;

/** Acceptance or continuance should be reviewed at least this often. */
export const REVIEW_INTERVAL_MONTHS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Deadlines this close are flagged as coming up. */
const DUE_SOON_DAYS = 60;

/** Today's date as YYYY-MM-DD (UTC, like the dates we store). */
export function today() {
	return new Date().toISOString().slice(0, 10);
}

/** "Overdue", "Due today" or "Due in 12 days" for a deadline in the next two months; otherwise null. */
export function deadlineWarning(dueOn: string | null, now = today()) {
	if (!dueOn) return null;
	const days = Math.round((Date.parse(dueOn) - Date.parse(now)) / DAY_MS);
	if (days < 0) return { text: 'Overdue', urgent: true };
	if (days === 0) return { text: 'Due today', urgent: true };
	if (days <= DUE_SOON_DAYS) return { text: `Due in ${days} days`, urgent: days <= 14 };
	return null;
}

/** True if acceptance or continuance has never been reviewed, or not within the interval. */
export function isReviewDue(lastReviewedOn: string | null, now = today()) {
	if (!lastReviewedOn) return true;
	const [year, month, day] = lastReviewedOn.split('-').map(Number);
	const next = new Date(Date.UTC(year, month - 1 + REVIEW_INTERVAL_MONTHS, day));
	return next.toISOString().slice(0, 10) <= now;
}
