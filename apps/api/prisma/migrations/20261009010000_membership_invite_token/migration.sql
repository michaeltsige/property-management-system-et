-- Invitations become redeemable: the membership carries a hashed invite token
-- and its expiry, so an invited user can set a password and activate the
-- membership without staff intervention.
ALTER TABLE "Membership" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "Membership" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);

CREATE INDEX "Membership_inviteTokenHash_idx" ON "Membership"("inviteTokenHash");
