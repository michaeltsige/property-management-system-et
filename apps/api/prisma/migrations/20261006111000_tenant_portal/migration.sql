ALTER TABLE "Tenant" ADD COLUMN "userId" UUID;
ALTER TABLE "Tenant" ADD COLUMN "portalEnabledAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Tenant_userId_key" ON "Tenant"("userId");
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TenantOtp" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantOtp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TenantOtp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TenantOtp_tenantId_consumedAt_idx" ON "TenantOtp"("tenantId", "consumedAt");
