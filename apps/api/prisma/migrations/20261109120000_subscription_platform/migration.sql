-- Platform billing: one Subscription row per customer organization.
--
-- Existing organizations are backfilled as plan 'scale' / status 'active'
-- (unlimited units): they were onboarded before billing existed and must not
-- wake up capped. New signups created through POST /auth/register get a
-- 'trial' subscription row from the service code instead.

CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "unitLimit" INTEGER,
    "priceMonthlyMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Subscription_plan_idx" ON "Subscription"("plan");

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every organization that predates billing is an active, unlimited
-- customer. gen_random_uuid() is built into PostgreSQL 13+.
INSERT INTO "Subscription" ("id", "organizationId", "plan", "status", "unitLimit", "currency", "periodStart", "updatedAt")
SELECT gen_random_uuid(), "Organization"."id", 'scale', 'active', NULL, 'ETB', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization"
WHERE NOT EXISTS (
    SELECT 1 FROM "Subscription" WHERE "Subscription"."organizationId" = "Organization"."id"
);
