import type { Prisma } from "./generated/prisma/client.js";

type Role = "SuperAdmin" | "Member" | "Developer";
type Status = "pending" | "completed" | "failed";
export interface AuditDetails {
  TRANSACTION_CREATED: { targetId: string; amount: string; currency: "USD"; status: "pending" };
  TRANSACTION_STATUS_CHANGED: { targetId: string; previousStatus: Status; status: Status };
  MEMBER_ROLE_CHANGED: { targetId: string; previousRole: Role; role: Role };
  MEMBER_DEACTIVATED: { targetId: string; previousActive: boolean; active: boolean };
  MEMBER_INVITED: { targetId: string; role: Role; expiresAt: string };
  INVITATION_RESENT: { targetId: string; role: Role; expiresAt: string };
  INVITATION_REVOKED: { targetId: string };
  INVITATION_ACCEPTED: { targetId: string; memberId: string; role: Role };
  INVITATION_DELIVERY: { targetId: string; outcome: string };
  TENANT_PROFILE_UPDATED: { previousName: string; name: string };
  DEVELOPER_API_KEY_GENERATED: { targetId: string; name: string };
  DEVELOPER_API_KEY_REVOKED: { targetId: string; name: string };
  BILLING_OPERATION: { kind: string; outcome: string };
  BILLING_SUBSCRIPTION_CHANGED: { customerId: string; subscriptionId: string; previousStatus: string; status: string; cancelAtPeriodEnd: boolean;
    previousSubscriptionId?: string | null; previousCancelAtPeriodEnd?: boolean; previousCancelAt?: string | null; cancelAt?: string | null };
}
export type AuditActor =
  | { kind: "user"; id: string; tenantId: string }
  | { kind: "stripe"; eventId: string }
  | { kind: "reconciliation" | "email_delivery" };
export type RequiredAuditInput = {
  tenantId: string;
  actor: AuditActor;
  operation?: { id: string; phase: string };
} & { [A in keyof AuditDetails]: { action: A; details: AuditDetails[A] } }[keyof AuditDetails];

type Validator = (value: unknown) => boolean;
const uuid: Validator = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const code: Validator = (v) => typeof v === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(v);
const name: Validator = (v) => typeof v === "string" && v.length > 0 && v.length <= 256;
const bool: Validator = (v) => typeof v === "boolean";
const role: Validator = (v) => ["SuperAdmin", "Member", "Developer"].includes(v as string);
const status: Validator = (v) => ["pending", "completed", "failed"].includes(v as string);
const date: Validator = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const specs: { [A in keyof AuditDetails]: Record<keyof AuditDetails[A], Validator> } = {
  TRANSACTION_CREATED: { targetId: uuid, amount: (v) => typeof v === "string" && /^\d{1,8}\.\d{2}$/.test(v), currency: (v) => v === "USD", status: (v) => v === "pending" },
  TRANSACTION_STATUS_CHANGED: { targetId: uuid, previousStatus: status, status },
  MEMBER_ROLE_CHANGED: { targetId: uuid, previousRole: role, role },
  MEMBER_DEACTIVATED: { targetId: uuid, previousActive: bool, active: bool },
  MEMBER_INVITED: { targetId: uuid, role, expiresAt: date },
  INVITATION_RESENT: { targetId: uuid, role, expiresAt: date },
  INVITATION_REVOKED: { targetId: uuid },
  INVITATION_ACCEPTED: { targetId: uuid, memberId: uuid, role },
  INVITATION_DELIVERY: { targetId: uuid, outcome: code },
  TENANT_PROFILE_UPDATED: { previousName: name, name },
  DEVELOPER_API_KEY_GENERATED: { targetId: uuid, name },
  DEVELOPER_API_KEY_REVOKED: { targetId: uuid, name },
  BILLING_OPERATION: { kind: (v) => ["customer_create", "checkout_create", "portal_create"].includes(v as string), outcome: code },
  BILLING_SUBSCRIPTION_CHANGED: { customerId: (v) => typeof v === "string" && /^cus_[A-Za-z0-9]+$/.test(v), subscriptionId: (v) => typeof v === "string" && /^sub_[A-Za-z0-9]+$/.test(v), previousStatus: code, status: code, cancelAtPeriodEnd: bool,
    previousSubscriptionId: (v) => v == null || (typeof v === "string" && /^sub_[A-Za-z0-9]+$/.test(v)),
    previousCancelAtPeriodEnd: (v) => v === undefined || bool(v), previousCancelAt: (v) => v == null || date(v), cancelAt: (v) => v == null || date(v) },
};

