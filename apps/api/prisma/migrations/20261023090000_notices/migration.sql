-- Create the Notice table: staff-posted organization announcements
-- (Telegram-style message + optional image), readable by tenants via the portal.

CREATE TABLE "Notice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "propertyId" UUID,
    "audience" TEXT NOT NULL DEFAULT 'tenants',
    "imageDocumentId" UUID,
    "authorUserId" UUID,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notice_organizationId_publishedAt_idx" ON "Notice"("organizationId", "publishedAt");
CREATE INDEX "Notice_organizationId_audience_idx" ON "Notice"("organizationId", "audience");

ALTER TABLE "Notice" ADD CONSTRAINT "Notice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notice" ADD CONSTRAINT "Notice_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
