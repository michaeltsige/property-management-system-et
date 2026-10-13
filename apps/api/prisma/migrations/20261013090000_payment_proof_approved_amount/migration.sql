-- The amount staff actually received when approving a proof of payment.
-- May be less than the tenant-claimed amountMinor (partial payment).
ALTER TABLE "PaymentProof" ADD COLUMN "approvedAmountMinor" BIGINT;
