import type { HandleClientError } from '@sveltejs/kit/hooks';

/**
 * Errors thrown in the browser while navigating or rendering (errors from the server
 * already arrive with a safe message). Shown on the nearest +error.svelte page.
 * Send `error` to an error-tracking service here once there is one.
 */
export const handleError: HandleClientError = ({ kind, error }) => {
	if (kind !== 'unknown') return;
	console.error(error);
	return {
		message: 'Something went wrong in your browser. Reload the page and try again.',
		code: 'UNEXPECTED'
	};
};
