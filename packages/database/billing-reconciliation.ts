import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma, Tenant, ExternalOperation } from "./generated/prisma/client.js";
import { writeRequiredAudit, type AuditActor } from "./audit.js";
import { BillingError, type BillingActor } from "./billing-service.js";
import { getInvoiceSubscriptionId, BILLING_SUBSCRIPTION_STATUSES } from "./billing-rules.js";

export type BillingResource = "customer" | "subscription" | "checkout" | "invoice";
export interface ReconciliationProvider {
  get(kind: BillingResource, id: string): Promise<unknown>;
  list(kind: "subscription" | "checkout", customerId: string): Promise<unknown[]>;
}
export type BillingEvent = { id: string; type: string; livemode: boolean; account?: string; data: { object: unknown } };
export type ReconciliationResult = { disposition: string; reason: string };
export class ReconciliationError extends Error {
  constructor(public readonly code: "retry" | "conflict", public readonly reason: string) {
    super(code === "retry" ? "Billing synchronization is pending. Retry shortly." : "Billing ownership requires review.");
    this.name = "ReconciliationError";
  }
}
const retry = (reason: string): never => { throw new ReconciliationError("retry", reason); };
const conflict = (reason: string): never => { throw new ReconciliationError("conflict", reason); };
const supported = new Set(["checkout.session.completed", "checkout.session.expired", "customer.subscription.created",
  "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed",
  "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"]);
const unresolved = ["pending", "unknown", "open"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const terminal = (status: string) => ["canceled", "incomplete_expired"].includes(status);
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return conflict("invalid_resource");
  return value as ObjectValue;
}
function reference(value: unknown): string | null {
  return typeof value === "string" ? value : value && typeof value === "object" && typeof (value as ObjectValue).id === "string" ? (value as { id: string }).id : null;
}
const metadata = (value: ObjectValue) => value.metadata && typeof value.metadata === "object" ? value.metadata as ObjectValue : {};
function id(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value)) return conflict("invalid_reference");
  return value;
}
function timestamp(value: unknown): Date | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 253402300799) return conflict("invalid_schedule");
  return new Date(value * 1000);
}
function priceMatches(items: unknown, priceId: string): boolean {
  const list = object(items);
  if (list.has_more !== false || !Array.isArray(list.data) || list.data.length !== 1) return false;
  const line = object(list.data[0]), price = object(line.price);
  return price.id === priceId && line.quantity === 1 && price.type === "recurring";
}
type Context = { tenant: Tenant; owner: string; version: bigint; actor?: BillingActor; event?: BillingEvent };

export class BillingReconciler {
  constructor(private db: PrismaClient, private provider: ReconciliationProvider, private config: { priceId: string; livemode: boolean }) {}

  private budget(): ReconciliationProvider {
    let remaining = 30;
    const deadline = Date.now() + 45000;
    const check = () => { if (--remaining < 0 || Date.now() >= deadline) return retry("work_limit"); };
    return {
      get: async (kind, resourceId) => { check(); return this.provider.get(kind, resourceId); },
      list: async (kind, customerId) => { check(); return this.provider.list(kind, customerId); },
    };
  }

