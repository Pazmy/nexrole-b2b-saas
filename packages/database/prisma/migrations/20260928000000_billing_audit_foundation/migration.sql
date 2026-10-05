BEGIN;

ALTER TABLE tenants
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "subscriptionCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "subscriptionCancelAt" TIMESTAMP(3),
  ADD COLUMN "billingSyncStatus" TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN "billingLeaseOwner" UUID,
  ADD COLUMN "billingLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "billingVersion" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT tenants_billing_sync_check CHECK ("billingSyncStatus" IN ('unverified','synced','pending','conflict')),
  ADD CONSTRAINT tenants_billing_version_check CHECK ("billingVersion" >= 0),
  ADD CONSTRAINT tenants_billing_lease_check CHECK (("billingLeaseOwner" IS NULL) = ("billingLeaseExpiresAt" IS NULL));
CREATE UNIQUE INDEX "tenants_stripeSubscriptionId_key" ON tenants ("stripeSubscriptionId");

CREATE TABLE external_operations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "actorId" UUID,
  kind TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "parameterFingerprint" TEXT NOT NULL,
  "providerObjectId" TEXT,
  "invitationId" UUID,
  "invitationGeneration" UUID,
  state TEXT NOT NULL DEFAULT 'pending',
  "outcomeCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT operations_kind_check CHECK (kind IN ('customer_create','checkout_create','portal_create','invitation_delivery')),
  CONSTRAINT operations_state_check CHECK (state IN ('pending','unknown','open','succeeded','failed','expired')),
  CONSTRAINT operations_resolution_check CHECK ((state IN ('succeeded','failed','expired')) = ("resolvedAt" IS NOT NULL)),
  CONSTRAINT operations_fingerprint_check CHECK ("parameterFingerprint" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT operations_key_check CHECK (length("idempotencyKey") BETWEEN 1 AND 255),
  CONSTRAINT operations_outcome_check CHECK ("outcomeCode" IS NULL OR "outcomeCode" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT operations_invitation_check CHECK (
    (kind = 'invitation_delivery' AND "invitationId" IS NOT NULL AND "invitationGeneration" IS NOT NULL)
    OR (kind <> 'invitation_delivery' AND "invitationId" IS NULL AND "invitationGeneration" IS NULL)
  )
);
CREATE UNIQUE INDEX "external_operations_idempotencyKey_key" ON external_operations ("idempotencyKey");
CREATE UNIQUE INDEX "external_operations_tenantId_id_key" ON external_operations ("tenantId", id);
CREATE UNIQUE INDEX "external_operations_invitationId_invitationGeneration_key" ON external_operations ("invitationId", "invitationGeneration");
CREATE INDEX "external_operations_tenantId_state_idx" ON external_operations ("tenantId", state);
-- Prisma cannot express this partial uniqueness. Keep it in migration SQL.
-- Unknown outcomes remain unresolved: timeouts never open a duplicate checkout slot.
CREATE UNIQUE INDEX external_operations_unresolved_billing_key ON external_operations ("tenantId", kind)
  WHERE kind IN ('customer_create','checkout_create') AND state IN ('pending','unknown','open');

ALTER TABLE audit_logs
  ADD COLUMN "actorSource" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "sourceEventId" TEXT,
  ADD COLUMN "operationId" UUID,
  ADD COLUMN phase TEXT,
  ADD CONSTRAINT audit_actor_source_check CHECK ("actorSource" IN ('legacy','user','stripe','reconciliation','email_delivery')),
  ADD CONSTRAINT audit_actor_identity_check CHECK (
    "actorSource" = 'legacy' OR ("actorSource" = 'user' AND "actorId" IS NOT NULL)
    OR ("actorSource" IN ('stripe','reconciliation','email_delivery') AND "actorId" IS NULL AND "actorEmail" IS NULL)
  ),
  ADD CONSTRAINT audit_operation_phase_check CHECK (("operationId" IS NULL) = (phase IS NULL)),
  ADD CONSTRAINT "audit_logs_tenantId_operationId_fkey" FOREIGN KEY ("tenantId", "operationId")
    REFERENCES external_operations ("tenantId", id) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "audit_logs_tenantId_operationId_phase_key" ON audit_logs ("tenantId", "operationId", phase);

ALTER TABLE processed_stripe_events
  ADD COLUMN "eventType" TEXT,
  ADD COLUMN livemode BOOLEAN,
  ADD COLUMN "resourceId" TEXT,
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "subscriptionId" TEXT,
  ADD COLUMN "tenantId" UUID,
  ADD COLUMN disposition TEXT NOT NULL DEFAULT 'processed',
  ADD COLUMN "reasonCode" TEXT,
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT stripe_event_disposition_check CHECK (disposition IN ('pending','processed','ignored','quarantined')),
  ADD CONSTRAINT stripe_event_reason_check CHECK ("reasonCode" IS NULL OR "reasonCode" ~ '^[a-z][a-z0-9_]{0,63}$');
-- Historical receipts were completed. Preserve their meaning without inventing payload/tenant data.
UPDATE processed_stripe_events SET "processedAt" = "createdAt", "updatedAt" = "createdAt";
CREATE INDEX "processed_stripe_events_tenantId_disposition_idx" ON processed_stripe_events ("tenantId", disposition);
COMMIT;
