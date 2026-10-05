import { goto } from '$app/navigation';
import type { Change } from './changes';

// Live updates in the browser. Each window keeps one connection to /api/events and
// hears which records changed (IDs only). Pages say which changes affect the queries
// they show, and only those queries are fetched again:
//
//   const entity = $derived(await getEntity(scope));
//   refreshOn((change) => change.targetId === scope.entityId, () => getEntity(scope).refresh());
//
// Fetching a query again updates what the page shows in place; it never reloads the
// page and never touches what someone is typing into a form.

type Listener = { matches: (change: Change) => boolean; refresh: () => unknown };

// Plain sets: they are bookkeeping, never shown on screen.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const listeners = new Set<Listener>();
/** Listeners waiting to refresh: several changes close together cause one refresh. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const due = new Set<Listener>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** How long to wait for more changes before refreshing. */
const BATCH_MS = 100;
/** Hidden tabs close their connection after this long and catch up when shown again. */
const HIDDEN_DISCONNECT_MS = 60_000;
const MAX_RETRY_MS = 60_000;
const SESSION_ENDED_DELAY_MS = 1_000;

/**
 * Fetches a query again whenever a change it shows happens, while the component is
 * on screen. Call it from a component's <script>. `refresh` must only refresh queries
 * the component already shows (calling a query with new arguments starts a new fetch).
 */
export function refreshOn(matches: Listener['matches'], refresh: Listener['refresh']) {
	$effect(() => {
		const listener = { matches, refresh };
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			due.delete(listener);
		};
	});
}

function schedule(changed: Iterable<Listener>) {
	for (const listener of changed) due.add(listener);
	// Hidden windows wait until they are shown, so background tabs cost nothing.
	if (due.size === 0 || document.hidden || flushTimer) return;
	flushTimer = setTimeout(flush, BATCH_MS);
}

function flush() {
	flushTimer = undefined;
	const listenersToRun = [...due];
	due.clear();
	for (const listener of listenersToRun) {
		// A failed refresh shows on the page through the query's own error state.
		Promise.resolve(listener.refresh()).catch(() => {});
	}
}

/**
 * Opens this window's live-updates connection. Call once, from the signed-in layout;
 * returns a function that closes it. Reconnects with a growing delay if the connection
 * drops, and refreshes everything shown once it is back, since changes may have been
 * missed.
 */
export function connectLiveUpdates() {
	let source: EventSource | null = null;
	let missedChanges = false;
	let retryDelay = 1_000;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let hiddenTimer: ReturnType<typeof setTimeout> | undefined;

	function connect() {
		source = new EventSource('/api/events');
		source.addEventListener('open', () => {
			retryDelay = 1_000;
			if (missedChanges) schedule(listeners);
			missedChanges = false;
		});
		source.addEventListener('change', (event) => {
			const change = JSON.parse(event.data) as Change;
			schedule([...listeners].filter((listener) => listener.matches(change)));
		});
		source.addEventListener('resync', () => schedule(listeners));
		// Signing out in this window navigates away and closes the connection first;
		// otherwise reconnect shortly, which shows whether the browser is still signed in.
		source.addEventListener('session-ended', () => {
			disconnect();
			missedChanges = true;
			retryTimer = setTimeout(connect, SESSION_ENDED_DELAY_MS);
		});
		source.addEventListener('signed-out', () => {
			disconnect();
			void goto(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
		});
		source.addEventListener('error', () => {
			missedChanges = true;
			// The browser retries by itself unless the connection is closed for good.
			if (source?.readyState !== EventSource.CLOSED) return;
			disconnect();
			retryTimer = setTimeout(connect, retryDelay);
			retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
		});
	}

	function disconnect() {
		source?.close();
		source = null;
		clearTimeout(retryTimer);
	}

	function onVisibilityChange() {
		clearTimeout(hiddenTimer);
		if (document.hidden) {
			hiddenTimer = setTimeout(() => {
				disconnect();
				missedChanges = true;
			}, HIDDEN_DISCONNECT_MS);
			return;
		}
		if (!source) connect();
		schedule([]);
	}

	connect();
	document.addEventListener('visibilitychange', onVisibilityChange);
	return () => {
		document.removeEventListener('visibilitychange', onVisibilityChange);
		clearTimeout(hiddenTimer);
		disconnect();
	};
}

/** True for a change to one of the firm's clients, entities or engagements (including teams). */
export function isFirmRecordChange(change: Change, firmId: string) {
	return (
		change.tenantId === firmId &&
		(change.engagementId !== null ||
			change.targetType === 'client' ||
			change.targetType === 'entity')
	);
}