  private async locked<T>(tenantId: string, actor: BillingActor | undefined, fn: (tx: Prisma.TransactionClient, tenant: Tenant, now: Date) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      const [tenant] = await tx.$queryRaw<Tenant[]>`SELECT * FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      if (!tenant) throw new BillingError("access_denied");
      if (actor) {
        const [user] = await tx.$queryRaw<{ isActive: boolean; emailVerifiedAt: Date | null; sessionVersion: number; role: string }[]>`
          SELECT u."isActive", u."emailVerifiedAt", u."sessionVersion", r.name AS role FROM users u JOIN roles r ON r.id = u."roleId"
          WHERE u.id = ${actor.id}::uuid AND u."tenantId" = ${tenantId}::uuid FOR UPDATE OF u FOR SHARE OF r`;
        if (!user?.isActive || !user.emailVerifiedAt || user.role !== "SuperAdmin" || user.sessionVersion !== actor.sessionVersion || actor.tenantId !== tenantId) throw new BillingError("access_denied");
      }
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      return fn(tx, tenant, clock.now);
    }, { maxWait: 5000, timeout: 10000 });
  }

  private async receipt(event: BillingEvent, disposition: "processed" | "ignored" | "quarantined", reason: string, tx: Prisma.TransactionClient | PrismaClient = this.db, tenantId?: string) {
    await tx.processedStripeEvent.updateMany({ where: { id: event.id, disposition: "pending" },
      data: { disposition, reasonCode: reason, processedAt: new Date(), ...(tenantId ? { tenantId } : {}) } });
    return { disposition, reason };
  }

  // Entry is called only after the transport verifies the raw-body Stripe signature.
  async handle(event: BillingEvent): Promise<ReconciliationResult> {
    id(event.id, "evt");
    const resourceId = reference(event.data.object);
    await this.db.processedStripeEvent.createMany({ data: [{ id: event.id, eventType: event.type, livemode: event.livemode,
      resourceId, disposition: "pending" }], skipDuplicates: true });
    const existing = await this.db.processedStripeEvent.findUniqueOrThrow({ where: { id: event.id } });
    if (existing.disposition !== "pending") return { disposition: existing.disposition, reason: "duplicate" };
    if (event.account) return this.receipt(event, "quarantined", "connected_account");
    if (event.livemode !== this.config.livemode) return this.receipt(event, "quarantined", "mode_mismatch");
    if (!supported.has(event.type)) return this.receipt(event, "ignored", "unsupported_event");
    const provider = this.budget();
    try {
      const kind = event.type.startsWith("checkout.") ? "checkout" : event.type.startsWith("invoice.") ? "invoice" : "subscription";
      id(resourceId, kind === "checkout" ? "cs" : kind === "invoice" ? "in" : "sub");
      // Retrieve even matching-version events; signed snapshots are routing hints, never entitlement state.
      const resource = object(await provider.get(kind, resourceId!));
      if (resource.id !== resourceId || resource.livemode !== this.config.livemode) return conflict("resource_mismatch");
      const customerId = id(reference(resource.customer), "cus");
      const subscriptionId = kind === "invoice" ? getInvoiceSubscriptionId(resource) : kind === "subscription" ? resourceId : reference(resource.subscription);
      if (kind === "invoice" && !subscriptionId) {
        // A malformed subscription invoice must not be silently acknowledged as unrelated.
        if (resource.parent && object(resource.parent).type === "subscription_details") return conflict("invalid_invoice_subscription");
        return this.receipt(event, "ignored", "unrelated_invoice");
      }
      if (subscriptionId) id(subscriptionId, "sub");
      const tenant = await this.db.tenant.findUnique({ where: { stripeCustomerId: customerId } });
      if (!tenant) {
        const operationId = metadata(resource).operationId;
        if (typeof operationId === "string" && uuid.test(operationId) &&
          await this.db.externalOperation.findUnique({ where: { id: operationId } })) return retry("binding_pending");
        return this.receipt(event, "ignored", "unrelated_customer");
      }
      await this.db.processedStripeEvent.updateMany({ where: { id: event.id, disposition: "pending" }, data: { customerId, subscriptionId, tenantId: tenant.id } });
      return await this.run(tenant.id, { event, subscriptionId, checkoutId: kind === "checkout" ? resourceId : null, provider });
    } catch (error) {
      if (error instanceof ReconciliationError && error.code === "conflict") return this.receipt(event, "quarantined", error.reason);
      throw error;
    }
  }

  // Actor comes from a fresh authenticated session. No tenant/resource IDs are accepted from forms.
  async reconcile(actor: BillingActor): Promise<ReconciliationResult> {
    if (!uuid.test(actor.id) || !uuid.test(actor.tenantId)) throw new BillingError("access_denied");
    return this.run(actor.tenantId, { actor, subscriptionId: null, checkoutId: null, provider: this.budget() });
  }

  private async run(tenantId: string, input: { actor?: BillingActor; event?: BillingEvent; subscriptionId: string | null; checkoutId: string | null; provider: ReconciliationProvider }): Promise<ReconciliationResult> {
    if (!/^price_[A-Za-z0-9]+$/.test(this.config.priceId)) throw new BillingError("configuration");
    let ctx: Context | undefined;
    try {
      ctx = await this.locked(tenantId, input.actor, async (tx, tenant, now) => {
        if (tenant.billingLeaseExpiresAt && tenant.billingLeaseExpiresAt > now) return retry("lease_busy");
        const owner = randomUUID(), version = tenant.billingVersion + 1n;
        await tx.tenant.update({ where: { id: tenantId }, data: { billingLeaseOwner: owner, billingLeaseExpiresAt: new Date(now.getTime() + 120000), billingVersion: version } });
        return { tenant, owner, version, actor: input.actor, event: input.event };
      });
      const context = ctx, tenant = ctx.tenant, provider = input.provider;
      if (!tenant.stripeCustomerId) {
        if (tenant.stripeSubscriptionId || tenant.subscriptionStatus !== "free") return conflict("customer_unmapped");
        return { disposition: "ignored", reason: "no_customer" };
      }
      const customer = object(await provider.get("customer", tenant.stripeCustomerId));
      this.owned(customer, tenant, false);
      if (customer.deleted) return conflict("customer_deleted");
      const rawSubscriptions = await provider.list("subscription", tenant.stripeCustomerId);
      const subscriptions = rawSubscriptions.map(object);
      for (const sub of subscriptions) { this.owned(sub, tenant); id(sub.id, "sub"); }
      const ops = await this.db.externalOperation.findMany({ where: { tenantId, kind: "checkout_create" }, take: 501 });
      if (ops.length > 500) return retry("scan_limit");
      const sessions = (await provider.list("checkout", tenant.stripeCustomerId)).map(object);
      const resolutions: { op: ExternalOperation; session: ObjectValue; state: "open" | "expired" | "succeeded" }[] = [];
      const candidates: { subscriptionId: string; op: ExternalOperation }[] = [];
      for (const op of ops.filter((o) => unresolved.includes(o.state))) {
        const matches = sessions.filter((s) => s.id === op.providerObjectId || metadata(s).operationId === op.id);
        if (matches.length > 1) return conflict("duplicate_checkout");
        const sessionId = op.providerObjectId ?? reference(matches[0]);
        if (!sessionId) continue; // An ambiguous provider timeout remains pending; absence is not proof of failure.
        const session = object(await provider.get("checkout", id(sessionId, "cs")));
        this.owned(session, tenant);
        if (session.id !== sessionId || (op.providerObjectId && session.id !== op.providerObjectId) || session.mode !== "subscription" ||
          metadata(session).tenantId !== tenantId || metadata(session).operationId !== op.id || !priceMatches(session.line_items, this.config.priceId)) return conflict("checkout_mismatch");
        if (session.status === "complete") {
          const subscriptionId = id(reference(session.subscription), "sub");
          candidates.push({ subscriptionId, op }); resolutions.push({ op, session, state: "succeeded" });
        } else if (session.status === "expired") resolutions.push({ op, session, state: "expired" });
        else if (session.status === "open") resolutions.push({ op, session, state: "open" });
        else return retry("checkout_pending");
      }
      if (candidates.length > 1) return conflict("multiple_candidates");
      const candidate = candidates[0];
      if (input.subscriptionId && tenant.stripeSubscriptionId && input.subscriptionId !== tenant.stripeSubscriptionId && input.subscriptionId !== candidate?.subscriptionId) {
        return await this.commit(context, async (tx) => input.event ? this.receipt(input.event, "ignored", "superseded_subscription", tx, tenantId) : { disposition: "ignored", reason: "superseded_subscription" });
      }
      let canonical: ObjectValue | null = null;
      if (tenant.stripeSubscriptionId) {
        canonical = object(await provider.get("subscription", tenant.stripeSubscriptionId));
        this.owned(canonical, tenant);
        if (canonical.id !== tenant.stripeSubscriptionId) return conflict("subscription_mismatch");
      }
      if (candidate && candidate.subscriptionId !== tenant.stripeSubscriptionId) {
        if (canonical && !terminal(String(canonical.status))) return conflict("existing_subscription");
        canonical = object(await provider.get("subscription", candidate.subscriptionId));
        this.owned(canonical, tenant);
        if (canonical.id !== candidate.subscriptionId) return conflict("subscription_mismatch");
      }
      if (subscriptions.some((sub) => !terminal(String(sub.status)) && sub.id !== canonical?.id)) return conflict("unmapped_subscription");
      if (!canonical && (input.subscriptionId || tenant.subscriptionStatus !== "free")) return conflict("subscription_unmapped");
      if (canonical && (!BILLING_SUBSCRIPTION_STATUSES.includes(canonical.status as typeof BILLING_SUBSCRIPTION_STATUSES[number]) || canonical.status === "free" ||
        typeof canonical.cancel_at_period_end !== "boolean" || !priceMatches(canonical.items, this.config.priceId))) return conflict("subscription_shape");
      if (input.checkoutId && !ops.some((op) => op.providerObjectId === input.checkoutId) && !resolutions.some((r) => r.session.id === input.checkoutId)) return conflict("untracked_checkout");
      const status = canonical ? String(canonical.status) : "free";
      const subscriptionId = canonical ? String(canonical.id) : null;
      const cancelAt = canonical ? timestamp(canonical.cancel_at) : null;
      const cancelAtPeriodEnd = canonical ? canonical.cancel_at_period_end as boolean : false;
      return await this.commit(context, async (tx, current) => {
        const source: AuditActor = input.event ? { kind: "stripe", eventId: input.event.id } : { kind: "user", id: input.actor!.id, tenantId };
        for (const resolution of resolutions) {
          const { op, session, state } = resolution;
          const changed = await tx.externalOperation.updateMany({ where: { id: op.id, tenantId, state: { in: unresolved }, providerObjectId: op.providerObjectId },
            data: { state, providerObjectId: String(session.id), outcomeCode: state, resolvedAt: state === "open" ? null : new Date() } });
          if (changed.count !== 1) return retry("operation_changed");
          const prior = await tx.auditLog.findUnique({ where: { tenantId_operationId_phase: { tenantId, operationId: op.id, phase: state } } });
          if (!prior) await writeRequiredAudit(tx, { tenantId, actor: source, action: "BILLING_OPERATION",
            operation: { id: op.id, phase: state }, details: { kind: "checkout_create", outcome: state } });
        }
        const changed = current.stripeSubscriptionId !== subscriptionId || current.subscriptionStatus !== status ||
          current.subscriptionCancelAtPeriodEnd !== cancelAtPeriodEnd || current.subscriptionCancelAt?.getTime() !== cancelAt?.getTime();
        await tx.tenant.update({ where: { id: tenantId }, data: { stripeSubscriptionId: subscriptionId, subscriptionStatus: status,
          subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd, subscriptionCancelAt: cancelAt, billingSyncStatus: "synced" } });
        if (changed && subscriptionId) await writeRequiredAudit(tx, { tenantId, actor: source, action: "BILLING_SUBSCRIPTION_CHANGED",
          details: { customerId: tenant.stripeCustomerId!, subscriptionId,
            previousStatus: /^[a-z][a-z0-9_]{0,63}$/.test(current.subscriptionStatus) ? current.subscriptionStatus : "unknown", status, cancelAtPeriodEnd,
            previousSubscriptionId: current.stripeSubscriptionId, previousCancelAtPeriodEnd: current.subscriptionCancelAtPeriodEnd,
            previousCancelAt: current.subscriptionCancelAt?.toISOString() ?? null, cancelAt: cancelAt?.toISOString() ?? null } });
        return input.event ? this.receipt(input.event, "processed", changed ? "state_updated" : "state_unchanged", tx, tenantId) : { disposition: "processed", reason: changed ? "state_updated" : "state_unchanged" };
      });
    } catch (error) {
      // A stale fetch cannot permanently quarantine an event either: retry it
      // against the new binding/lease before making an irreversible disposition.
      if (ctx && error instanceof ReconciliationError && error.code === "conflict") await this.commit(ctx, async () => ({ disposition: "pending", reason: "review" }));
      throw error;
    } finally {
      if (ctx) try { await this.db.tenant.updateMany({ where: { id: tenantId, billingLeaseOwner: ctx.owner, billingVersion: ctx.version },
        data: { billingLeaseOwner: null, billingLeaseExpiresAt: null } }); } catch { /* Expiry permits recovery. */ }
    }
  }

  private owned(resource: ObjectValue, tenant: Tenant, hasCustomer = true) {
    if (resource.livemode !== this.config.livemode || (hasCustomer ? reference(resource.customer) !== tenant.stripeCustomerId : resource.id !== tenant.stripeCustomerId) ||
      (metadata(resource).tenantId && metadata(resource).tenantId !== tenant.id)) return conflict("ownership_conflict");
  }

  private async commit<T>(ctx: Context, fn: (tx: Prisma.TransactionClient, tenant: Tenant) => Promise<T>): Promise<T | ReconciliationResult> {
    return this.locked(ctx.tenant.id, ctx.actor, async (tx, current, now) => {
      if (current.billingLeaseOwner !== ctx.owner || current.billingVersion !== ctx.version || !current.billingLeaseExpiresAt || current.billingLeaseExpiresAt <= now ||
        current.stripeCustomerId !== ctx.tenant.stripeCustomerId || current.stripeSubscriptionId !== ctx.tenant.stripeSubscriptionId) return retry("lease_changed");
      if (ctx.event) {
        const receipt = await tx.processedStripeEvent.findUniqueOrThrow({ where: { id: ctx.event.id } });
        if (receipt.disposition !== "pending") return { disposition: receipt.disposition, reason: "duplicate" };
      }
      return fn(tx, current);
    });
  }
}
