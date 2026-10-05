import { expect, test } from 'bun:test';
import type { Change } from '../../src/lib/changes';
import { createChangeFeed, type StreamEvent } from '../../src/server/change-feed';
import { createServices } from '../../src/server/services';
import { testConfig } from '../config';
import { isolatedDatabase } from '../isolated-database';
import { createTenant, testOperator } from '../tenants';

const password = 'synthetic change feed passphrase';

/** Waits up to two seconds for `check` to pass. */
async function eventually(check: () => void) {
	for (let attempt = 0; ; attempt++) {
		try {
			return check();
		} catch (error) {
			if (attempt >= 40) throw error;
			await Bun.sleep(50);
		}
	}
}

test('live updates reach only people who may see the change, and end with the session', async () => {
	const f = await isolatedDatabase();
	const services = createServices(f.db, testConfig());
	const { identity, tenancy, clients, engagements } = services;
	const feed = createChangeFeed(f.db, identity);
	try {
		const [owner, member, outsider] = await Promise.all(
			['owner', 'member', 'outsider'].map((name) =>
				identity.provision({ name, email: `${name}@example.test`, password }, testOperator)
			)
		);
		const firm = await createTenant(f.db, owner!, {
			name: 'Synthetic Firm',
			kind: 'firm',
			parentId: null
		});
		await tenancy.setMembership(owner!, { tenantId: firm.id, userId: member!.id, role: 'member' });

		// One open window for each person.
		await feed.start();
		const received = new Map<string, { event: StreamEvent; change?: Change }[]>();
		const closed = new Set<string>();
		const sessions = new Map<string, string>();
		for (const user of [owner!, member!, outsider!]) {
			const { session } = await identity.login({ email: user.email, password, address: 'test' });
			sessions.set(user.id, session.tokenHash);
			received.set(user.id, []);
			await feed.subscribe(
				user,
				session,
				(event, change) => received.get(user.id)!.push({ event, change }),
				() => closed.add(user.id)
			);
		}
		const changes = (userId: string) =>
			received
				.get(userId)!
				.filter((entry) => entry.event === 'change')
				.map((entry) => entry.change!.action);

		// Firm changes reach firm members, with IDs only.
		const client = await clients.createClient(owner!, {
			firmId: firm.id,
			name: 'Synthetic Client'
		});
		await eventually(() => expect(changes(member!.id)).toContain('client.created'));
		const sent = received.get(member!.id)!.find((entry) => entry.event === 'change')!.change!;
		expect(sent).toEqual({
			action: 'client.created',
			tenantId: firm.id,
			engagementId: null,
			subjectUserId: null,
			targetType: 'client',
			targetId: client.id
		});

		// Engagement changes reach the team and firm admins, not other members.
		const entity = await clients.createEntity(owner!, {
			firmId: firm.id,
			clientId: client.id,
			name: 'Synthetic Trading Ltd'
		});
		const engagement = await engagements.create(owner!, {
			firmId: firm.id,
			entityId: entity.id,
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
		await eventually(() => expect(changes(owner!.id)).toContain('engagement.created'));
		expect(changes(member!.id)).not.toContain('engagement.created');

		// Joining the team counts straight away.
		await engagements.setAssignment(owner!, {
			firmId: firm.id,
			engagementId: engagement.id,
			userId: member!.id,
			role: 'auditor'
		});
		await eventually(() => expect(changes(member!.id)).toContain('engagement.team_changed'));

		// Outsiders hear nothing.
		expect(changes(outsider!.id)).toEqual([]);

		// Signing out in one window ends that session's other windows.
		await identity.logout(sessions.get(member!.id)!);
		await eventually(() => expect(closed.has(member!.id)).toBe(true));
		expect(received.get(member!.id)!.at(-1)!.event).toBe('session-ended');
		expect(closed.has(owner!.id)).toBe(false);
	} finally {
		await feed.stop();
		await f.close();
	}
});
