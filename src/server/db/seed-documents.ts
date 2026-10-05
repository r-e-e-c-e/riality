import { DOCUMENT_TYPES, type DocumentCategory } from '#lib/documents.js';
import { formatDate } from '#lib/format.js';
import { ENTITY_TYPES } from '#lib/companies.js';
import type { FileStorage } from '../integrations/storage';
import { auditEvents } from '../modules/audit/audit-event.entity';
import { documents } from '../modules/documents/document.entity';
import type { Database } from './connection';
import {
	fixtureId,
	seedClients,
	seedEntities,
	seedPeople,
	seedPeriods,
	seedRoles,
	seedTenants,
	seedTimestamp
} from './seed-data';

// Synthetic permanent-file documents for development: certificates, articles,
// ownership records, agreements, loan and lease documents, board minutes and
// engagement letters for every seeded entity. Generated here as small PDFs (and one
// CSV) so nothing real is ever checked in. Fixture ranges: 10 documents, 11 events.

const NOTICE = 'SYNTHETIC DOCUMENT FOR LINES DEVELOPMENT. NOT A REAL RECORD.';

/**
 * A one-page A4 PDF with a title and lines of text, in Helvetica. Just enough of the
 * PDF format to open in any viewer; text is Latin-1 (so "£" works).
 */