export class AuditPersistenceError extends Error {
  constructor() { super("Required audit could not be recorded."); this.name = "AuditPersistenceError"; }
}
function exactKeys(value: object, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function canonical(value: object) { return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))); }

// Call within the SAME transaction as the local mutation. Caller authorizes the
// action and captures its actor before changing sessionVersion or active state.
// Never catch this error inside that transaction and commit the business write.
export async function writeRequiredAudit(tx: Prisma.TransactionClient, input: RequiredAuditInput): Promise<{ id: string }> {
  try {
    if (!input || !uuid(input.tenantId) || !exactKeys(input, ["tenantId", "actor", "operation", "action", "details"]) ||
      !Object.hasOwn(specs, input.action)) throw new AuditPersistenceError();
    const spec: Record<string, Validator> = specs[input.action];
    const details = input.details as unknown as Record<string, unknown>;
    if (!details || Array.isArray(details) || !exactKeys(details, Object.keys(spec)) ||
      !Object.entries(spec).every(([key, validate]) => validate(details[key]))) throw new AuditPersistenceError();
    const actor = input.actor;
    let actorId: string | null = null, actorEmail: string | null = null, sourceEventId: string | null = null;
    if (actor.kind === "user") {
      if (!exactKeys(actor, ["kind", "id", "tenantId"]) || !uuid(actor.id) || actor.tenantId !== input.tenantId) throw new AuditPersistenceError();
      // Intentionally allows the just-deactivated/self-demoted actor. Permission
      // was checked by the service before mutation; this checks tenant attribution.
      const user = await tx.user.findFirst({ where: { id: actor.id, tenantId: input.tenantId }, select: { email: true } });
      if (!user) throw new AuditPersistenceError();
      actorId = actor.id; actorEmail = user.email;
    } else if (actor.kind === "stripe") {
      if (!exactKeys(actor, ["kind", "eventId"]) || !/^evt_[A-Za-z0-9]+$/.test(actor.eventId)) throw new AuditPersistenceError();
      sourceEventId = actor.eventId;
    } else if (!["reconciliation", "email_delivery"].includes(actor.kind) || !exactKeys(actor, ["kind"])) throw new AuditPersistenceError();
    const systemActions = actor.kind === "email_delivery" ? ["INVITATION_DELIVERY"] : ["BILLING_OPERATION", "BILLING_SUBSCRIPTION_CHANGED"];
    if (actor.kind !== "user" && !systemActions.includes(input.action)) throw new AuditPersistenceError();
    if (input.operation) {
      if (!exactKeys(input.operation, ["id", "phase"]) || !uuid(input.operation.id) || !code(input.operation.phase)) throw new AuditPersistenceError();
      const operation = await tx.externalOperation.findFirst({ where: { id: input.operation.id, tenantId: input.tenantId }, select: { id: true } });
      if (!operation) throw new AuditPersistenceError();
    }
    const data = { tenantId: input.tenantId, action: input.action, actorSource: actor.kind, actorId, actorEmail, sourceEventId,
      operationId: input.operation?.id ?? null, phase: input.operation?.phase ?? null,
      metadata: details as Prisma.InputJsonObject };
    if (!input.operation) return await tx.auditLog.create({ data, select: { id: true } });
    // ON CONFLICT avoids poisoning PostgreSQL's transaction on concurrent retries.
    await tx.auditLog.createMany({ data: [data], skipDuplicates: true });
    const existing = await tx.auditLog.findUniqueOrThrow({ where: { tenantId_operationId_phase: {
      tenantId: input.tenantId, operationId: input.operation.id, phase: input.operation.phase,
    } } });
    if (existing.action !== data.action || existing.actorSource !== data.actorSource || existing.actorId !== actorId ||
      existing.sourceEventId !== sourceEventId || canonical(existing.metadata as object) !== canonical(details)) throw new AuditPersistenceError();
    return { id: existing.id };
  } catch { throw new AuditPersistenceError(); }
}
