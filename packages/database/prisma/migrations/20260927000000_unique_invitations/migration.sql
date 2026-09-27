BEGIN;
-- Keep the newest outstanding invitation. Older links intentionally become invalid.
-- Normalize in the partition before updating to handle legacy whitespace/case.
DELETE FROM invitations WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY "tenantId", lower(btrim(email)) ORDER BY "createdAt" DESC, id DESC
    ) AS position FROM invitations
  ) ranked WHERE position > 1
);
UPDATE invitations SET email = lower(btrim(email));
CREATE UNIQUE INDEX "invitations_tenantId_email_key" ON invitations ("tenantId", email);
COMMIT;