function makePdf(title: string, lines: string[]) {
	const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
	const text = [
		'BT /F1 9 Tf 50 800 Td',
		`(${escape(NOTICE)}) Tj`,
		'/F1 18 Tf 0 -36 Td',
		`(${escape(title)}) Tj`,
		'/F1 11 Tf',
		...lines.flatMap((line) => ['0 -18 Td', `(${escape(line)}) Tj`]),
		'ET'
	].join('\n');
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
	];
	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((object, index) => {
		offsets.push(Buffer.byteLength(pdf, 'latin1'));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = Buffer.byteLength(pdf, 'latin1');
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

type SeedDocument = {
	id: string;
	firmId: string;
	entityId: string;
	category: DocumentCategory;
	title: string;
	fileName: string;
	contentType: string;
	bytes: Uint8Array;
	uploadedBy: string;
};

/** A document's contents and description, before it is given IDs. */
type SeedFile = Pick<SeedDocument, 'category' | 'title' | 'fileName' | 'contentType' | 'bytes'>;

const pdfDocument = (category: DocumentCategory, title: string, lines: string[]): SeedFile => ({
	category,
	title,
	fileName: `${title}.pdf`,
	contentType: DOCUMENT_TYPES.pdf.contentType,
	bytes: makePdf(title, lines)
});

/** The documents a firm would hold for one entity, built from its seeded details. */
function documentsFor(entity: (typeof seedEntities)[number]) {
	const client = seedClients.find((candidate) => candidate.id === entity.clientId)!;
	const roles = seedRoles.filter((role) => role.entityId === entity.id);
	const personName = (id: string) => seedPeople.find((person) => person.id === id)!.name;
	const current = roles.filter((role) => !role.endedOn);
	const directors = current.filter(
		(role) => role.role === 'director' || role.role.startsWith('llp')
	);
	const holders = current.filter((role) => role.role === 'shareholder');
	const isLlp = entity.entityType === 'llp';
	const name = entity.name;
	const number = entity.companyNumber!;
	const office = (entity.registeredOffice ?? '').replaceAll('\n', ', ');
	const audited = seedPeriods.find((period) => period.entityId === entity.id);

	const files: SeedFile[] = [
		pdfDocument('constitution', 'Certificate of incorporation', [
			`Company number ${number}`,
			`The Registrar of Companies for England and Wales certifies that ${name}`,
			`is this day incorporated under the Companies Act 2006 as a`,
			`${ENTITY_TYPES[entity.entityType ?? 'private_limited'].toLowerCase()}.`,
			`Given on ${formatDate(entity.incorporatedOn!)}.`
		]),
		isLlp
			? pdfDocument('constitution', 'LLP members agreement', [
					`${name} (${number})`,
					'Agreement between the members as to profit shares, capital, decisions',
					'requiring unanimous consent, admission and retirement of members.',
					...directors.map((role) => `Member: ${personName(role.personId)}`)
				])
			: pdfDocument('constitution', 'Articles of association', [
					`${name} (${number})`,
					'Model articles for private companies limited by shares, with amendments:',
					'1. Directors may not allot shares without a special resolution.',
					'2. Pre-emption rights apply on any transfer of shares.',
					`Registered office: ${office}`
				])
	];

	if (holders.length > 0) {
		files.push(
			pdfDocument('ownership', 'Register of members', [
				`${name} (${number})`,
				...holders.map(
					(role) =>
						`${personName(role.personId)}: ${role.shareholdingPercent}% of ordinary shares, from ${formatDate(role.startedOn!)}`
				)
			])
		);
	}
	if (holders.length > 1) {
		files.push(
			pdfDocument('agreements', 'Shareholders agreement', [
				`Agreement between the shareholders of ${name}`,
				...holders.map((role) => `Party: ${personName(role.personId)}`),
				'Covers reserved matters, dividend policy, drag and tag rights, and the',
				'valuation of shares on the death or departure of a shareholder.'
			])
		);
	}
	if (
		holders.some((role) => seedPeople.find((p) => p.id === role.personId)?.kind === 'organisation')
	) {
		files.push(
			pdfDocument('ownership', 'Group structure chart', [
				`${client.name}: structure as at ${formatDate(seedTimestamp)}`,
				...holders.map(
					(role) => `${personName(role.personId)} owns ${role.shareholdingPercent}% of ${name}`
				)
			])
		);
	}
	if (entity.sizeClass === 'medium' && entity.companyStatus === 'active') {
		files.push(
			pdfDocument('financing', 'Bank facility letter', [
				`Northern Mutual Bank plc to the directors of ${name}`,
				'Revolving credit facility of £750,000, renewable annually.',
				'Covenants: interest cover at least 3 times; net debt below 2.5 times EBITDA.',
				'Annual audited financial statements to be delivered within 180 days.'
			]),
			{
				category: 'other' as const,
				title: 'Fixed asset register',
				fileName: 'Fixed asset register.csv',
				contentType: DOCUMENT_TYPES.csv.contentType,
				bytes: new TextEncoder().encode(
					[
						`# ${NOTICE}`,
						'Asset,Category,Acquired,Cost (£),Depreciation method',
						'Head office refurbishment,Leasehold improvements,2019-04-01,182000,Straight line 10 years',
						'Delivery vehicles (6),Motor vehicles,2022-09-15,214500,Reducing balance 25%',
						'Production line 2,Plant and machinery,2023-02-01,365000,Straight line 8 years',
						'Laptops and servers,Computer equipment,2025-06-30,48200,Straight line 3 years'
					].join('\n')
				)
			}
		);
	}
	if (office.startsWith('Unit')) {
		files.push(
			pdfDocument('property', 'Lease of business premises', [
				`Landlord: Calder Estates Ltd. Tenant: ${name}`,
				`Premises: ${office}`,
				'Term: 10 years from 1 April 2021, rent review at year 5.',
				'Rent: £48,000 a year, payable quarterly in advance. Tenant repairing.'
			])
		);
	}
	if (audited && entity.companyStatus === 'active') {
		const yearEnd = formatDate(audited.endsOn);
		files.push(
			pdfDocument('engagement', `Engagement letter, year ended ${yearEnd}`, [
				`To the directors of ${name}`,
				`We are pleased to confirm our appointment as auditor for the year ended ${yearEnd}.`,
				'Our audit will be conducted in accordance with ISAs (UK). Our responsibilities',
				'and yours, the scope of our work, fees and limitations of liability are',
				'set out below and in the attached standard terms of business.'
			]),
			pdfDocument('governance', 'Board minutes, approval of prior year accounts', [
				`Minutes of a meeting of the directors of ${name}`,
				...directors.map((role) => `Present: ${personName(role.personId)}`),
				'1. The financial statements for the prior year were approved and signed.',
				'2. The letter of representation to the auditor was approved.',
				'3. The directors confirmed there were no matters to bring to the auditor.'
			])
		);
	}
	return files;
}

/** Every seeded document, with fixed IDs. */
export function seedDocumentList(): SeedDocument[] {
	const list: SeedDocument[] = [];
	for (const entity of seedEntities) {
		const firmOwner = seedTenants.find((tenant) => tenant.id === entity.firmId)!.createdBy!;
		for (const file of documentsFor(entity)) {
			list.push({
				...file,
				id: fixtureId(10, list.length + 1),
				firmId: entity.firmId,
				entityId: entity.id,
				uploadedBy: firmOwner
			});
		}
	}
	return list;
}

/**
 * Uploads the synthetic documents to storage and records them. Safe to run again:
 * files are overwritten with the same contents and existing rows are kept.
 */
export async function seedDevelopmentDocuments(db: Database, storage: FileStorage) {
	const list = seedDocumentList();
	for (const document of list) {
		const storageKey = `firms/${document.firmId}/entities/${document.entityId}/${document.id}`;
		await storage.put(storageKey, document.bytes, document.contentType);
		const { bytes, ...row } = document;
		await db
			.insert(documents)
			.values({
				...row,
				sizeBytes: bytes.length,
				sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
				storageKey,
				createdAt: seedTimestamp
			})
			.onConflictDoNothing();
	}
	await db
		.insert(auditEvents)
		.values(
			list.map((document, index) => ({
				id: fixtureId(11, index + 1),
				action: 'document.uploaded' as const,
				actorId: document.uploadedBy,
				tenantId: document.firmId,
				targetType: 'entity' as const,
				targetId: document.entityId,
				details: {
					documentId: document.id,
					category: document.category,
					sizeBytes: document.bytes.length
				},
				createdAt: seedTimestamp
			}))
		)
		.onConflictDoNothing();
	return list.length;
}
