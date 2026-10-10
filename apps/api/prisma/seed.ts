/**
 * Demo seed — **all data here is fake**.
 *
 * Creates one demo organization with staff, a four-property portfolio, fourteen
 * tenants, twelve leases (active, pending, ended), and a **13-period backfill**
 * of charges and payments with distinct per-tenant payment behaviours — reliable
 * payers, a late payer, partial payers, a delinquent tenant — so every chart,
 * task list and aging bucket has a story to tell. Also seeds vendors, work
 * orders with notes, real downloadable documents, proofs of payment awaiting
 * review, and in-app portal notices.
 *
 * Safe to re-run: the demo organization is deleted and recreated. Never point
 * this at a database that holds real data.
 */

import { PrismaClient } from '@prisma/client';

import { enrollTenantPortal } from '../src/services/portal.js';
import { postLedgerEntry } from '../src/services/ledger.js';

import { periodForDate, shiftPeriod, utcDateToCivil } from '@pms/calendar';
import { DEFAULT_ORG_SETTINGS, ETHIOPIAN_REGIONS, UNVERIFIED_TAX_DEFAULTS } from '@pms/shared';

import { encryptField, lastFour, hashPassword } from '../src/lib/crypto.js';
import { generateCharges } from '../src/services/charges.js';
import { recordPayment } from '../src/services/payments.js';
import { getStorageDriver } from '../src/storage/index.js';

const prisma = new PrismaClient();

const DEMO_SLUG = 'bole-demo';
const DEMO_PASSWORD = 'DemoPass123';

// --- deterministic randomness (same demo every run) --------------------------
let rngState = 42;
function rnd(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)]!;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function etb(amountMajor: number): string {
  return `ETB ${amountMajor.toLocaleString('en-US')}`;
}

/**
 * A small, valid one-page PDF with a few Helvetica lines. Used for lease
 * agreements, the inspection report and payment-proof slips so every "Download"
 * in the app opens a real file.
 */
