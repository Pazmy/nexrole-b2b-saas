import "server-only";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import { BillingService, BillingError, BillingReconciler, stripeReconciliationProvider, prisma, type BillingProvider, type BillingCustomer, type BillingCheckout } from "@nexrole/database";

const reference = (value: string | { id: string } | null) => typeof value === "string" ? value : value?.id ?? null;
function customer(value: Stripe.Customer | Stripe.DeletedCustomer): BillingCustomer {
  if (value.deleted) return { id: value.id, livemode: false, deleted: true };
  return { id: value.id, livemode: value.livemode, tenantId: value.metadata.tenantId, operationId: value.metadata.operationId };
}
function checkout(value: Stripe.Checkout.Session): BillingCheckout {
  return { id: value.id, customerId: reference(value.customer), livemode: value.livemode, mode: value.mode,
    status: value.status, expiresAt: value.expires_at, url: value.url,
    tenantId: value.metadata?.tenantId, operationId: value.metadata?.operationId,
    priceIds: value.line_items?.has_more ? [] : (value.line_items?.data.map((line) => line.price?.id ?? "") ?? []),
    quantity: value.line_items?.data.length === 1 ? value.line_items.data[0].quantity : null };
}
async function bounded<T>(items: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of items) {
    result.push(item);
    if (result.length > 500) throw new BillingError("reconcile");
  }
  return result;
}

// Separate adapter: tests replace the external boundary, never database locks.
export function stripeBillingProvider(stripe: Stripe): BillingProvider {
  return {
    customer: async (id) => customer(await stripe.customers.retrieve(id)),
    findCustomers: async (tenantId, operationId) => {
      const found = await bounded(stripe.customers.search({ query: `metadata['tenantId']:'${tenantId}' AND metadata['operationId']:'${operationId}'`, limit: 100 }));
      return found.map(customer);
    },
    createCustomer: async (tenantId, operationId, key) => customer(await stripe.customers.create({ metadata: { tenantId, operationId } }, { idempotencyKey: key })),
    subscriptions: async (customerId) => (await bounded(stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })))
      .map((sub) => ({ id: sub.id, customerId: reference(sub.customer)!, livemode: sub.livemode, status: sub.status })),
    checkouts: async (customerId) => (await bounded(stripe.checkout.sessions.list({ customer: customerId, limit: 100 }))).map(checkout),
    checkout: async (id) => checkout(await stripe.checkout.sessions.retrieve(id, { expand: ["line_items"] })),
    createCheckout: async (customerId, tenantId, operationId, key, config) => checkout(await stripe.checkout.sessions.create({
      customer: customerId, payment_method_types: ["card"], mode: "subscription",
      line_items: [{ price: config.priceId, quantity: 1 }], expand: ["line_items"],
      success_url: `${config.baseUrl}/settings?tab=profile&billing_success=true`, cancel_url: `${config.baseUrl}/settings?tab=profile`,
      metadata: { tenantId, operationId }, subscription_data: { metadata: { tenantId, operationId } },
    }, { idempotencyKey: key })),
    createPortal: async (customerId, key, baseUrl) => {
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${baseUrl}/settings?tab=profile` }, { idempotencyKey: key });
      return { id: session.id, url: session.url };
    },
  };
}

export function getBillingService() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !/^(sk|rk)_(test|live)_/.test(secret)) throw new BillingError("configuration");
  const stripe = new Stripe(secret, { apiVersion: "2026-06-24.dahlia", timeout: 10000, maxNetworkRetries: 1 });
  return new BillingService(prisma, stripeBillingProvider(stripe), {
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? "", baseUrl: (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, ""),
    livemode: /^(sk|rk)_live_/.test(secret),
    // Key/config changes block outstanding attempts rather than replaying in a different account.
    accountScope: createHash("sha256").update(secret).digest("hex"),
  });
}

export function getBillingReconciler() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !/^(sk|rk)_(test|live)_/.test(secret)) throw new BillingError("configuration");
  const stripe = new Stripe(secret, { apiVersion: "2026-06-24.dahlia", timeout: 10000, maxNetworkRetries: 1 });
  return new BillingReconciler(prisma, stripeReconciliationProvider(stripe), {
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? "", livemode: /^(sk|rk)_live_/.test(secret),
  });
}
