CREATE TABLE "ImportBatch" (
  "id" UUID NOT NULL PRIMARY KEY,
  "organizationId" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ImportBatch_organizationId_fingerprint_key" ON "ImportBatch"("organizationId", "fingerprint");
