-- DropIndex
-- IF EXISTS: this migration is re-applied after `prisma migrate resolve` when a
-- previous run failed midway (P3009). On a database where the index is already
-- gone, a bare DROP INDEX would fail again and re-stick the failed record.
DROP INDEX IF EXISTS "Membership_inviteTokenHash_idx";
