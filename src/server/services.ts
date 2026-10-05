import type { Config } from './config';
import type { Database } from './db/connection';
import { createCompaniesHouse, type CompaniesHouse } from './integrations/companies-house';
import { createFileStorage, type FileStorage } from './integrations/storage';
import { createDocumentsService } from './modules/documents/documents.service';
import { createClientsService } from './modules/clients/clients.service';
import { createPeopleService } from './modules/clients/people.service';
import { createEngagementsService } from './modules/engagements/engagements.service';
import { createIdentityAdministrationService } from './modules/identity/identity-administration.service';
import { createIdentityService, type IdentityOverrides } from './modules/identity/identity.service';
import { createMfaService } from './modules/identity/mfa.service';
import { createMailService } from './modules/notifications/mail.service';
import { createInvitationService } from './modules/tenancy/invitation.service';
import { createTenancyAdministrationService } from './modules/tenancy/tenancy-administration.service';
import { createTenancyService } from './modules/tenancy/tenancy.service';

/** Replaceable parts, so tests never call outside services (breach checks, Companies House, storage). */
export type ServiceOverrides = IdentityOverrides & {
	companiesHouse?: CompaniesHouse | null;
	storage?: FileStorage | null;
};

/**
 * Builds every service from a database connection and config. The web app calls
 * this once (src/server/app.ts); scripts and tests call it with their own database.
 */
export function createServices(db: Database, config: Config, overrides: ServiceOverrides = {}) {
	const companiesHouse =
		overrides.companiesHouse !== undefined
			? overrides.companiesHouse
			: config.companiesHouseApiKey
				? createCompaniesHouse(config.companiesHouseApiKey)
				: null;
	const storage =
		overrides.storage !== undefined
			? overrides.storage
			: config.storage
				? createFileStorage(config.storage)
				: null;
	return {
		identity: createIdentityService(db, config, overrides),
		mfa: createMfaService(db, config),
		administration: createIdentityAdministrationService(db),
		tenancy: createTenancyService(db),
		tenancyAdministration: createTenancyAdministrationService(db),
		invitations: createInvitationService(db, config),
		clients: createClientsService(db, config, companiesHouse),
		people: createPeopleService(db, config, companiesHouse),
		documents: createDocumentsService(db, config, storage),
		engagements: createEngagementsService(db),
		mail: createMailService(db, config.encryptionKey)
	};
}

export type Services = ReturnType<typeof createServices>;
