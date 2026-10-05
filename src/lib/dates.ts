// Calendar dates as YYYY-MM-DD strings (UTC), the way the database stores them.

/** Today's date as YYYY-MM-DD. */
export function today() {
	return new Date().toISOString().slice(0, 10);
}

/**
 * The date `months` after `date` (or before, if negative). Month ends stay month ends,
 * as Companies House counts them: 30 June + 9 months → 31 March, 31 Dec + 9 → 30 Sep.
 */
export function addMonths(date: string, months: number) {
	const [year, month, day] = date.split('-').map(Number);
	const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	const lastDay = daysIn(target.getUTCFullYear(), target.getUTCMonth() + 1);
	target.setUTCDate(day === daysIn(year, month) ? lastDay : Math.min(day, lastDay));
	return target.toISOString().slice(0, 10);
}
