/**
 * Demo seed — **all data here is fake**.
 *
 * Creates one demo organization with staff, properties, units, tenants, an
 * set of leases billed in the organization's Ethiopian calendar, generated charges and a couple of
 * manual payments, plus unverified tax rules and a sample translation override.
 *
 * Safe to re-run: the demo organization is deleted and recreated. Never point this
 * at a database that holds real data.
 */

import { PrismaClient } from '@prisma/client';

import { enrollTenantPortal } from '../src/services/portal.js';

import { todayIn, periodForDate, shiftPeriod, utcDateToCivil } from '@pms/calendar';
import { DEFAULT_ORG_SETTINGS, ETHIOPIAN_REGIONS, UNVERIFIED_TAX_DEFAULTS } from '@pms/shared';

import { encryptField, lastFour, hashPassword } from '../src/lib/crypto.js';
import { generateCharges } from '../src/services/charges.js';
import { recordPayment } from '../src/services/payments.js';

const prisma = new PrismaClient();

const DEMO_SLUG = 'bole-demo';
const DEMO_PASSWORD = 'DemoPass123';

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
      totalFloors: 5,
    },
  });

  const shop = await prisma.property.create({
    data: {
      organizationId: organization.id,
      ownerId: landlord.id,
      name: 'Megenagna Commercial',
      code: 'MEG-02',
      type: 'commercial_building',
      regionCode: 'AA',
      region: 'Addis Ababa',
      subCity: 'Yeka',
      landmark: 'Opposite the bus terminal, 2nd floor',
    },
  });

  const units = await Promise.all(
    ['101', '102', '201', '202', '301', '302'].map((label, index) =>
      prisma.unit.create({
        data: {
          organizationId: organization.id,
          propertyId: bole.id,
          label,
          floor: Number(label[0]),
          bedrooms: index % 2 === 0 ? 2 : 3,
          bathrooms: 1,
          areaSqm: 85 + index * 5,
          marketRentMinor: BigInt(1_200_000 + index * 100_000),
          status: index < 4 ? 'occupied' : 'vacant',
        },
      }),
    ),
  );

  const shopUnit = await prisma.unit.create({
    data: {
      organizationId: organization.id,
      propertyId: shop.id,
      label: 'G-01',
      floor: 0,
      areaSqm: 120,
      marketRentMinor: BigInt(4_500_000),
      status: 'occupied',
    },
  });

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
        emergencyContactName: 'Demo Contact',
        emergencyContactPhone: '+251911000099',
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

  // All leases inherit the organization's billing calendar (Ethiopian here).
  const today = new Date();
  const ethiopianToday = utcDateToCivil(today, 'ethiopian');

  const ethiopianLease = await prisma.lease.create({
    data: {
      organizationId: organization.id,
      unitId: units[0]!.id,
      tenantId: tenants[0]!.id,
      billingCalendar: 'ethiopian',
      status: 'active',
      startDate: new Date(shiftPeriod(periodForDate(ethiopianToday), -3).key + '-01T00:00:00.000Z'),
      rentAmountMinor: BigInt(1_500_000),
      currency: 'ETB',
      dueDayOfMonth: 5,
      depositType: 'months_of_rent',
      depositMonths: 2,
      depositAmountMinor: BigInt(3_000_000),
    },
  });

  const secondLease = await prisma.lease.create({
    data: {
      organizationId: organization.id,
      unitId: units[1]!.id,
      tenantId: tenants[1]!.id,
      billingCalendar: 'ethiopian',
      status: 'active',
      startDate: new Date(shiftPeriod(periodForDate(ethiopianToday), -2).key + '-01T00:00:00.000Z'),
      rentAmountMinor: BigInt(1_800_000),
      currency: 'ETB',
      dueDayOfMonth: 5,
      depositType: 'fixed',
      depositAmountMinor: BigInt(3_600_000),
    },
  });

  const shopLease = await prisma.lease.create({
    data: {
      organizationId: organization.id,
      unitId: shopUnit.id,
      tenantId: tenants[2]!.id,
      billingCalendar: 'ethiopian',
      status: 'active',
      startDate: new Date(shiftPeriod(periodForDate(ethiopianToday), -6).key + '-01T00:00:00.000Z'),
      rentAmountMinor: BigInt(4_500_000),
      currency: 'ETB',
      billingFrequency: 'quarterly',
      dueDayOfMonth: 1,
      depositType: 'months_of_rent',
      depositMonths: 3,
      depositAmountMinor: BigInt(13_500_000),
    },
  });

  // --- charges for the last three periods ----------------------------------
  const periodKeys = (() => {
    const current = periodForDate(ethiopianToday);
    return [shiftPeriod(current, -2).key, shiftPeriod(current, -1).key, current.key];
  })();

  const ethiopianResult = await generateCharges(prisma, {
    organizationId: organization.id,
    periodKeys,
    leaseIds: [ethiopianLease.id, shopLease.id],
  });
  const secondResult = await generateCharges(prisma, {
    organizationId: organization.id,
    periodKeys,
    leaseIds: [secondLease.id],
  });

  // --- two payments, one partial -------------------------------------------
  const firstCharge = await prisma.charge.findFirst({
    where: { leaseId: ethiopianLease.id },
    orderBy: { dueDate: 'asc' },
  });
  const shopCharge = await prisma.charge.findFirst({
    where: { leaseId: shopLease.id },
    orderBy: { dueDate: 'asc' },
  });

  if (firstCharge) {
    await recordPayment(prisma, {
      organizationId: organization.id,
      amount: { amountMinor: Number(firstCharge.amountMinor), currency: 'ETB' },
      method: 'bank_transfer',
      paidAt: new Date(),
      reference: 'DEMO-CBE-0001',
      notes: 'Demo: paid by CBE transfer',
      allocations: [
        {
          chargeId: firstCharge.id,
          amount: { amountMinor: Number(firstCharge.amountMinor), currency: 'ETB' },
        },
      ],
    });
  }

  if (shopCharge) {
    // recordPayment requires a lease, a tenant or an explicit allocation to know
    // whose debt this settles (see services/payments.ts) — name the charge.
    const partialMinor = Math.round(Number(shopCharge.amountMinor) / 2);
    await recordPayment(prisma, {
      organizationId: organization.id,
      amount: { amountMinor: partialMinor, currency: 'ETB' },
      method: 'cash',
      paidAt: new Date(),
      reference: 'DEMO-CASH-0001',
      notes: 'Demo: partial cash payment',
      allocations: [
        { chargeId: shopCharge.id, amount: { amountMinor: partialMinor, currency: 'ETB' } },
      ],
    });
  }

  // --- tenant portal demo ---------------------------------------------------
  // Every demo tenant is enrolled, so any seeded phone (+251911000001 … 014,
  // or the local 0911… form) works at /portal/login: request a code, read it
  // from the [worker] log (mock SMS in dev), sign in. Local form (09…) and
  // international form (+2519…) resolve to the same tenant.
  const ownerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@demo.test' } });
  for (const tenant of tenants) {
    await enrollTenantPortal(prisma, {
      organizationId: organization.id,
      actorUserId: ownerUser.id,
      tenantId: tenant.id,
    });
  }

  console.warn(
    [
      '',
      'Demo seed complete.',
      `  Organization : ${organization.name} (slug: ${DEMO_SLUG})`,
      `  Sign in with : owner@demo.test / ${DEMO_PASSWORD}  (also manager@, accountant@, maintenance@)`,
      '  Tenant portal: all 14 demo tenants are enrolled — any of these phones',
      `                 works at /portal/login: ${tenants.map((tenant) => tenant.phone).join(', ')}`,
      '                 (no password: the one-time code is printed in the [worker] log)',
      `  Properties   : 2 (${units.length + 1} units)`,
      `  Tenants      : ${tenants.length} (all portal-enrolled)`,
      `  Leases       : 3 (all billed in the org calendar — Ethiopian; 1 quarterly)`,
      `  Charges      : ${ethiopianResult.created + secondResult.created} generated`,
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