function makePdf(title: string, lines: string[]): Buffer {
  // PDF content stays ASCII: anything outside the printable range (em dashes,
  // Ethiopic) is flattened, because offsets below are computed in latin1 bytes.
  const escape = (text: string) =>
    text
      .replace(/[^\x20-\x7E]/g, '-')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  const content = [
    'BT /F1 18 Tf 56 780 Td',
    `(${escape(title)}) Tj`,
    'BT /F1 11 Tf 56 748 Td',
    ...lines.map((line, index) => `${index === 0 ? '' : '0 -18 Td '}(${escape(line)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function main(): Promise<void> {
  console.warn('Seeding DEMO data only — never run this against a database with real records.');

  // --- reference data ------------------------------------------------------
  for (const region of ETHIOPIAN_REGIONS) {
    await prisma.region.upsert({
      where: { code: region.code },
      create: { code: region.code, name: region.name, nameAm: region.nameAm, type: region.type },
      update: { name: region.name, nameAm: region.nameAm, type: region.type },
    });
  }
  const addis = await prisma.region.findUniqueOrThrow({ where: { code: 'AA' } });
  for (const city of ['Addis Ababa', 'Bishoftu', 'Adama']) {
    await prisma.city.upsert({
      where: { regionId_name: { regionId: addis.id, name: city } },
      create: { regionId: addis.id, name: city },
      update: {},
    });
  }

  const idTypes = [
    { code: 'kebele_id', label: 'Kebele ID', labelAm: 'የቀበሌ መታወቂያ' },
    { code: 'national_id_fayda', label: 'National ID (Fayda)', labelAm: 'ብሔራዊ መታወቂያ (ፋይዳ)' },
    { code: 'passport', label: 'Passport', labelAm: 'ፓስፖርት' },
    { code: 'drivers_license', label: 'Driving licence', labelAm: 'የመንጃ ፍቃድ' },
  ];
  for (const type of idTypes) {
    // `organizationId` is nullable (null = platform-wide), and a compound unique
    // upsert cannot target a NULL, so find-then-write is the correct pattern here.
    const existingType = await prisma.tenantIdType.findFirst({
      where: { organizationId: null, code: type.code },
    });
    if (existingType) {
      await prisma.tenantIdType.update({
        where: { id: existingType.id },
        data: { label: type.label, labelAm: type.labelAm },
      });
    } else {
      await prisma.tenantIdType.create({
        data: { code: type.code, label: type.label, labelAm: type.labelAm },
      });
    }
  }

  // --- clean slate for the demo organization -------------------------------
  const force = process.argv.includes('--force') || process.env.SEED_FORCE === '1';
  const existing = await prisma.organization.findUnique({ where: { slug: DEMO_SLUG } });
  if (existing && !force) {
    console.warn(
      `Demo organization "${DEMO_SLUG}" already exists — nothing to do.\n` +
        'Sign in with owner@demo.test / DemoPass123, or recreate the demo data with: pnpm db:seed:force',
    );
    return;
  }
  if (existing) {
    await prisma.organization.delete({ where: { id: existing.id } });
    console.warn('Removed the previous demo organization (cascades to its data).');
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const organization = await prisma.organization.create({
    data: {
      name: 'Bole Demo Property Management',
      slug: DEMO_SLUG,
      currency: 'ETB',
      calendar: 'ethiopian',
      language: 'en',
    },
  });

  const staff = [
    { email: 'owner@demo.test', fullName: 'Demo Owner', role: 'owner_admin' },
    { email: 'manager@demo.test', fullName: 'Demo Manager', role: 'manager' },
    { email: 'accountant@demo.test', fullName: 'Demo Accountant', role: 'accountant' },
    { email: 'maintenance@demo.test', fullName: 'Demo Technician', role: 'maintenance' },
  ];

  for (const person of staff) {
    const user = await prisma.user.upsert({
      where: { email: person.email },
      create: {
        email: person.email,
        fullName: person.fullName,
        passwordHash,
        language: 'en',
        calendar: 'ethiopian',
      },
      update: { fullName: person.fullName, passwordHash },
    });
    await prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: person.role,
        status: 'active',
        acceptedAt: new Date(),
      },
      update: { role: person.role, status: 'active' },
    });
  }
  const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@demo.test' } });

  await prisma.organizationSetting.createMany({
    data: Object.entries(DEFAULT_ORG_SETTINGS)
      .filter(([key]) => !['currency', 'defaultCalendar', 'defaultLanguage'].includes(key))
      .map(([key, value]) => ({ organizationId: organization.id, key, value: value as never })),
  });

  // Tax rules exist as data, but every one is explicitly unverified.
  for (const [code, entry] of Object.entries(UNVERIFIED_TAX_DEFAULTS)) {
    await prisma.taxRule.create({
      data: {
        organizationId: organization.id,
        code,
        name: code.replace(/_/g, ' '),
        ratePercent: entry.ratePercent,
        brackets: entry.brackets ? (entry.brackets as never) : undefined,
        effectiveFrom: new Date('2026-01-01'),
        verified: false,
        notes: entry.note,
      },
    });
  }

  // A reviewed Amharic override, to show the Translation Manager in action.
  await prisma.translationOverride.create({
    data: {
      organizationId: organization.id,
      key: 'app.name',
      language: 'am',
      text: 'የንብረት ሥራ አስኪያጅ',
      status: 'reviewed',
      reviewedAt: new Date(),
    },
  });

  // --- portfolio -----------------------------------------------------------
  const landlord = await prisma.owner.create({
    data: {
      organizationId: organization.id,
      name: 'Bole Demo Landlord',
      defaultKey: 'self',
    },
  });

  const bole = await prisma.property.create({
    data: {
      organizationId: organization.id,
      ownerId: landlord.id,
      name: 'Bole Apartments',
      code: 'BOL-01',
      type: 'apartment_block',
      regionCode: 'AA',
      region: 'Addis Ababa',
      cityOrZone: 'Addis Ababa',
      subCity: 'Bole',
      woreda: '03',
      kebele: '05',
      houseNumber: '412',
      landmark: 'Behind Bole Medhanialem, blue gate next to the pharmacy',
      yearBuilt: 2018,
      totalFloors: 3,
    },
  });

  const meg = await prisma.property.create({
    data: {
      organizationId: organization.id,
      ownerId: landlord.id,
      name: 'Megenagna Commercial',
      code: 'MEG-02',
      type: 'commercial_building',
      regionCode: 'AA',
      region: 'Addis Ababa',
      cityOrZone: 'Addis Ababa',
      subCity: 'Yeka',
      landmark: 'Opposite the bus terminal, 2nd floor',
      yearBuilt: 2015,
      totalFloors: 4,
    },
  });

  const saris = await prisma.property.create({
    data: {
      organizationId: organization.id,
      ownerId: landlord.id,
      name: 'Saris Residences',
      code: 'SRS-03',
      type: 'residential_building',
      regionCode: 'AA',
      region: 'Addis Ababa',
      cityOrZone: 'Addis Ababa',
      subCity: 'Nifas Silk-Lafto',
      houseNumber: '87',
      landmark: 'Near Saris Roundabout, behind the fuel station',
      yearBuilt: 2021,
      totalFloors: 2,
    },
  });

  const villa = await prisma.property.create({
    data: {
      organizationId: organization.id,
      ownerId: landlord.id,
      name: 'Old Airport Villa',
      code: 'OAV-04',
      type: 'single_family',
      regionCode: 'AA',
      region: 'Addis Ababa',
      cityOrZone: 'Addis Ababa',
      subCity: 'Bole',
      houseNumber: 'New-D-23',
      landmark: 'Inside Old Airport, 3rd house on the right',
      yearBuilt: 2012,
      totalFloors: 2,
      notes: 'Under renovation — expected to list next season.',
    },
  });

  type UnitSeed = {
    propertyId: string;
    label: string;
    floor: number;
    bedrooms?: number;
    bathrooms?: number;
    areaSqm: number;
    marketRentMinor: bigint;
    status: string;
    typeLabel?: string;
  };
  const unitSeeds: UnitSeed[] = [
    ...['101', '102', '103', '201', '202', '203', '301', '302', '303'].map((label, index) => ({
      propertyId: bole.id,
      label,
      floor: Number(label[0]!),
      bedrooms: index % 2 === 0 ? 2 : 3,
      bathrooms: 1,
      areaSqm: 85 + (index % 3) * 10,
      marketRentMinor: BigInt(1_200_000 + (index % 3) * 250_000),
      status: 'occupied',
      typeLabel: index % 2 === 0 ? '2BR' : '3BR',
    })),
    { propertyId: meg.id, label: 'G-01', floor: 0, areaSqm: 120, marketRentMinor: BigInt(4_500_000), status: 'occupied', typeLabel: 'Shop' },
    { propertyId: meg.id, label: 'G-02', floor: 0, areaSqm: 95, marketRentMinor: BigInt(2_800_000), status: 'occupied', typeLabel: 'Office' },
    { propertyId: meg.id, label: 'F-01', floor: 1, areaSqm: 90, marketRentMinor: BigInt(2_200_000), status: 'vacant', typeLabel: 'Office' },
    ...['A-101', 'A-102', 'A-103', 'A-104'].map((label, index) => ({
      propertyId: saris.id,
      label,
      floor: index < 2 ? 1 : 2,
      bedrooms: 2,
      bathrooms: 1,
      areaSqm: 78,
      marketRentMinor: BigInt(1_100_000 + index * 100_000),
      status: 'occupied',
      typeLabel: '2BR',
    })),
    { propertyId: villa.id, label: 'MAIN', floor: 0, bedrooms: 4, bathrooms: 3, areaSqm: 240, marketRentMinor: BigInt(6_500_000), status: 'unavailable' },
  ];
  const units = new Map<string, { id: string; label: string; propertyId: string }>();
  for (const seed of unitSeeds) {
    const unit = await prisma.unit.create({ data: { organizationId: organization.id, ...seed } });
    units.set(`${seed.propertyId}:${seed.label}`, { id: unit.id, label: unit.label, propertyId: seed.propertyId });
  }
  const unitOf = (propertyId: string, label: string) => units.get(`${propertyId}:${label}`)!;

  // Mark the story units.
  await prisma.unit.update({
    where: { id: unitOf(bole.id, '103').id },
    data: { status: 'turnover' }, // Selam's lease just ended — repaint pending
  });
  await prisma.unit.update({
    where: { id: unitOf(bole.id, '303').id },
    data: { status: 'vacant' }, // Yonas's lease starts next period
  });
  await prisma.unit.update({
    where: { id: unitOf(saris.id, 'A-104').id },
    data: { status: 'notice' }, // tenant gave notice
  });

  console.warn('Portfolio created (4 properties, 17 units).');

  // --- tenants (fake names and fake ID numbers) ----------------------------
  // All fourteen demo tenants are enrolled for the OTP portal at the end of
  // this seed, so any of these phones signs in at /portal/login.
  const tenantSeed = [
    { fullName: 'Almaz Bekele (demo)', phone: '+251911000001', language: 'am' },
    { fullName: 'Dawit Haile (demo)', phone: '+251911000002', language: 'am' },
    { fullName: 'Fatuma Ahmed (demo)', phone: '+251911000003', language: 'om' },
    { fullName: 'Gebre Tesfay (demo)', phone: '+251911000004', language: 'ti' },
    { fullName: 'Hanna Girma (demo)', phone: '+251911000005', language: 'en' },
    { fullName: 'Kebede Alemu (demo)', phone: '+251911000006', language: 'am' },
    { fullName: 'Selam Tadesse (demo)', phone: '+251911000007', language: 'om' },
    { fullName: 'Yonas Mekonnen (demo)', phone: '+251911000008', language: 'ti' },
    { fullName: 'Meron Assefa (demo)', phone: '+251911000009', language: 'en' },
    { fullName: 'Tewodros Bekele (demo)', phone: '+251911000010', language: 'am' },
    { fullName: 'Aster Girma (demo)', phone: '+251911000011', language: 'om' },
    { fullName: 'Solomon Haile (demo)', phone: '+251911000012', language: 'ti' },
    { fullName: 'Rahel Worku (demo)', phone: '+251911000013', language: 'en' },
    { fullName: 'Bekelech Tessema (demo)', phone: '+251911000014', language: 'am' },
  ];

  const tenants = [];
  for (const [index, seed] of tenantSeed.entries()) {
    const tenant = await prisma.tenant.create({
      data: {
        organizationId: organization.id,
        fullName: seed.fullName,
        phone: seed.phone,
        language: seed.language,
        emergencyContactName: pick(['Demo Contact', 'Family Contact', 'Work Contact']),
        emergencyContactPhone: `+2519111000${String(index + 1).padStart(2, '0')}`,
        employer: index % 3 === 0 ? 'Commercial Bank of Ethiopia (demo)' : undefined,
        idDocuments: {
          create: {
            organizationId: organization.id,
            typeCode: index % 2 === 0 ? 'kebele_id' : 'national_id_fayda',
            numberEncrypted: encryptField(`DEMO-0000-000${index}`),
            numberLast4: lastFour(`DEMO-0000-000${index}`),
          },
        },
      },
    });
    tenants.push(tenant);
  }

  // --- leases ---------------------------------------------------------------
  // All leases are billed in the organization's calendar (Ethiopian). Each has
  // a payment behaviour used to backfill charges + payments below, so the
  // dashboards show a living portfolio rather than a snapshot.
  const ethiopianToday = utcDateToCivil(new Date(), 'ethiopian');
  const currentPeriod = periodForDate(ethiopianToday);
  const periodKeyOf = (shift: number) => shiftPeriod(currentPeriod, shift).key;
  const periodStartUtc = (shift: number) =>
    new Date(`${periodKeyOf(shift)}-01T00:00:00.000Z`);
  const BACKFILL_SHIFT = -12; // thirteen periods of history, current included

  type LeaseSeed = {
    unit: { id: string; label: string; propertyId: string };
    tenantIndex: number;
    rentMinor: bigint;
    dueDay: number;
    /** Negative shift of the period the lease starts in. */
    startShift: number;
    status: 'active' | 'pending' | 'ended';
    frequency?: 'monthly' | 'quarterly';
    endShift?: number; // for 'ended': the first NOT-billed period
    behavior: 'reliable' | 'late' | 'partial' | 'delinquent' | 'ended' | 'none';
    escalation?: { percent: number; everyMonths: number };
    depositMonths?: number;
  };

  const leaseSeeds: LeaseSeed[] = [
    { unit: unitOf(bole.id, '101'), tenantIndex: 0, rentMinor: 1_500_000n, dueDay: 5, startShift: -13, status: 'active', behavior: 'reliable', depositMonths: 2 },
    { unit: unitOf(bole.id, '102'), tenantIndex: 1, rentMinor: 1_800_000n, dueDay: 5, startShift: -13, status: 'active', behavior: 'late', depositMonths: 2 },
    { unit: unitOf(bole.id, '201'), tenantIndex: 2, rentMinor: 1_250_000n, dueDay: 10, startShift: -10, status: 'active', behavior: 'partial', depositMonths: 1 },
    { unit: unitOf(bole.id, '202'), tenantIndex: 3, rentMinor: 2_000_000n, dueDay: 1, startShift: -8, status: 'active', behavior: 'reliable', escalation: { percent: 5, everyMonths: 12 }, depositMonths: 2 },
    { unit: unitOf(bole.id, '301'), tenantIndex: 4, rentMinor: 1_550_000n, dueDay: 5, startShift: -13, status: 'active', behavior: 'delinquent', depositMonths: 1 },
    { unit: unitOf(bole.id, '302'), tenantIndex: 5, rentMinor: 1_400_000n, dueDay: 15, startShift: -6, status: 'active', behavior: 'reliable', depositMonths: 2 },
    { unit: unitOf(bole.id, '103'), tenantIndex: 6, rentMinor: 1_300_000n, dueDay: 5, startShift: -13, status: 'ended', endShift: -2, behavior: 'ended', depositMonths: 1 },
    { unit: unitOf(bole.id, '303'), tenantIndex: 7, rentMinor: 1_600_000n, dueDay: 5, startShift: 1, status: 'pending', behavior: 'none', depositMonths: 2 },
    { unit: unitOf(meg.id, 'G-01'), tenantIndex: 8, rentMinor: 4_500_000n, dueDay: 1, startShift: -13, status: 'active', frequency: 'quarterly', behavior: 'reliable', depositMonths: 3 },
    { unit: unitOf(meg.id, 'G-02'), tenantIndex: 9, rentMinor: 2_800_000n, dueDay: 1, startShift: -5, status: 'active', behavior: 'partial', depositMonths: 2 },
    { unit: unitOf(saris.id, 'A-101'), tenantIndex: 10, rentMinor: 1_100_000n, dueDay: 7, startShift: -12, status: 'active', behavior: 'reliable', depositMonths: 1 },
    { unit: unitOf(saris.id, 'A-102'), tenantIndex: 11, rentMinor: 1_350_000n, dueDay: 7, startShift: -13, status: 'active', behavior: 'partial', depositMonths: 2 },
  ];

  const leaseRefs = ['BLD-101-24', 'BLD-102-24', 'BLD-201-24', 'BLD-202-24', 'BLD-301-24', 'BLD-302-24', 'BLD-103-24', 'BLD-303-25', 'MEG-G01-24', 'MEG-G02-25', 'SRS-101-24', 'SRS-102-24'];

  const leases: { seed: LeaseSeed; id: string }[] = [];
  for (const [index, seed] of leaseSeeds.entries()) {
    const endDate = seed.status === 'ended' && seed.endShift !== undefined
      ? addDays(periodStartUtc(seed.endShift), -1)
      : undefined;
    const depositAmount = seed.depositMonths ? seed.rentMinor * BigInt(seed.depositMonths) : undefined;
    const lease = await prisma.lease.create({
      data: {
        organizationId: organization.id,
        unitId: seed.unit.id,
        tenantId: tenants[seed.tenantIndex]!.id,
        referenceNumber: leaseRefs[index],
        billingCalendar: 'ethiopian',
        status: seed.status,
        startDate: periodStartUtc(seed.startShift),
        endDate,
        rentAmountMinor: seed.rentMinor,
        currency: 'ETB',
        billingFrequency: seed.frequency ?? 'monthly',
        dueDayOfMonth: seed.dueDay,
        gracePeriodDays: seed.behavior === 'late' ? 5 : 0,
        depositType: seed.depositMonths ? 'months_of_rent' : 'none',
        depositMonths: seed.depositMonths,
        depositAmountMinor: depositAmount,
        depositHeldMinor: seed.status === 'active' ? depositAmount ?? 0n : 0n,
        escalationPercent: seed.escalation?.percent,
        escalationEveryMonths: seed.escalation?.everyMonths,
        signedAt: seed.status === 'pending' ? undefined : addDays(periodStartUtc(seed.startShift), -3),
      },
    });
    leases.push({ seed, id: lease.id });
  }

  // Bekelech co-signs Almaz's lease — shows the co-tenant relationship.
  await prisma.leaseCoTenant.create({
    data: {
      leaseId: leases[0]!.id,
      tenantId: tenants[13]!.id,
      role: 'co_tenant',
    },
  });

  // --- charges: the 13-period backfill ---------------------------------------
  const periodKeys = Array.from({ length: -BACKFILL_SHIFT + 1 }, (_, index) =>
    periodKeyOf(BACKFILL_SHIFT + index),
  );
  const billingLeaseIds = leases
    .filter(({ seed }) => seed.behavior !== 'none')
    .map(({ id }) => id);
  const generation = await generateCharges(prisma, {
    organizationId: organization.id,
    periodKeys,
    leaseIds: billingLeaseIds,
    actorUserId: ownerUser.id,
  });

  // Extra charges the generator does not create, each with its ledger entry so
  // the ledger reconciles with the charge rows:
  const kebedeLease = leases.find(({ seed }) => seed.tenantIndex === 5)!;
  for (const periodKey of periodKeys.filter((key) => key >= periodKeyOf(-5))) {
    const rentCharge = await prisma.charge.findFirstOrThrow({
      where: { leaseId: kebedeLease.id, periodKey, type: 'rent' },
    });
    const water = await prisma.charge.create({
      data: {
        organizationId: organization.id,
        leaseId: kebedeLease.id,
        tenantId: tenants[5]!.id,
        unitId: kebedeLease.seed.unit.id,
        type: 'utility_water',
        description: 'Water utility — building meter share',
        periodKey,
        periodCalendar: 'ethiopian',
        periodStart: rentCharge.periodStart,
        periodEnd: rentCharge.periodEnd,
        dueDate: rentCharge.dueDate,
        amountMinor: 35_000n,
        currency: 'ETB',
        status: 'open',
        createdById: ownerUser.id,
      },
    });
    await postLedgerEntry(prisma, {
      organizationId: organization.id,
      leaseId: kebedeLease.id,
      chargeId: water.id,
      kind: 'charge',
      amountMinor: 35_000n,
      currency: 'ETB',
      occurredAt: rentCharge.periodStart,
      memo: `Water ${periodKey}`,
      createdById: ownerUser.id,
    });
  }

  // Hanna (delinquent): a one-off late fee two periods ago, still open.
  const hannaLease = leases.find(({ seed }) => seed.tenantIndex === 4)!;
  const hannaLateFeeRent = await prisma.charge.findFirstOrThrow({
    where: { leaseId: hannaLease.id, periodKey: periodKeyOf(-3), type: 'rent' },
  });
  const lateFee = await prisma.charge.create({
    data: {
      organizationId: organization.id,
      leaseId: hannaLease.id,
      tenantId: tenants[4]!.id,
      unitId: hannaLease.seed.unit.id,
      type: 'late_fee',
      description: 'Late payment fee — 2% of monthly rent',
      periodKey: periodKeyOf(-3),
      periodCalendar: 'ethiopian',
      periodStart: hannaLateFeeRent.periodStart,
      periodEnd: hannaLateFeeRent.periodEnd,
      dueDate: addDays(hannaLateFeeRent.dueDate, 10),
      amountMinor: 31_000n,
      currency: 'ETB',
      status: 'open',
      lateFeeAppliedAt: new Date(),
      createdById: ownerUser.id,
    },
  });
  await postLedgerEntry(prisma, {
    organizationId: organization.id,
    leaseId: hannaLease.id,
    chargeId: lateFee.id,
    kind: 'charge',
    amountMinor: 31_000n,
    currency: 'ETB',
    occurredAt: lateFee.dueDate,
    memo: `Late fee ${periodKeyOf(-3)}`,
    createdById: ownerUser.id,
  });

  // Tewodros: a parking charge the manager waived — shows the waiver flow.
  const tewodrosLease = leases.find(({ seed }) => seed.tenantIndex === 9)!;
  const tewodrosRent = await prisma.charge.findFirstOrThrow({
    where: { leaseId: tewodrosLease.id, periodKey: periodKeyOf(-1), type: 'rent' },
  });
  await prisma.charge.create({
    data: {
      organizationId: organization.id,
      leaseId: tewodrosLease.id,
      tenantId: tenants[9]!.id,
      unitId: tewodrosLease.seed.unit.id,
      type: 'parking',
      description: 'Reserved parking — basement bay 4',
      periodKey: periodKeyOf(-1),
      periodCalendar: 'ethiopian',
      periodStart: tewodrosRent.periodStart,
      periodEnd: tewodrosRent.periodEnd,
      dueDate: tewodrosRent.dueDate,
      amountMinor: 100_000n,
      currency: 'ETB',
      status: 'waived',
      waiverReason: 'Demo: waived by manager — garage was closed for maintenance',
      createdById: ownerUser.id,
    },
  });

  console.warn(
    `Charges generated: ${generation.created} rent periods (+ water, late fee, waived parking).`,
  );

  // --- payments: per-tenant behaviour across the backfill ---------------------
  const PAYMENT_METHODS_CYCLE = [
    { method: 'telebirr' as const, provider: 'telebirr' },
    { method: 'bank_transfer' as const },
    { method: 'cash' as const },
    { method: 'cheque' as const },
  ];
  let paymentSeq = 0;
  const tenantLatestPayment = new Map<number, { amountMinor: bigint; paidAt: Date }>();

  async function payCharge(
    leaseId: string,
    tenantIndex: number,
    chargeId: string,
    amountMinor: bigint,
    paidAt: Date,
    method: (typeof PAYMENT_METHODS_CYCLE)[number],
  ): Promise<void> {
    paymentSeq += 1;
    await recordPayment(prisma, {
      organizationId: organization.id,
      actorUserId: ownerUser.id,
      leaseId,
      amount: { amountMinor: Number(amountMinor), currency: 'ETB' },
      method: method.method,
      paidAt,
      provider: method.provider ?? null,
      providerRef: method.provider ? `DEMO-${method.method.toUpperCase()}-${String(paymentSeq).padStart(4, '0')}` : null,
      reference: `DEMO-${String(paymentSeq).padStart(4, '0')}`,
      notes: 'Demo backfill',
      allocations: [{ chargeId, amount: { amountMinor: Number(amountMinor), currency: 'ETB' } }],
    });
    tenantLatestPayment.set(tenantIndex, { amountMinor, paidAt });
  }

  for (const { seed, id: leaseId } of leases) {
    if (seed.behavior === 'none') continue;
    const charges = await prisma.charge.findMany({
      where: { leaseId, type: 'rent' },
      orderBy: { dueDate: 'asc' },
    });

    for (const [index, charge] of charges.entries()) {
      const method = PAYMENT_METHODS_CYCLE[index % PAYMENT_METHODS_CYCLE.length]!;
      if (seed.behavior === 'reliable') {
        // Every bill, two days early, full amount — including water extras.
        const extras = await prisma.charge.findMany({
          where: { leaseId, dueDate: charge.dueDate, status: 'open', type: { not: 'rent' } },
        });
        await payCharge(leaseId, seed.tenantIndex, charge.id, charge.amountMinor, addDays(charge.dueDate, -2), method);
        for (const extra of extras) {
          await payCharge(leaseId, seed.tenantIndex, extra.id, extra.amountMinor, addDays(charge.dueDate, -2), method);
        }
      } else if (seed.behavior === 'late') {
        // Always pays in full — but six days after the due date, every time.
        await payCharge(leaseId, seed.tenantIndex, charge.id, charge.amountMinor, addDays(charge.dueDate, 6), { method: 'bank_transfer' });
      } else if (seed.behavior === 'partial') {
        // 70% on the due date in cash; roughly every third bill gets caught up
        // two weeks later, the rest keeps drifting as arrears.
        const part = BigInt(Math.floor(Number(charge.amountMinor) * 0.7));
        await payCharge(leaseId, seed.tenantIndex, charge.id, part, charge.dueDate, { method: 'cash' });
        if (index % 3 === 1) {
          await payCharge(leaseId, seed.tenantIndex, charge.id, charge.amountMinor - part, addDays(charge.dueDate, 14), { method: 'bank_transfer' });
        }
      } else if (seed.behavior === 'delinquent') {
        // Paid like clockwork — until three periods ago, then nothing at all.
        const stopPayingFrom = charges.length - 3;
        if (index < stopPayingFrom) {
          await payCharge(leaseId, seed.tenantIndex, charge.id, charge.amountMinor, addDays(charge.dueDate, -1), method);
        }
      } else if (seed.behavior === 'ended') {
        // The ended lease settled every bill before moving out.
        await payCharge(leaseId, seed.tenantIndex, charge.id, charge.amountMinor, addDays(charge.dueDate, -2), method);
      }
    }
  }

  // Meron (G-01): paid everything and a little more — the ledger keeps the
  // 500 ETB overpayment as credit, shown on the portal as credit.
  await recordPayment(prisma, {
    organizationId: organization.id,
    actorUserId: ownerUser.id,
    leaseId: leases.find(({ seed }) => seed.tenantIndex === 8)!.id,
    amount: { amountMinor: 50_000, currency: 'ETB' },
    method: 'telebirr',
    paidAt: addDays(new Date(), -3),
    provider: 'telebirr',
    providerRef: 'DEMO-TELEBIRR-CREDIT',
    reference: 'DEMO-CREDIT-0001',
    notes: 'Demo: overpayment kept as credit',
  });

  console.warn(`Payments recorded: ${paymentSeq + 1} across ${leases.length - 1} billing leases.`);

  // --- vendors and maintenance -----------------------------------------------
  const vendorPlumbing = await prisma.vendor.create({
    data: { organizationId: organization.id, name: 'Blue Nile Plumbing', category: 'plumbing', phone: '+251911200101', email: 'work@bluenileplumbing.demo', tinNumber: '0012345678' },
  });
  const vendorElectric = await prisma.vendor.create({
    data: { organizationId: organization.id, name: 'Addis Spark Electrical', category: 'electrical', phone: '+251911200102', email: 'dispatch@addisspark.demo', tinNumber: '0012345679' },
  });
  const vendorHvac = await prisma.vendor.create({
    data: { organizationId: organization.id, name: 'NiceCool HVAC', category: 'hvac', phone: '+251911200104', email: 'service@nicecool.demo', tinNumber: '0012345681' },
  });
  const vendorCleaning = await prisma.vendor.create({
    data: { organizationId: organization.id, name: 'Sheba Facilities Care', category: 'cleaning', phone: '+251911200103', email: 'hello@shebacare.demo', tinNumber: '0012345680' },
  });

  const now = new Date();
  const workOrders = [
    {
      propertyId: bole.id, unitId: unitOf(bole.id, '301').id, tenantId: tenants[4]!.id,
      title: 'Kitchen sink leaking under the cabinet', description: 'Water pools under the sink every time the tap runs; the cabinet base is soaked.',
      category: 'plumbing', priority: 'urgent', status: 'open', reportedAt: addDays(now, -2),
      estimatedCostMinor: 150_000n,
    },
    {
      propertyId: bole.id, unitId: unitOf(bole.id, '101').id, tenantId: tenants[0]!.id,
      title: 'Bedroom socket sparking', description: 'The socket next to the bed sparked when unplugging a heater.',
      category: 'electrical', priority: 'high', status: 'assigned', reportedAt: addDays(now, -4),
      scheduledFor: addDays(now, 2), vendorId: vendorElectric.id, estimatedCostMinor: 90_000n,
    },
    {
      propertyId: meg.id, unitId: unitOf(meg.id, 'G-01').id, tenantId: tenants[8]!.id,
      title: 'AC not cooling in the shop', description: 'The split AC runs but the air is not cold; customers complain in the afternoon.',
      category: 'hvac', priority: 'normal', status: 'in_progress', reportedAt: addDays(now, -9),
      vendorId: vendorHvac.id, estimatedCostMinor: 450_000n,
    },
    {
      propertyId: saris.id, unitId: unitOf(saris.id, 'A-102').id, tenantId: tenants[11]!.id,
      title: 'Rooftop water pump failure', description: 'No water reaches the top floor; the pump hums but does not start.',
      category: 'water_pump', priority: 'urgent', status: 'in_progress', reportedAt: addDays(now, -6),
      estimatedCostMinor: 320_000n,
      notes: {
        create: [
          { organizationId: organization.id, authorName: 'Demo Technician', body: 'Technician confirmed the pump needs replacement — model GB-15.', internal: false, createdAt: addDays(now, -5) },
          { organizationId: organization.id, authorName: 'Demo Owner', body: 'Vendor quoted 3,200 ETB including labour. Approved.', internal: true, createdAt: addDays(now, -4) },
        ],
      },
    },
    {
      propertyId: bole.id,
      title: 'Corridor lights out on floor 2', description: 'Three of the corridor bulbs are burnt out; the floor is dark at night.',
      category: 'electrical', priority: 'normal', status: 'completed', reportedAt: addDays(now, -25),
      completedAt: addDays(now, -21), vendorId: vendorElectric.id,
      estimatedCostMinor: 130_000n, actualCostMinor: 120_000n,
    },
    {
      propertyId: bole.id, unitId: unitOf(bole.id, '202').id, tenantId: tenants[3]!.id,
      title: 'Front door lock replacement', description: 'The lock cylinder jams; the tenant had to climb through the kitchen window once.',
      category: 'carpentry', priority: 'low', status: 'completed', reportedAt: addDays(now, -40),
      completedAt: addDays(now, -37), estimatedCostMinor: 90_000n, actualCostMinor: 85_000n,
    },
    {
      propertyId: meg.id, unitId: unitOf(meg.id, 'F-01').id,
      title: 'Repaint office before listing', description: 'Walls are scuffed after the previous tenant moved out.',
      category: 'painting', priority: 'low', status: 'on_hold', reportedAt: addDays(now, -12),
      estimatedCostMinor: 300_000n,
    },
    {
      propertyId: bole.id, unitId: unitOf(bole.id, '102').id, tenantId: tenants[1]!.id,
      title: 'Bathroom faucet drip', description: 'Constant drip from the bath faucet; the tenant can shut it off at the valve.',
      category: 'plumbing', priority: 'normal', status: 'completed', reportedAt: addDays(now, -18),
      completedAt: addDays(now, -16), vendorId: vendorPlumbing.id, actualCostMinor: 45_000n,
    },
    {
      propertyId: saris.id, unitId: unitOf(saris.id, 'A-101').id, tenantId: tenants[10]!.id,
      title: 'Deep clean after move-in', description: 'Requesting a full clean including windows before furniture arrives.',
      category: 'cleaning', priority: 'normal', status: 'completed', reportedAt: addDays(now, -60),
      completedAt: addDays(now, -58), vendorId: vendorCleaning.id, actualCostMinor: 60_000n,
    },
  ];
  for (const workOrder of workOrders) {
    await prisma.workOrder.create({
      data: { organizationId: organization.id, createdById: ownerUser.id, ...workOrder },
    });
  }
  console.warn(`Vendors: 4. Work orders: ${workOrders.length} across the status board.`);

  // --- documents (real files through the storage driver) ----------------------
  const storage = getStorageDriver();
  const boleName = 'Bole Apartments';
  for (const { seed, id: leaseId } of leases) {
    if (seed.status === 'pending') continue;
    const tenant = tenants[seed.tenantIndex]!;
    const propertyName = seed.unit.propertyId === bole.id ? boleName : seed.unit.propertyId === meg.id ? 'Megenagna Commercial' : 'Saris Residences';
    const stored = await storage.save({
      organizationId: organization.id,
      filename: `lease-agreement-${seed.unit.label}.pdf`,
      mimeType: 'application/pdf',
      data: makePdf(`Lease Agreement - ${propertyName} ${seed.unit.label}`, [
        'This is a fictional demo document generated by the demo seed.',
        `Tenant: ${tenant.fullName}`,
        `Unit: ${propertyName}, ${seed.unit.label}`,
        `Monthly rent: ${etb(Number(seed.rentMinor) / 100)} (billed in the Ethiopian calendar)`,
        `Start: ${periodStartUtc(seed.startShift).toISOString().slice(0, 10)}${seed.endShift !== undefined ? `  End: ${addDays(periodStartUtc(seed.endShift), -1).toISOString().slice(0, 10)}` : ''}`,
        'All names and numbers are fake. For demo purposes only.',
      ]),
    });
    await prisma.document.create({
      data: {
        organizationId: organization.id,
        category: 'lease_agreement',
        title: `Lease agreement — ${seed.unit.label}`,
        storageDriver: stored.driver,
        storageKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: BigInt(stored.sizeBytes),
        checksumSha256: stored.checksumSha256,
        propertyId: seed.unit.propertyId,
        unitId: seed.unit.id,
        tenantId: tenant.id,
        leaseId,
        uploadedById: ownerUser.id,
      },
    });
  }
  const inspection = await storage.save({
    organizationId: organization.id,
    filename: 'move-in-inspection-bole.pdf',
    mimeType: 'application/pdf',
    data: makePdf('Move-in Inspection - Bole Apartments', [
      'Fictional demo inspection report generated by the demo seed.',
      'Scope: common areas, roof drainage, generator and pump room.',
      'Findings: corridor lighting replaced; water pump serviced.',
    ]),
  });
  await prisma.document.create({
    data: {
      organizationId: organization.id,
      category: 'inspection_report',
      title: 'Move-in inspection — Bole Apartments',
      storageDriver: inspection.driver,
      storageKey: inspection.key,
      mimeType: inspection.mimeType,
      sizeBytes: BigInt(inspection.sizeBytes),
      checksumSha256: inspection.checksumSha256,
      propertyId: bole.id,
      uploadedById: ownerUser.id,
    },
  });
  console.warn('Documents: lease agreements + inspection report (real downloadable PDFs).');

  // --- proofs of payment awaiting review --------------------------------------
  const slipFor = (tenantName: string, amount: string) =>
    makePdf(`Payment slip - ${tenantName}`, [
      'Fictional demo bank slip generated by the demo seed.',
      `Amount: ${amount}`,
      'Channel: CBE mobile banking',
    ]);
  const asterProofDoc = await storage.save({
    organizationId: organization.id,
    filename: 'slip-aster-cbe.pdf',
    mimeType: 'application/pdf',
    data: slipFor('Aster Girma', etb(11_000)),
  });
  await prisma.paymentProof.create({
    data: {
      organizationId: organization.id,
      tenantId: tenants[10]!.id,
      leaseId: leases.find(({ seed }) => seed.tenantIndex === 10)!.id,
      documentId: (
        await prisma.document.create({
          data: {
            organizationId: organization.id,
            category: 'payment_proof',
            title: 'Bank slip — CBE transfer',
            storageDriver: asterProofDoc.driver,
            storageKey: asterProofDoc.key,
            mimeType: asterProofDoc.mimeType,
            sizeBytes: BigInt(asterProofDoc.sizeBytes),
            checksumSha256: asterProofDoc.checksumSha256,
            tenantId: tenants[10]!.id,
            uploadedById: ownerUser.id,
          },
        })
      ).id,
      amountMinor: 1_100_000n,
      currency: 'ETB',
      method: 'bank_transfer',
      reference: 'CBE-778812',
      notes: 'Paid the current month from CBE — slip attached.',
      status: 'pending',
    },
  });
  const solomonProofDoc = await storage.save({
    organizationId: organization.id,
    filename: 'slip-solomon-blurry.pdf',
    mimeType: 'application/pdf',
    data: slipFor('Solomon Haile', etb(13_500)),
  });
  await prisma.paymentProof.create({
    data: {
      organizationId: organization.id,
      tenantId: tenants[11]!.id,
      leaseId: leases.find(({ seed }) => seed.tenantIndex === 11)!.id,
      documentId: (
        await prisma.document.create({
          data: {
            organizationId: organization.id,
            category: 'payment_proof',
            title: 'Bank slip — unreadable photo',
            storageDriver: solomonProofDoc.driver,
            storageKey: solomonProofDoc.key,
            mimeType: solomonProofDoc.mimeType,
            sizeBytes: BigInt(solomonProofDoc.sizeBytes),
            checksumSha256: solomonProofDoc.checksumSha256,
            tenantId: tenants[11]!.id,
            uploadedById: ownerUser.id,
          },
        })
      ).id,
      amountMinor: 1_350_000n,
      currency: 'ETB',
      method: 'bank_transfer',
      reference: 'CBE-99231',
      status: 'rejected',
      reviewedById: ownerUser.id,
      reviewedAt: addDays(now, -2),
      reviewNotes: 'Slip is unreadable and the reference does not match — asked the tenant to re-upload.',
    },
  });
  console.warn('Payment proofs: 1 pending review, 1 rejected (with reason).');

  // --- tenant portal demo ---------------------------------------------------
  // Every demo tenant is enrolled, so any seeded phone (+251911000001 … 014,
  // or the local 0911… form) works at /portal/login: request a code, read it
  // from the [worker] log (mock SMS in dev), sign in. Local form (09…) and
  // international form (+2519…) resolve to the same tenant.
  for (const tenant of tenants) {
    await enrollTenantPortal(prisma, {
      organizationId: organization.id,
      actorUserId: ownerUser.id,
      tenantId: tenant.id,
    });
  }

  // --- in-app portal notices --------------------------------------------------
  // Rendered on the portal overview with the notification i18n templates
  // (notification.rent_due_soon / rent_overdue / payment_received). Payload
  // values are pre-formatted strings, the same contract the SMS renderer uses.
  for (const { seed } of leases) {
    if (seed.behavior === 'none') continue;
    // Re-read the tenant: enrollment above ran after the in-memory copies were
    // created, so their `userId` is stale — only a fresh read has it.
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenants[seed.tenantIndex]!.id },
      select: { id: true, userId: true, language: true },
    });
    if (!tenant.userId) continue;
    const language = tenant.language ?? 'en';
    const base = {
      organizationId: organization.id,
      channel: 'in_app',
      recipientUserId: tenant.userId,
      language,
      status: 'sent',
      sentAt: addDays(now, -1),
    };
    const latest = tenantLatestPayment.get(seed.tenantIndex);
    await prisma.notification.create({
      data: {
        ...base,
        templateKey: 'notification.payment_received',
        payload: { amount: etb(Number(latest?.amountMinor ?? seed.rentMinor) / 100) },
        createdAt: latest?.paidAt ?? addDays(now, -1),
      },
    });
    if (seed.behavior === 'delinquent' || seed.behavior === 'partial') {
      const oldestUnpaid = await prisma.charge.findFirst({
        where: { leaseId: leases.find((entry) => entry.seed === seed)!.id, status: { in: ['open', 'partial'] }, type: 'rent' },
        orderBy: { dueDate: 'asc' },
      });
      if (oldestUnpaid) {
        await prisma.notification.create({
          data: {
            ...base,
            templateKey: 'notification.rent_overdue',
            payload: {
              amount: etb(Number(oldestUnpaid.amountMinor - oldestUnpaid.paidMinor) / 100),
              dueDate: oldestUnpaid.dueDate.toISOString().slice(0, 10),
            },
            createdAt: addDays(now, -2),
          },
        });
      }
    } else {
      const nextDue = await prisma.charge.findFirst({
        where: { leaseId: leases.find((entry) => entry.seed === seed)!.id, status: 'open', type: 'rent' },
        orderBy: { dueDate: 'asc' },
      });
      if (nextDue) {
        await prisma.notification.create({
          data: {
            ...base,
            templateKey: 'notification.rent_due_soon',
            payload: {
              amount: etb(Number(nextDue.amountMinor) / 100),
              dueDate: nextDue.dueDate.toISOString().slice(0, 10),
            },
            createdAt: addDays(now, -1),
          },
        });
      }
    }
  }

  const chargeCount = await prisma.charge.count({ where: { organizationId: organization.id } });
  const paymentCount = await prisma.payment.count({ where: { organizationId: organization.id } });

  console.warn(
    [
      '',
      'Demo seed complete — a living, 13-period portfolio.',
      `  Organization : ${organization.name} (slug: ${DEMO_SLUG})`,
      `  Sign in with : owner@demo.test / ${DEMO_PASSWORD}  (also manager@, accountant@, maintenance@)`,
      '  Tenant portal: all 14 demo tenants are enrolled — any of these phones',
      `                 works at /portal/login: ${tenants.map((tenant) => tenant.phone).join(', ')}`,
      '                 (no password: the one-time code is printed in the [worker] log)',
      `  Properties   : 4 (17 units — occupied, vacant, notice, turnover)`,
      `  Tenants      : ${tenants.length} (all portal-enrolled; 1 co-tenant)`,
      `  Leases       : ${leases.length} (10 active, 1 pending, 1 ended; 1 quarterly commercial, 1 escalating)`,
      `  Money        : ${chargeCount} charges, ${paymentCount} payments across 13 periods`,
      '                 behaviours: reliable, late payer, partial payers, 1 delinquent (arrears aging), 1 credit',
      `  Operations   : ${workOrders.length} work orders, 4 vendors, lease PDFs, 1 proof pending review`,
      '  All names, phone numbers and ID numbers are fictional.',
      '',
    ].join('\n'),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
