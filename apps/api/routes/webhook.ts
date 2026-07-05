import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { prisma } from "@nexrole/database";
import { rawBodyParser } from "../middleware/rawBody.js";
import { SUBSCRIPTION_STATUS } from "../constants.js";
import { getContextLogger } from "../middleware/loggerMiddleware.js";

const router = Router();

interface StripeInvoiceWithSubscriptionDetails extends Stripe.Invoice {
  subscription_details?: {
    metadata?: {
      tenantId?: string;
    };
  };
}

let stripeInstance: Stripe | null = null;
function getStripe() {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY || "mock_key_for_dev", {
      apiVersion: "2026-06-24.dahlia",
    });
  }
  return stripeInstance;
}

router.post("/stripe", rawBodyParser, async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;

  try {
    getContextLogger().info("Webhook received. stripe-signature header verification initiated.");
    if (!sig || !endpointSecret) {
      throw new Error(
        `Missing stripe-signature header or webhook endpoint verification token. (sig: ${!!sig}, secret: ${!!endpointSecret})`,
      );
    }
    // Cryptographically verify that the event payload came genuinely from Stripe
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    getContextLogger().error(
      { err },
      `⚠️ Webhook signature authorization check failed: ${errorMessage}`
    );
    res.status(400).send(`Webhook Error: ${errorMessage}`);
    return;
  }

  // Handle distinct transactional payment events
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        // Retrieve custom metadata passed during checkout to trace the tenant mapping context
        const tenantId = subscription.metadata.tenantId;
        const status = subscription.status; // e.g., 'active', 'past_due', 'canceled', 'unpaid'
        const stripeCustomerId = subscription.customer as string;

        if (tenantId) {
          await prisma.$transaction([
            prisma.tenant.update({
              where: { id: tenantId },
              data: { 
                subscriptionStatus: status,
                stripeCustomerId: stripeCustomerId,
              },
            }),
            prisma.auditLog.create({
              data: {
                action: "TENANT_SUBSCRIPTION_UPDATED",
                tenantId: tenantId,
                metadata: {
                  event: event.type,
                  subscriptionStatus: status,
                  stripeCustomerId: stripeCustomerId,
                },
              },
            }),
          ]);

          getContextLogger().info(
            `💳 Tenant [${tenantId}] billing subscription state updated to: ${status.toUpperCase()} (Customer: ${stripeCustomerId})`
          );
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = (invoice as StripeInvoiceWithSubscriptionDetails).subscription_details?.metadata
          ?.tenantId;

        if (tenantId) {
          // Instantly lock account mutations by flag switching to 'past_due'
          await prisma.$transaction([
            prisma.tenant.update({
              where: { id: tenantId },
              data: { subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE },
            }),
            prisma.auditLog.create({
              data: {
                action: "TENANT_SUBSCRIPTION_PAYMENT_FAILED",
                tenantId: tenantId,
                metadata: {
                  event: event.type,
                  subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                  invoiceId: invoice.id,
                },
              },
            }),
          ]);

          getContextLogger().warn(
            `🚨 Payment collection failed for Tenant [${tenantId}]. Flagged as PAST_DUE.`
          );
        }
        break;
      }

      default:
        getContextLogger().info(`ℹ️ Unhandled Stripe hook event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (dbError) {
    getContextLogger().error(
      { err: dbError },
      "Database sync execution fault during stripe processing"
    );
    res
      .status(500)
      .json({ error: "Webhook event processing crashed internally." });
  }
});

export const webhookRouter = router;
