BEGIN;

-- Abort rather than silently merge accounts whose normalized addresses collide.
DO $$ BEGIN
  IF EXISTS (SELECT lower(btrim(email)) FROM users GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized user emails. Resolve these accounts before retrying this migration.';
  END IF;
END $$;
UPDATE users SET email = lower(btrim(email));
UPDATE invitations SET email = lower(btrim(email));
ALTER TABLE users ADD CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email)));
ALTER TABLE invitations ADD CONSTRAINT invitations_email_normalized CHECK (email = lower(btrim(email)));
ALTER TABLE users ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
-- Existing accounts must verify via /verify-email; existing JWTs must sign in again.
-- Preserve outstanding invitation URLs while removing plaintext tokens from storage.
UPDATE invitations SET token = encode(sha256(convert_to(token, 'UTF8')), 'hex');

CREATE TABLE account_tokens (
  "tokenHash" TEXT PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  "sessionVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "account_tokens_userId_purpose_idx" ON account_tokens("userId", purpose);
CREATE INDEX "account_tokens_expiresAt_idx" ON account_tokens("expiresAt");
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "auth_rate_limits_expiresAt_idx" ON auth_rate_limits("expiresAt");
COMMIT;
