import type { Database } from '../src/server/db/connection';
import { createServices } from '../src/server/services';
import { testConfig } from './config';

export const testOperator = { name: 'Synthetic Operator' };

/**
 * Builds a firm or group for a test. Users create standalone firms; groups and
 * placing a tenant under a group are operator actions, so this uses both.
 */
export async function createTenant(
	db: Database,
	owner: { id: string; email: string },
	input: { name: string; kind: 'group' | 'firm'; parentId: string | null }
) {
	const { tenancy, tenancyAdministration } = createServices(db, testConfig());
	const tenant =
		input.kind === 'firm'
			? await tenancy.createFirm(owner, { name: input.name })
			: await tenancyAdministration.createGroup(
					{ name: input.name, ownerEmail: owner.email },
					testOperator
				);
	if (!input.parentId) return tenant;
	return tenancyAdministration.moveTenant(
		{ tenant: tenant.id, parent: input.parentId },
		testOperator
	);
}
