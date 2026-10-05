import { Router } from "express";
import Stripe from "stripe";
import { BillingReconciler, ReconciliationError, stripeReconciliationProvider, prisma, type BillingEvent } from "@nexrole/database";
import { rawBodyParser } from "../middleware/rawBody.js";
import { getContextLogger } from "../middleware/loggerMiddleware.js";
import { env } from "../lib/env.js";

// Factory exposes only transport/provider boundaries to signed HTTP tests.
export function createWebhookRouter(verify: (body: Buffer, signature: string) => BillingEvent,
  handle: (event: BillingEvent) => Promise<{ disposition: string; reason: string }>) {
  const router = Router();
  router.post("/stripe", rawBodyParser, async (req, res) => {
    let event: BillingEvent;
    try {
      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) throw new Error("Invalid signature");
      event = verify(req.body, signature);
    } catch {
      getContextLogger().warn("Stripe signature verification failed.");
      res.status(400).json({ error: "Invalid webhook signature." }); return;
    }
    try {
      const result = await handle(event);
      getContextLogger().info({ eventId: event.id, disposition: result.disposition, reason: result.reason }, "Stripe event handled.");
      res.status(200).json({ received: true, ...result });
    } catch (error) {
      const reason = error instanceof ReconciliationError ? error.reason : "processing_unavailable";
      getContextLogger().warn({ eventId: event.id, reason }, "Stripe event remains retryable.");
      res.status(503).json({ error: "Billing synchronization is pending. Retry delivery." });
    }
  });
  return router;
}

let stripeInstance: Stripe | undefined;
function stripe() {
  return stripeInstance ??= new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-06-24.dahlia", timeout: 10000, maxNetworkRetries: 1 });
}
export const webhookRouter = createWebhookRouter(
  (body, signature) => stripe().webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET),
  (event) => {
    if (!/^(sk|rk)_(test|live)_/.test(env.STRIPE_SECRET_KEY)) throw new Error("Billing configuration unavailable");
    return new BillingReconciler(prisma, stripeReconciliationProvider(stripe()), {
      priceId: env.STRIPE_PRO_PRICE_ID ?? "", livemode: /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY),
    }).handle(event);
  },
);
