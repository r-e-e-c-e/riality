import type { Config } from './config';
import type { Database } from './db/connection';
import { createEngagementsService } from './modules/engagements/engagements.service';
import { createIdentityAdministrationService } from './modules/identity/identity-administration.service';
import { createIdentityService, type IdentityOverrides } from './modules/identity/identity.service';
import { createMfaService } from './modules/identity/mfa.service';
import { createMailService } from './modules/notifications/mail.service';
import { createInvitationService } from './modules/tenancy/invitation.service';
import { createTenancyAdministrationService } from './modules/tenancy/tenancy-administration.service';
import { createTenancyService } from './modules/tenancy/tenancy.service';

/**
 * Builds every service from a database connection and config. The web app calls
 * this once (src/server/app.ts); scripts and tests call it with their own database.
 */
export function createServices(db: Database, config: Config, overrides: IdentityOverrides = {}) {
	return {
		identity: createIdentityService(db, config, overrides),
		mfa: createMfaService(db, config),
		administration: createIdentityAdministrationService(db),
		tenancy: createTenancyService(db),
		tenancyAdministration: createTenancyAdministrationService(db),
		invitations: createInvitationService(db, config),
		engagements: createEngagementsService(db),
		mail: createMailService(db, config.encryptionKey)
	};
}

export type Services = ReturnType<typeof createServices>;
