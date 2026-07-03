import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { prisma } from "@nexrole/database";
import { rawBodyParser } from "../middleware/rawBody.js";
import { SUBSCRIPTION_STATUS } from "../constants.js";

const router = Router();

interface StripeInvoiceWithSubscriptionDetails extends Stripe.Invoice {
  subscription_details?: {
    metadata?: {
      tenantId?: string;
    };
  };
}

// Initialize Stripe with your private secret key (ensure this lives in your root .env)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "mock_key_for_dev", {
  apiVersion: "2026-06-24.dahlia",
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

router.post("/stripe", rawBodyParser, async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];

  let event: Stripe.Event;

  try {
    if (!sig || !endpointSecret) {
      throw new Error(
        "Missing stripe-signature header or webhook endpoint verification token.",
      );
    }
    // Cryptographically verify that the event payload came genuinely from Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `⚠️ Webhook signature authorization check failed: ${errorMessage}`,
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
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { 
              subscriptionStatus: status,
              stripeCustomerId: stripeCustomerId,
            },
          });
          console.log(
            `💳 Tenant [${tenantId}] billing subscription state updated to: ${status.toUpperCase()} (Customer: ${stripeCustomerId})`,
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
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE },
          });
          console.warn(
            `🚨 Payment collection failed for Tenant [${tenantId}]. Flagged as PAST_DUE.`,
          );
        }
        break;
      }

      default:
        console.log(`ℹ️ Unhandled Stripe hook event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (dbError) {
    console.error(
      "Database sync execution fault during stripe processing:",
      dbError,
    );
    res
      .status(500)
      .json({ error: "Webhook event processing crashed internally." });
  }
});

export const webhookRouter = router;
