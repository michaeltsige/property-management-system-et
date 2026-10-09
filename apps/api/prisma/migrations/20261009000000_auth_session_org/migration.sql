-- Bind auth sessions to the organization they were issued for, so a refresh
-- token can never silently rebind the user to a different organization.
ALTER TABLE "AuthSession" ADD COLUMN "organizationId" UUID;

CREATE INDEX "AuthSession_organizationId_idx" ON "AuthSession"("organizationId");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
