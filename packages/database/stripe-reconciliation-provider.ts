import { ReconciliationError, type ReconciliationProvider } from "./billing-reconciliation.js";

// Structural SDK boundary shared by Express and Next.js, without adding a Stripe
// runtime dependency to this package. Each application pins its SDK/API version.
interface StripeReader {
  customers: { retrieve(id: string): Promise<unknown> };
  invoices: { retrieve(id: string): Promise<unknown> };
  subscriptions: { retrieve(id: string): Promise<unknown>; list(params: { customer: string; status: "all"; limit: number }): AsyncIterable<unknown> };
  checkout: { sessions: { retrieve(id: string, params: { expand: string[] }): Promise<unknown>;
    list(params: { customer: string; limit: number }): AsyncIterable<unknown> } };
}
async function bounded(values: AsyncIterable<unknown>) {
  const result: unknown[] = [];
  const deadline = Date.now() + 20000;
  for await (const value of values) {
    result.push(value);
    if (result.length > 500 || Date.now() >= deadline) throw new ReconciliationError("retry", "scan_limit");
  }
  return result;
}
export function stripeReconciliationProvider(stripe: StripeReader): ReconciliationProvider {
  return {
    get: (kind, id) => kind === "customer" ? stripe.customers.retrieve(id) : kind === "invoice" ? stripe.invoices.retrieve(id) :
      kind === "subscription" ? stripe.subscriptions.retrieve(id) : stripe.checkout.sessions.retrieve(id, { expand: ["line_items"] }),
    list: (kind, customer) => kind === "subscription" ? bounded(stripe.subscriptions.list({ customer, status: "all", limit: 100 })) :
      bounded(stripe.checkout.sessions.list({ customer, limit: 100 })),
  };
}
