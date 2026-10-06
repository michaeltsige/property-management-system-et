-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "portfolioMode" TEXT NOT NULL DEFAULT 'self_owned';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "ownerId" UUID;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "buildingId" UUID;

-- CreateTable
CREATE TABLE "Owner" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "managementFeeBps" INTEGER,
    "defaultKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- Backfill before making the link mandatory. Names describe the existing org;
-- an administrator must review real landlord ownership after deployment.
INSERT INTO "Owner" ("id", "organizationId", "name", "defaultKey", "updatedAt")
SELECT gen_random_uuid(), "id", "name", 'self', CURRENT_TIMESTAMP FROM "Organization";
UPDATE "Property" p SET "ownerId" = o."id" FROM "Owner" o
WHERE p."organizationId" = o."organizationId" AND o."defaultKey" = 'self';
ALTER TABLE "Property" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_fee_range" CHECK ("managementFeeBps" BETWEEN 0 AND 10000);
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_default_key" CHECK ("defaultKey" IS NULL OR "defaultKey" = 'self');
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_portfolio_mode" CHECK ("portfolioMode" IN ('self_owned', 'managed'));

-- CreateIndex
CREATE UNIQUE INDEX "Owner_organizationId_id_key" ON "Owner"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_organizationId_defaultKey_key" ON "Owner"("organizationId", "defaultKey");

-- CreateIndex
CREATE UNIQUE INDEX "Building_organizationId_propertyId_id_key" ON "Building"("organizationId", "propertyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Building_propertyId_name_key" ON "Building"("propertyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Property_organizationId_id_key" ON "Property"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "Owner" ADD CONSTRAINT "Owner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_organizationId_propertyId_fkey" FOREIGN KEY ("organizationId", "propertyId") REFERENCES "Property"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_organizationId_ownerId_fkey" FOREIGN KEY ("organizationId", "ownerId") REFERENCES "Owner"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_organizationId_propertyId_buildingId_fkey" FOREIGN KEY ("organizationId", "propertyId", "buildingId") REFERENCES "Building"("organizationId", "propertyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

