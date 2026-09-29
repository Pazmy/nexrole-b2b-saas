import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma, Tenant, ExternalOperation } from "./generated/prisma/client.js";
import { writeRequiredAudit } from "./audit.js";

export type BillingActor = { id: string; tenantId: string; sessionVersion: number };
export type BillingCustomer = { id: string; livemode: boolean; deleted?: boolean; tenantId?: string; operationId?: string };
export type BillingCheckout = { id: string; customerId: string | null; livemode: boolean; mode: string | null;
  status: string | null; expiresAt: number; priceIds: string[]; quantity: number | null; url: string | null; operationId?: string; tenantId?: string };
export type BillingSubscription = { id: string; customerId: string; livemode: boolean; status: string };
export type BillingConfig = { priceId: string; baseUrl: string; livemode: boolean; accountScope: string };
// A narrow provider boundary permits deterministic failures with real database locks.
export interface BillingProvider {
  customer(id: string): Promise<BillingCustomer>;
  findCustomers(tenantId: string, operationId: string): Promise<BillingCustomer[]>;
  createCustomer(tenantId: string, operationId: string, key: string): Promise<BillingCustomer>;
  subscriptions(customerId: string): Promise<BillingSubscription[]>;
  checkouts(customerId: string): Promise<BillingCheckout[]>;
  checkout(id: string): Promise<BillingCheckout>;
  createCheckout(customerId: string, tenantId: string, operationId: string, key: string, config: BillingConfig): Promise<BillingCheckout>;
  createPortal(customerId: string, key: string, baseUrl: string): Promise<{ id: string; url: string }>;
}
const messages = {
  access_denied: "Sign in with an active workspace administrator account.",
  busy: "Another billing request is running. Try again shortly.",
  reconcile: "Billing needs reconciliation before another checkout can be created. Use billing recovery or contact support.",
  unavailable: "The billing outcome could not be confirmed. Retry to recover the existing request.",
  configuration: "Billing configuration is unavailable.",
};
export class BillingError extends Error {
  constructor(public readonly code: keyof typeof messages) { super(messages[code]); this.name = "BillingError"; }
}
type Context = { actor: BillingActor; owner: string; version: bigint; customer: string | null; subscription: string | null };
type Kind = "customer_create" | "checkout_create" | "portal_create";
const unresolved = ["pending", "unknown", "open"];
const terminal = (status: string) => status === "canceled" || status === "incomplete_expired";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BillingService {
  constructor(private db: PrismaClient, private provider: BillingProvider, private config: BillingConfig) {}

  private async locked<T>(actor: BillingActor, fn: (tx: Prisma.TransactionClient, tenant: Tenant, now: Date) => Promise<T>) {
    if (!uuid.test(actor.id) || !uuid.test(actor.tenantId)) throw new BillingError("access_denied");
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Tenant[]>`
        SELECT * FROM tenants WHERE id = ${actor.tenantId}::uuid FOR UPDATE`;
      if (!rows[0]) throw new BillingError("access_denied");
      const users = await tx.$queryRaw<{ isActive: boolean; emailVerifiedAt: Date | null; sessionVersion: number; role: string }[]>`
        SELECT u."isActive", u."emailVerifiedAt", u."sessionVersion", r.name AS role FROM users u
        JOIN roles r ON r.id = u."roleId" WHERE u.id = ${actor.id}::uuid AND u."tenantId" = ${actor.tenantId}::uuid
        FOR UPDATE OF u FOR SHARE OF r`;
      const user = users[0];
      if (!user?.isActive || !user.emailVerifiedAt || user.sessionVersion !== actor.sessionVersion || user.role !== "SuperAdmin") throw new BillingError("access_denied");
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      return fn(tx, rows[0], clock.now);
    }, { maxWait: 5000, timeout: 10000 });
  }

  private async fenced<T>(ctx: Context, fn: (tx: Prisma.TransactionClient, tenant: Tenant, now: Date) => Promise<T>) {
    return this.locked(ctx.actor, async (tx, tenant, now) => {
      if (tenant.billingLeaseOwner !== ctx.owner || tenant.billingVersion !== ctx.version || !tenant.billingLeaseExpiresAt ||
        tenant.billingLeaseExpiresAt <= now || tenant.stripeCustomerId !== ctx.customer || tenant.stripeSubscriptionId !== ctx.subscription) throw new BillingError("busy");
      return fn(tx, tenant, now);
    });
  }

  private fingerprint(kind: Kind, ctx: Context) {
    return hash({ kind, tenant: ctx.actor.tenantId, customer: kind === "customer_create" ? null : ctx.customer,
      price: kind === "checkout_create" ? this.config.priceId : null,
      base: kind === "customer_create" ? null : this.config.baseUrl, mode: this.config.livemode, account: this.config.accountScope });
  }

  private async audit(tx: Prisma.TransactionClient, ctx: Context, op: ExternalOperation, phase: string) {
    await writeRequiredAudit(tx, { tenantId: ctx.actor.tenantId, actor: { kind: "user", id: ctx.actor.id, tenantId: ctx.actor.tenantId },
      action: "BILLING_OPERATION", details: { kind: op.kind, outcome: phase }, operation: { id: op.id, phase } });
  }

  private async reserve(ctx: Context, kind: Kind) {
    return this.fenced(ctx, async (tx) => {
      const existing = await tx.externalOperation.findFirst({ where: { tenantId: ctx.actor.tenantId, kind, state: { in: unresolved } } });
      if (existing) {
        if (existing.parameterFingerprint !== this.fingerprint(kind, ctx)) throw new BillingError("reconcile");
        return existing;
      }
      const id = randomUUID();
      const op = await tx.externalOperation.create({ data: { id, tenantId: ctx.actor.tenantId, actorId: ctx.actor.id,
        kind, idempotencyKey: `billing_${id}`, parameterFingerprint: this.fingerprint(kind, ctx) } });
      await this.audit(tx, ctx, op, "requested");
      return op;
    });
  }

  private async finish(ctx: Context, op: ExternalOperation, state: "open" | "succeeded" | "expired", providerId: string) {
    return this.fenced(ctx, async (tx, _tenant, now) => {
      const result = await tx.externalOperation.updateMany({ where: { id: op.id, tenantId: ctx.actor.tenantId,
        state: { in: unresolved }, parameterFingerprint: op.parameterFingerprint },
      data: { providerObjectId: providerId, state, outcomeCode: state, resolvedAt: state === "open" ? null : now } });
      if (result.count !== 1) throw new BillingError("reconcile");
      // A different admin may recover the same intent. Each phase records who finalized it.
      const prior = await tx.auditLog.findUnique({ where: { tenantId_operationId_phase: { tenantId: ctx.actor.tenantId, operationId: op.id, phase: state } } });
      if (!prior) await this.audit(tx, ctx, op, state);
      if (op.kind === "customer_create") await tx.tenant.update({ where: { id: ctx.actor.tenantId }, data: { stripeCustomerId: providerId } });
    });
  }

  private validCustomer(customer: BillingCustomer, ctx: Context, operationId?: string) {
    if (customer.deleted || !/^cus_[A-Za-z0-9]+$/.test(customer.id) || customer.livemode !== this.config.livemode ||
      (customer.tenantId && customer.tenantId !== ctx.actor.tenantId) ||
      (operationId && (customer.tenantId !== ctx.actor.tenantId || customer.operationId !== operationId))) throw new BillingError("reconcile");
  }

  private async customer(ctx: Context, tenant: Tenant) {
    if (ctx.customer) {
      const customer = await this.provider.customer(ctx.customer);
      if (customer.id !== ctx.customer) throw new BillingError("reconcile");
      this.validCustomer(customer, ctx);
      return;
    }
    // Legacy subscribed workspaces need verified mappings, never email adoption.
    if (tenant.subscriptionStatus !== "free" || ctx.subscription) throw new BillingError("reconcile");
    const op = await this.reserve(ctx, "customer_create");
    let customer: BillingCustomer;
    if (Date.now() - op.createdAt.getTime() >= 23 * 60 * 60 * 1000) {
      const matches = await this.provider.findCustomers(ctx.actor.tenantId, op.id);
      if (matches.length !== 1) throw new BillingError("reconcile");
      customer = matches[0];
    } else {
      await this.fenced(ctx, async () => {});
      customer = await this.provider.createCustomer(ctx.actor.tenantId, op.id, op.idempotencyKey);
    }
    this.validCustomer(customer, ctx, op.id);
    await this.finish(ctx, op, "succeeded", customer.id);
    ctx.customer = customer.id;
  }

  private validateCheckout(session: BillingCheckout, ctx: Context, op: ExternalOperation) {
    if (session.customerId !== ctx.customer || session.livemode !== this.config.livemode || session.mode !== "subscription" ||
      session.tenantId !== ctx.actor.tenantId || session.operationId !== op.id || session.priceIds.length !== 1 ||
      session.priceIds[0] !== this.config.priceId || session.quantity !== 1 ||
      (op.providerObjectId && op.providerObjectId !== session.id)) throw new BillingError("reconcile");
  }

  private safeUrl(url: string | null, hostname: string) {
    if (!url) throw new BillingError("unavailable");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== hostname || parsed.username || parsed.password || parsed.port) throw new BillingError("reconcile");
    return url;
  }

  private async portal(ctx: Context) {
    const op = await this.reserve(ctx, "portal_create");
    // Portal sessions cannot be retrieved: do not replay prunable, ambiguous keys.
    if (Date.now() - op.createdAt.getTime() >= 23 * 60 * 60 * 1000) throw new BillingError("reconcile");
    await this.fenced(ctx, async () => {});
    const session = await this.provider.createPortal(ctx.customer!, op.idempotencyKey, this.config.baseUrl);
    const url = this.safeUrl(session.url, "billing.stripe.com");
    await this.finish(ctx, op, "succeeded", session.id);
    return url;
  }

  private async checkout(ctx: Context) {
    const subscriptions = await this.provider.subscriptions(ctx.customer!);
    if (subscriptions.some((sub) => sub.customerId !== ctx.customer || sub.livemode !== this.config.livemode)) throw new BillingError("reconcile");
    const nonterminal = subscriptions.filter((sub) => !terminal(sub.status));
    if (nonterminal.length > 1 || (nonterminal.length === 1 && nonterminal[0].id !== ctx.subscription)) throw new BillingError("reconcile");
    if (nonterminal.length === 1) return this.portal(ctx);
    if (ctx.subscription && !subscriptions.some((sub) => sub.id === ctx.subscription && terminal(sub.status))) throw new BillingError("reconcile");

    const sessions = await this.provider.checkouts(ctx.customer!);
    let op = await this.fenced(ctx, (tx) => tx.externalOperation.findFirst({ where: { tenantId: ctx.actor.tenantId, kind: "checkout_create", state: { in: unresolved } } }));
    // Untracked open/completed sessions may already represent a subscription.
    // Terminal historical sessions are safe only when their local attempt was resolved.
    for (const session of sessions.filter((s) => s.status !== "expired")) {
      if (session.id === op?.providerObjectId || (op && session.operationId === op.id)) continue;
      const known = await this.fenced(ctx, (tx) => tx.externalOperation.findFirst({ where: { tenantId: ctx.actor.tenantId,
        kind: "checkout_create", providerObjectId: session.id, state: "succeeded" } }));
      if (session.status === "open" || !known) throw new BillingError("reconcile");
    }
    if (op) {
      if (op.parameterFingerprint !== this.fingerprint("checkout_create", ctx)) throw new BillingError("reconcile");
      const matches = sessions.filter((s) => s.operationId === op!.id);
      if (matches.length > 1) throw new BillingError("reconcile");
      const sessionId = op.providerObjectId ?? matches[0]?.id;
      const session = sessionId ? await this.provider.checkout(sessionId) : undefined;
      if (session) {
        this.validateCheckout(session, ctx, op);
        if (session.status === "expired") { await this.finish(ctx, op, "expired", session.id); op = null; }
        else if (session.status === "open" && session.expiresAt > Date.now() / 1000) {
          const url = this.safeUrl(session.url, "checkout.stripe.com");
          await this.finish(ctx, op, "open", session.id); return url;
        } else throw new BillingError("reconcile"); // Completed requires 8.5.4 reconciliation, never a new checkout.
      } else if (Date.now() - op.createdAt.getTime() >= 23 * 60 * 60 * 1000) throw new BillingError("reconcile");
    }
    op ??= await this.reserve(ctx, "checkout_create");
    await this.fenced(ctx, async () => {});
    const session = await this.provider.createCheckout(ctx.customer!, ctx.actor.tenantId, op.id, op.idempotencyKey, this.config);
    this.validateCheckout(session, ctx, op);
    if (session.status !== "open" || session.expiresAt <= Date.now() / 1000) throw new BillingError("reconcile");
    const url = this.safeUrl(session.url, "checkout.stripe.com");
    await this.finish(ctx, op, "open", session.id);
    return url;
  }

  async start(actor: BillingActor, intent: "checkout" | "portal"): Promise<string> {
    let ctx: Context | undefined;
    try {
      const base = new URL(this.config.baseUrl);
      if ((intent === "checkout" && !/^price_[A-Za-z0-9]+$/.test(this.config.priceId)) || !this.config.accountScope ||
        !["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new BillingError("configuration");
      const acquired = await this.locked(actor, async (tx, tenant, now) => {
        if (tenant.billingLeaseExpiresAt && tenant.billingLeaseExpiresAt > now) throw new BillingError("busy");
        const owner = randomUUID(), version = tenant.billingVersion + 1n;
        await tx.tenant.update({ where: { id: actor.tenantId }, data: { billingLeaseOwner: owner, billingLeaseExpiresAt: new Date(now.getTime() + 120000), billingVersion: version } });
        return { tenant, context: { actor, owner, version, customer: tenant.stripeCustomerId, subscription: tenant.stripeSubscriptionId } };
      });
      ctx = acquired.context;
      await this.customer(ctx, acquired.tenant);
      if (intent === "checkout" && acquired.tenant.subscriptionStatus !== "free" && !ctx.subscription) throw new BillingError("reconcile");
      return intent === "portal" ? await this.portal(ctx) : await this.checkout(ctx);
    } catch (error) {
      // Pending is already durable even if this best-effort unknown marker fails.
      if (ctx) try {
        const context = ctx;
        await this.fenced(context, async (tx) => {
          const pending = await tx.externalOperation.findMany({ where: { tenantId: actor.tenantId, state: "pending",
            kind: { in: ["customer_create", "checkout_create", "portal_create"] } } });
          for (const op of pending) {
            await tx.externalOperation.update({ where: { id: op.id }, data: { state: "unknown", outcomeCode: "unconfirmed" } });
            await this.audit(tx, context, op, "unknown");
          }
        });
      } catch { /* Reconciliation retains the committed intent. */ }
      if (error instanceof BillingError) throw error;
      throw new BillingError("unavailable");
    } finally {
      if (ctx) try { await this.db.tenant.updateMany({ where: { id: actor.tenantId, billingLeaseOwner: ctx.owner, billingVersion: ctx.version },
        data: { billingLeaseOwner: null, billingLeaseExpiresAt: null } }); } catch { /* Lease expiry permits recovery after a process/database interruption. */ }
    }
  }
}
