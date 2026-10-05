import { sql } from 'drizzle-orm';
import { check, foreignKey, snakeCase, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../../db/columns';
import { reportingPeriods } from './reporting-period.entity';

/**
 * One statutory audit of one entity's reporting period. V1 has only the
 * 'statutory_audit' type and the 'setup' stage; later stages need their own
 * domain operations before the check constraints are widened.
 */
export const engagements = snakeCase.table(
	'engagement',
	{
		id: id(),
		firmId: uuid().notNull(),
		periodId: uuid().notNull(),
		type: text().notNull().default('statutory_audit'),
		stage: text().notNull().default('setup'),
		createdAt: createdAt()
	},
	(t) => [
		unique('engagement_firm_id_unique').on(t.firmId, t.id),
		unique('engagement_period_unique').on(t.firmId, t.periodId),
		foreignKey({
			name: 'engagement_period_fk',
			columns: [t.firmId, t.periodId],
			foreignColumns: [reportingPeriods.firmId, reportingPeriods.id]
		}).onDelete('restrict'),
		check('engagement_type_v1', sql`${t.type} = 'statutory_audit'`),
		check('engagement_stage_setup', sql`${t.stage} = 'setup'`)
	]
);
