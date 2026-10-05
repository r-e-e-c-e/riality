// Firm handles: the part of the URL after lines.ws/, for example lines.ws/cedar-audit.

/** Lowercase letters, digits and single hyphens; starts with a letter; 3–40 characters. */
export const HANDLE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Top-level paths the app uses or may use. A firm can never take one of these.
const RESERVED_HANDLES = new Set([
	'about',
	'account',
	'activate',
	'admin',
	'api',
	'app',
	'assets',
	'billing',
	'blog',
	'docs',
	'forgot-password',
	'help',
	'invite',
	'legal',
	'lines',
	'login',
	'logout',
	'new-firm',
	'pricing',
	'privacy',
	'reset-password',
	'security',
	'settings',
	'signup',
	'static',
	'status',
	'support',
	'terms',
	'welcome',
	'www'
]);

/** True if `value` has the right shape for a handle (used by the route matcher). */
export function looksLikeHandle(value: string) {
	return value.length >= 3 && value.length <= 40 && HANDLE_PATTERN.test(value);
}

export function isReservedHandle(value: string) {
	return RESERVED_HANDLES.has(value);
}

/** A handle suggestion from a firm name: "Cedar Audit LLP" → "cedar-audit-llp". */
export function suggestHandle(name: string) {
	const tidy = (value: string) => value.slice(0, 40).replace(/-+$/, '');
	let handle = tidy(
		name
			.normalize('NFKD')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+/, '')
	);
	if (!/^[a-z]/.test(handle)) handle = tidy(`firm-${handle}`);
	if (handle.length < 3 || isReservedHandle(handle)) handle = tidy(`${handle}-firm`);
	return handle;
}
