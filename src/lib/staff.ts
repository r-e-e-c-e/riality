// Staff vocabulary shared by the browser and the server.

/**
 * The bodies that approve Responsible Individuals: the people a registered audit firm
 * may let sign audit reports (as senior statutory auditor).
 */
export const AUDIT_REGULATORS = {
	icaew: 'ICAEW',
	acca: 'ACCA',
	icas: 'ICAS',
	cai: 'Chartered Accountants Ireland'
} as const;
export type AuditRegulator = keyof typeof AUDIT_REGULATORS;
