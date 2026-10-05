import { index, snakeCase, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, timestampTz } from '../../db/columns';
import { users } from '../identity/user.entity';
import { membershipRole } from './membership.entity';
import { tenants } from './tenant.entity';

/**
 * A pending invitation to join a tenant. The emailed code is stored only as a hash.
 * Each tenant has at most one live invitation per email; inviting again replaces it.
 */
export const invitations = snakeCase.table(
	'tenant_invitation',
	{
		id: id(),
		tokenHash: text().notNull().unique(),
		tenantId: uuid()
			.notNull()
			.references(() => tenants.id, { onDelete: 'cascade' }),
		email: text().notNull(),
		role: membershipRole().notNull(),
		invitedBy: uuid()
			.notNull()
			.references(() => users.id, { onDelete: 'restrict' }),
		expiresAt: timestampTz().notNull(),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('invitation_tenant_email_idx').on(t.tenantId, t.email),
		index('invitation_expiry_idx').on(t.expiresAt)
	]
);
