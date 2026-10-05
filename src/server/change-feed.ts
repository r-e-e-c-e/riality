import { eq } from 'drizzle-orm';
import type { Change } from '#lib/changes.js';
import type { Database } from './db/connection';
import { describeError, logger } from './logger';
import { engagementTeam } from './modules/engagements/team.entity';
import type { createIdentityService } from './modules/identity/identity.service';
import { memberships, type MembershipRole } from './modules/tenancy/membership.entity';
import { isOwnerOrAdmin } from './modules/tenancy/tenancy-access';

/** The Postgres channel the audit_event trigger notifies (change_notifications migration). */
const CHANNEL = 'lines_changes';
/** Keeps proxies from closing quiet streams. */
const HEARTBEAT_MS = 25_000;
/** How often each stream checks its session is still signed in and reloads its access. */
const RECHECK_MS = 60_000;
/** Opening more windows than this closes the user's oldest stream. */
const MAX_STREAMS_PER_USER = 20;

/** The notification payload: a Change plus who made it (used here, never sent on). */
type Notification = Change & { actorId: string | null };

/** What a stream may hear about: its user's firms (with role) and engagement teams. */
type Access = { roles: Map<string, MembershipRole>; engagementIds: Set<string> };

/**
 * Events a window receives:
 * - change: something it may be showing has changed;
 * - resync: changes may have been missed, so fetch everything shown again;
 * - session-ended: the stream's session has ended (the browser may have a newer one,
 *   after signing in again or confirming its identity, so it reconnects to check);
 * - signed-out: the browser has no session (sent by the endpoint);
 * - ping: nothing happened (keeps the connection open).
 */
export type StreamEvent = 'change' | 'resync' | 'session-ended' | 'signed-out' | 'ping';

/** One open browser window. */
type Stream = {
	userId: string;
	sessionId: string;
	access: Access;
	send: (event: StreamEvent, data?: Change) => void;
	close: () => void;
};

/**
 * Live updates. Each app server keeps one Postgres LISTEN connection and fans out
 * every audit event to the open browser windows that may see it. Windows get IDs
 * only and fetch anything they show again through the normal, access-checked
 * queries, so a stream never carries client data.
 *
 * Who hears about a change:
 * - the user it is about (subjectUserId), always;
 * - for firm changes, members of that firm;
 * - for engagement changes, that engagement's team, plus firm owners and admins
 *   (who see every engagement in lists, but not their content);
 * - for changes without a firm (account changes), only the user who made them.
 */
export function createChangeFeed(db: Database, identity: ReturnType<typeof createIdentityService>) {
	const streams = new Set<Stream>();
	let timers: ReturnType<typeof setInterval>[] = [];
	let unlisten: (() => Promise<void>) | null = null;

	async function loadAccess(userId: string): Promise<Access> {
		const [firms, teams] = await Promise.all([
			db
				.select({ tenantId: memberships.tenantId, role: memberships.role })
				.from(memberships)
				.where(eq(memberships.userId, userId)),
			db
				.select({ engagementId: engagementTeam.engagementId })
				.from(engagementTeam)
				.where(eq(engagementTeam.userId, userId))
		]);
		return {
			roles: new Map(firms.map((firm) => [firm.tenantId, firm.role])),
			engagementIds: new Set(teams.map((team) => team.engagementId))
		};
	}

	function canSee(stream: Stream, change: Notification) {
		if (change.subjectUserId === stream.userId) return true;
		if (!change.tenantId) return change.actorId === stream.userId;
		const role = stream.access.roles.get(change.tenantId);
		if (!role) return false;
		if (!change.engagementId) return true;
		return isOwnerOrAdmin(role) || stream.access.engagementIds.has(change.engagementId);
	}

	/** True if the change may alter the stream's own session or access. */
	function concernsStream(stream: Stream, change: Notification) {
		return (
			change.subjectUserId === stream.userId ||
			(change.targetType === 'session' && change.targetId === stream.sessionId)
		);
	}

	function end(stream: Stream) {
		streams.delete(stream);
		stream.close();
	}

	/** Ends the stream if its session has ended; otherwise reloads its access. */
	async function recheck(stream: Stream) {
		if (!(await identity.isSessionLive(stream.sessionId))) {
			stream.send('session-ended');
			end(stream);
			return false;
		}
		stream.access = await loadAccess(stream.userId);
		return true;
	}

	async function deliver(stream: Stream, change: Notification) {
		if (concernsStream(stream, change) && !(await recheck(stream))) return;
		if (!canSee(stream, change)) return;
		// Windows are never told who made the change.
		stream.send('change', {
			action: change.action,
			tenantId: change.tenantId,
			engagementId: change.engagementId,
			subjectUserId: change.subjectUserId,
			targetType: change.targetType,
			targetId: change.targetId
		});
	}

	function onNotify(payload: string) {
		const change = JSON.parse(payload) as Notification;
		for (const stream of streams) {
			deliver(stream, change).catch((error) =>
				logger.error('live update failed', describeError(error))
			);
		}
	}

	return {
		/**
		 * Starts listening. Called once from the `init` hook. After a lost database
		 * connection, windows are told to fetch again, since changes may have been missed.
		 */
		async start() {
			await this.stop();
			let listening = false;
			const listener = await db.$client.listen(CHANNEL, onNotify, () => {
				if (listening) for (const stream of streams) stream.send('resync');
				listening = true;
			});
			unlisten = listener.unlisten;
			timers = [
				setInterval(() => {
					for (const stream of streams) stream.send('ping');
				}, HEARTBEAT_MS),
				setInterval(() => {
					for (const stream of streams) {
						recheck(stream).catch((error) =>
							logger.error('live update session check failed', describeError(error))
						);
					}
				}, RECHECK_MS)
			];
			for (const timer of timers) timer.unref?.();
		},

		/** Stops listening and closes every stream (they reconnect to the new feed in dev). */
		async stop() {
			for (const timer of timers) clearInterval(timer);
			timers = [];
			for (const stream of streams) end(stream);
			await unlisten?.();
			unlisten = null;
		},

		/**
		 * Adds a browser window. `send` writes one event; `close` ends its stream (the
		 * feed calls it when the session ends). Returns a function that removes it.
		 */
		async subscribe(
			user: { id: string },
			session: { id: string },
			send: Stream['send'],
			close: () => void
		) {
			const stream: Stream = {
				userId: user.id,
				sessionId: session.id,
				access: await loadAccess(user.id),
				send,
				close
			};
			const mine = [...streams].filter((other) => other.userId === user.id);
			if (mine.length >= MAX_STREAMS_PER_USER) end(mine[0]!);
			streams.add(stream);
			return () => streams.delete(stream);
		}
	};
}

export type ChangeFeed = ReturnType<typeof createChangeFeed>;
