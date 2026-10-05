import type { Change } from '#lib/changes.js';
import { changeFeed } from '#server/app.js';
import type { StreamEvent } from '#server/change-feed.js';
import { isMfaPending } from '#server/request.js';
import type { RequestHandler } from './$types';

// The live-updates stream (server-sent events), one per browser window. A plain
// endpoint rather than a remote function, because it stays open. See change-feed.ts.

const headers = { 'content-type': 'text/event-stream' };
const encoder = new TextEncoder();

function format(event: StreamEvent, data?: Change) {
	return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
}

export const GET: RequestHandler = async ({ locals, request }) => {
	const { user, session } = locals;
	// Answer with an event rather than a 401, so the window can tell it is signed out.
	if (!user || !session) return new Response(format('signed-out'), { headers });
	// No live updates until MFA is set up. 204 tells the browser not to retry.
	if (isMfaPending(user, session)) return new Response(null, { status: 204 });

	let unsubscribe = () => {};
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let open = true;
			const close = () => {
				if (!open) return;
				open = false;
				unsubscribe();
				try {
					controller.close();
				} catch {
					// The browser already went away.
				}
			};
			const send = (event: StreamEvent, data?: Change) => {
				if (!open) return;
				try {
					controller.enqueue(format(event, data));
				} catch {
					close();
				}
			};
			unsubscribe = await changeFeed.subscribe(user, session, send, close);
			if (request.signal.aborted) close();
			request.signal.addEventListener('abort', close);
		},
		// The browser closed the window or navigated away.
		cancel() {
			unsubscribe();
		}
	});
	return new Response(stream, { headers });
};
