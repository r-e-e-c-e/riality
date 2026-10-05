import { expect, test } from 'bun:test';
import { listWorkspaces, type WorkspaceTenant } from '../../src/lib/workspaces';
import { suggestHandle } from '../../src/lib/handles';

const group = (id: string, name: string): WorkspaceTenant => ({
	id,
	name,
	kind: 'group',
	handle: null,
	parentId: null
});
const firm = (id: string, name: string, parentId: string | null = null): WorkspaceTenant => ({
	id,
	name,
	kind: 'firm',
	handle: id,
	parentId
});

test('the workspace switcher lists firms A–Z and leaves groups out', () => {
	const workspaces = listWorkspaces([
		group('g1', 'Azelle Group'),
		firm('wilkins', 'Wilkins Kenmore', 'g1'),
		firm('baldwyn', 'Baldwyn & Co', 'g1'),
		firm('harbour', 'Harbour Audit', 'hidden-group')
	]);
	expect(workspaces.map((entry) => entry.name)).toEqual([
		'Baldwyn & Co',
		'Harbour Audit',
		'Wilkins Kenmore'
	]);
});

test('group names appear only when they help tell firms apart', () => {
	const sameGroup = listWorkspaces([
		group('g1', 'Azelle Group'),
		firm('a', 'Baldwyn & Co', 'g1'),
		firm('b', 'Wilkins Kenmore', 'g1')
	]);
	expect(sameGroup.map((entry) => entry.groupName)).toEqual([null, null]);

	const twoGroups = listWorkspaces([
		group('g1', 'Azelle North'),
		group('g2', 'Brightwell Partners'),
		firm('a', 'Baldwyn & Co', 'g1'),
		firm('b', 'Carter Audit', 'g2'),
		firm('c', 'Meadowcroft Audit', null)
	]);
	expect(twoGroups.map((entry) => entry.groupName)).toEqual([
		'Azelle North',
		'Brightwell Partners',
		null
	]);
});

test('handle suggestions are valid handles', () => {
	expect(suggestHandle('Cedar Audit LLP')).toBe('cedar-audit-llp');
	expect(suggestHandle('  Smith & Jones (Audit) ')).toBe('smith-jones-audit');
	expect(suggestHandle('123 Accountants')).toBe('firm-123-accountants');
	expect(suggestHandle('Settings')).toBe('settings-firm');
	expect(suggestHandle('AB')).toBe('ab-firm');
	expect(suggestHandle('x'.repeat(60))).toHaveLength(40);
});
