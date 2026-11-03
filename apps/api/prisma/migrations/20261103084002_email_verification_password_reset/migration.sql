/* Email verification and password-reset codes on User.
   Codes are stored hashed; the raw 6-digit code only ever lives in the email. */

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "emailVerificationCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordResetCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpiresAt" TIMESTAMP(3);

-- Backfill: every account that existed before this change is trusted as
-- verified, so nobody is locked out of a running deployment. Only signups made
-- after this migration walk the verification flow.
UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE "emailVerifiedAt" IS NULL;
