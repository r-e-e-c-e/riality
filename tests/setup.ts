import { spyOn } from 'bun:test';
import { logger } from '../src/server/logger';

// Tests trigger failed sign-ins on purpose; don't print those warnings. Errors still print.
export const loggedWarnings = spyOn(logger, 'warn').mockImplementation(() => {});
spyOn(logger, 'info').mockImplementation(() => {});

/** Security events logged since the last loggedWarnings.mockClear(). */
export function securityEvents() {
	return loggedWarnings.mock.calls
		.filter(([message]) => message === 'security event')
		.map(([, fields]) => fields as Record<string, unknown>);
}
