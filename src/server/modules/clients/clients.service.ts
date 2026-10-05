import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Config } from '../../config';
import type { Database, Transaction } from '../../db/connection';
import { inTransaction } from '../../db/transaction';
import { BusinessError, notFound, postgresErrorCode } from '../../errors';
import type { CompaniesHouse, CompanyProfile } from '../../integrations/companies-house';
import {
	clientScopeSchema,
	companySearchSchema,
	createClientSchema,
	createEntitySchema,
	entityScopeSchema,
	updateClientSchema,
	updateEntitySchema
} from '#lib/schemas/clients.js';
import { idSchema } from '#lib/schemas/tenancy.js';
import { changedFields, recordEvent } from '../audit/audit-event.service';
import { RATE_LIMITS, createRateLimiter } from '../identity/rate-limit.service';
import {
	isOwnerOrAdmin,
	requireFirmAdmin,
	requireFirmMember,
	type Actor
} from '../tenancy/tenancy-access';
import { memberships } from '../tenancy/membership.entity';
import { clients, entities, entityRoles } from './client.entity';
import { loadClients, loadPeopleOf } from './client-directory';
import { onMyEngagementTeam } from './entity-access';

/** The entity columns that come from Companies House. */
function registerDetails(profile: CompanyProfile) {
	return {
		name: profile.name,
		entityType: profile.entityType,
		companyNumber: profile.companyNumber,
		companyStatus: profile.status,
		incorporatedOn: profile.incorporatedOn,
		registeredOffice: profile.registeredOffice,
		sicCodes: profile.sicCodes,
		yearEndDay: profile.yearEnd?.day ?? null,
		yearEndMonth: profile.yearEnd?.month ?? null,
		accountsNextDueOn: profile.accountsNextDueOn,
		lastAccountsMadeUpTo: profile.lastAccountsMadeUpTo,
		companiesHouseSyncedAt: new Date()
	};
}

/** Turns the unique (firm, company number) violation into ENTITY_EXISTS. */
async function withCompanyNumberCheck<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (postgresErrorCode(error) === '23505') throw new BusinessError('ENTITY_EXISTS');
		throw error;
	}
}

/**
 * Clears a leaving member from every client they were partner or manager of. Called
 * when someone is removed from the firm, in the same transaction.
 */
export async function removeClientResponsibilities(
	tx: Transaction,
	actor: Actor,
	firmId: string,
	userId: string
) {
	for (const field of ['partnerId', 'managerId'] as const) {
		const cleared = await tx
			.update(clients)
			.set({ [field]: null })
			.where(and(eq(clients.firmId, firmId), eq(clients[field], userId)))
			.returning({ id: clients.id });
		for (const client of cleared) {
			await recordEvent(tx, {
				action: 'client.updated',
				actorId: actor.id,
				tenantId: firmId,
				target: { type: 'client', id: client.id },
				details: { changed: [field] }
			});
		}
	}
}

/**
 * The firm's clients and their legal entities. Owners and admins manage them;
 * members see the ones they have engagements for. Entity register details can come
 * from Companies House when `companiesHouse` is set (it is null without an API key).
 */
export function createClientsService(
	db: Database,
	config: Pick<Config, 'encryptionKey'>,
	companiesHouse: CompaniesHouse | null
) {
	const limiter = createRateLimiter(db, config.encryptionKey);

	/** Fetches a company from Companies House, counting it against the user's lookup limit. */
	async function lookUpCompany(actor: Actor, companyNumber: string) {
		if (!companiesHouse) throw new BusinessError('COMPANIES_HOUSE_NOT_CONFIGURED');
		await limiter.consume(RATE_LIMITS.companiesHouseLookupsPerUser, actor.id);
		const profile = await companiesHouse.getCompany(companyNumber);
		if (!profile) throw new BusinessError('COMPANY_NOT_FOUND');
		return profile;
	}

	async function findEntity(tx: Transaction | Database, firmId: string, entityId: string) {
		const [entity] = await tx
			.select()
			.from(entities)
			.where(and(eq(entities.firmId, firmId), eq(entities.id, entityId)));
		if (!entity) throw notFound('Entity');
		return entity;
	}

	return {
		/** All clients (owners and admins), for choosing one when adding an entity. */
		async listClients(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			await requireFirmAdmin(db, actor, id);
			return db
				.select({ id: clients.id, name: clients.name })
				.from(clients)
				.where(eq(clients.firmId, id))
				.orderBy(clients.name, clients.id);
		},

		/** All entities (owners and admins), for choosing one when creating an engagement. */
		async listEntities(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			await requireFirmAdmin(db, actor, id);
			return db
				.select({
					id: entities.id,
					name: entities.name,
					clientId: clients.id,
					clientName: clients.name,
					yearEndDay: entities.yearEndDay,
					yearEndMonth: entities.yearEndMonth
				})
				.from(entities)
				.innerJoin(
					clients,
					and(eq(clients.firmId, entities.firmId), eq(clients.id, entities.clientId))
				)
				.where(eq(entities.firmId, id))
				.orderBy(clients.name, entities.name, entities.id);
		},

		/**
		 * Clients with their partner, manager, key contact, entities, filing deadlines and
		 * latest engagements. Owners and admins see all of them; members see only clients
		 * (and entities) with an engagement they are assigned to.
		 */
		async listClientDirectory(actor: Actor, firmId: string) {
			const id = idSchema.parse(firmId);
			const { role } = await requireFirmMember(db, actor, id);
			return loadClients(db, actor, { firmId: id, seesAll: isOwnerOrAdmin(role) });
		},

		/** One client with its entities and everyone with a role at them. Same access as the list. */
		async getClient(actor: Actor, input: z.infer<typeof clientScopeSchema>) {
			const { firmId, clientId } = clientScopeSchema.parse(input);
			const { role } = await requireFirmMember(db, actor, firmId);
			const [client] = await loadClients(db, actor, {
				firmId,
				clientId,
				seesAll: isOwnerOrAdmin(role)
			});
			if (!client) throw notFound('Client');
			const entityIds = client.entities.map((entity) => entity.id);
			return { ...client, people: await loadPeopleOf(db, firmId, entityIds) };
		},

		/**
		 * Edits a client's details. The partner and manager must be firm members, and the
		 * key contact must have a role at one of the client's entities. Owners and admins.
		 */
		async updateClient(actor: Actor, input: z.input<typeof updateClientSchema>) {
			const { firmId, clientId, ...form } = updateClientSchema.parse(input);
			// Fields left empty are cleared.
			const changes = {
				name: form.name,
				status: form.status,
				partnerId: form.partnerId ?? null,
				managerId: form.managerId ?? null,
				keyContactId: form.keyContactId ?? null,
				riskRating: form.riskRating ?? null,
				lastReviewedOn: form.lastReviewedOn ?? null
			};
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, firmId);
				const [before] = await tx
					.select()
					.from(clients)
					.where(and(eq(clients.firmId, firmId), eq(clients.id, clientId)));
				if (!before) throw notFound('Client');

				for (const userId of [changes.partnerId, changes.managerId]) {
					if (!userId) continue;
					const [member] = await tx
						.select({ userId: memberships.userId })
						.from(memberships)
						.where(and(eq(memberships.tenantId, firmId), eq(memberships.userId, userId)));
					if (!member) throw notFound('Firm member');
				}
				if (changes.keyContactId) {
					const [linked] = await tx
						.select({ id: entityRoles.id })
						.from(entityRoles)
						.innerJoin(
							entities,
							and(eq(entities.firmId, entityRoles.firmId), eq(entities.id, entityRoles.entityId))
						)
						.where(
							and(
								eq(entityRoles.firmId, firmId),
								eq(entityRoles.personId, changes.keyContactId),
								eq(entities.clientId, clientId)
							)
						)
						.limit(1);
					if (!linked) throw notFound('Contact');
				}

				const changed = changedFields(before, changes);
				if (changed.length === 0) return before;
				const [client] = await tx
					.update(clients)
					.set(changes)
					.where(and(eq(clients.firmId, firmId), eq(clients.id, clientId)))
					.returning();
				await recordEvent(tx, {
					action: 'client.updated',
					actorId: actor.id,
					tenantId: firmId,
					target: { type: 'client', id: clientId },
					details: { changed }
				});
				return client;
			});
		},

		/** One entity with all its details. Owners, admins, and members on one of its engagements. */
		async getEntity(actor: Actor, input: z.infer<typeof entityScopeSchema>) {
			const { firmId, entityId } = entityScopeSchema.parse(input);
			const { role } = await requireFirmMember(db, actor, firmId);
			const [entity] = await db
				.select({ entity: entities, clientName: clients.name })
				.from(entities)
				.innerJoin(
					clients,
					and(eq(clients.firmId, entities.firmId), eq(clients.id, entities.clientId))
				)
				.where(
					and(
						eq(entities.firmId, firmId),
						eq(entities.id, entityId),
						isOwnerOrAdmin(role) ? undefined : onMyEngagementTeam(actor)
					)
				);
			if (!entity) throw notFound('Entity');
			return { ...entity.entity, clientName: entity.clientName };
		},

		async createClient(actor: Actor, input: z.input<typeof createClientSchema>) {
			const values = createClientSchema.parse(input);
			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, values.firmId);
				const [client] = await tx.insert(clients).values(values).returning();
				await recordEvent(tx, {
					action: 'client.created',
					actorId: actor.id,
					tenantId: values.firmId,
					target: { type: 'client', id: client.id }
				});
				return client;
			});
		},

		/**
		 * Adds a legal entity to a client. With a company number and Companies House set
		 * up, the details come from Companies House. Without Companies House, a name is
		 * needed and the details are entered by hand.
		 */
		async createEntity(actor: Actor, input: z.input<typeof createEntitySchema>) {
			const { firmId, clientId, companyNumber, name, entityType } = createEntitySchema.parse(input);
			await requireFirmAdmin(db, actor, firmId);

			// Use Companies House when there is a number and either Companies House is set up
			// or no name was typed (then the lookup explains that Companies House is off).
			const fromCompaniesHouse =
				companyNumber !== undefined && (companiesHouse !== null || name === undefined);
			const details = fromCompaniesHouse
				? registerDetails(await lookUpCompany(actor, companyNumber))
				: {
						name: name!, // The schema requires a name when there is no company number.
						entityType: entityType ?? 'private_limited',
						companyNumber: companyNumber ?? null
					};
			const source = fromCompaniesHouse ? 'companies_house' : 'manual';

			return withCompanyNumberCheck(() =>
				inTransaction(db, async (tx) => {
					await requireFirmAdmin(tx, actor, firmId);
					const [client] = await tx
						.select({ id: clients.id })
						.from(clients)
						.where(and(eq(clients.firmId, firmId), eq(clients.id, clientId)));
					if (!client) throw notFound('Client');

					const [entity] = await tx
						.insert(entities)
						.values({ ...details, firmId, clientId })
						.returning();
					await recordEvent(tx, {
						action: 'entity.created',
						actorId: actor.id,
						tenantId: firmId,
						target: { type: 'entity', id: entity.id },
						details: { clientId, source }
					});
					return entity;
				})
			);
		},

		/** Edits an entity's details by hand. Owners and admins. */
		async updateEntity(actor: Actor, input: z.input<typeof updateEntitySchema>) {
			const { firmId, entityId, ...form } = updateEntitySchema.parse(input);
			// Fields left empty are cleared.
			const changes = {
				name: form.name,
				entityType: form.entityType,
				companyNumber: form.companyNumber ?? null,
				accountingFramework: form.accountingFramework ?? null,
				sizeClass: form.sizeClass ?? null,
				yearEndDay: form.yearEndDay ?? null,
				yearEndMonth: form.yearEndMonth ?? null
			};
			return withCompanyNumberCheck(() =>
				inTransaction(db, async (tx) => {
					await requireFirmAdmin(tx, actor, firmId);
					const before = await findEntity(tx, firmId, entityId);
					const changed = changedFields(before, changes);
					if (changed.length === 0) return before;

					const [entity] = await tx
						.update(entities)
						.set(changes)
						.where(and(eq(entities.firmId, firmId), eq(entities.id, entityId)))
						.returning();
					await recordEvent(tx, {
						action: 'entity.updated',
						actorId: actor.id,
						tenantId: firmId,
						target: { type: 'entity', id: entityId },
						details: { changed, source: 'manual' }
					});
					return entity;
				})
			);
		},

		/** Updates an entity's register details from Companies House. Owners and admins. */
		async refreshFromCompaniesHouse(actor: Actor, input: z.infer<typeof entityScopeSchema>) {
			const { firmId, entityId } = entityScopeSchema.parse(input);
			await requireFirmAdmin(db, actor, firmId);
			const current = await findEntity(db, firmId, entityId);
			if (!current.companyNumber) throw new BusinessError('COMPANY_NOT_FOUND');
			const details = registerDetails(await lookUpCompany(actor, current.companyNumber));

			return inTransaction(db, async (tx) => {
				await requireFirmAdmin(tx, actor, firmId);
				const before = await findEntity(tx, firmId, entityId);
				const [entity] = await tx
					.update(entities)
					.set(details)
					.where(and(eq(entities.firmId, firmId), eq(entities.id, entityId)))
					.returning();
				const changed = changedFields(before, details).filter(
					(field) => field !== 'companiesHouseSyncedAt'
				);
				if (changed.length > 0) {
					await recordEvent(tx, {
						action: 'entity.updated',
						actorId: actor.id,
						tenantId: firmId,
						target: { type: 'entity', id: entityId },
						details: { changed, source: 'companies_house' }
					});
				}
				return entity;
			});
		},

		/** Searches Companies House by company name or number. Owners and admins. */
		async searchCompanies(actor: Actor, input: z.infer<typeof companySearchSchema>) {
			const { firmId, query } = companySearchSchema.parse(input);
			await requireFirmAdmin(db, actor, firmId);
			if (!companiesHouse) throw new BusinessError('COMPANIES_HOUSE_NOT_CONFIGURED');
			await limiter.consume(RATE_LIMITS.companiesHouseLookupsPerUser, actor.id);
			return companiesHouse.searchCompanies(query);
		}
	};
}
