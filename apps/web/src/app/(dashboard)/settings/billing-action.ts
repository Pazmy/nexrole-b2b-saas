"use server";

import { auth } from "@/auth";
import Stripe from "stripe";
import { redirect } from "next/navigation";
import { prisma } from "@nexrole/database";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-06-24.dahlia",
});

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// 1. TRIGGER STRIPE CHECKOUT (For Upgrading from Free to Pro)
export async function startCheckoutSession() {
  const session = await auth();

  if (!session?.user) throw new Error("User is not authenticated.");

  const tenantId = session.user.tenantId;
  const userEmail = session.user.email ?? undefined;

  if (!tenantId) throw new Error("Unauthorized context.");

  // Create a secure hosted checkout window
  const checkoutSession = await stripe.checkout.sessions.create({
    customer_email: userEmail,
    payment_method_types: ["card"],
    line_items: [
      {
        price: process.env.STRIPE_PRO_PRICE_ID, // Your Stripe Product Price ID (e.g., prod_xyz)
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: `${BASE_URL}/settings?tab=profile&billing_success=true`,
    cancel_url: `${BASE_URL}/settings?tab=profile`,
    metadata: {
      tenantId: tenantId, // ⬅️ The key hook! Passed to Stripe, returned to our Webhook
    },
    subscription_data: {
      metadata: {
        tenantId: tenantId,
      },
    },
  });

  if (!checkoutSession.url)
    throw new Error("Stripe routing allocation failed.");

  redirect(checkoutSession.url);
}

// 2. TRIGGER STRIPE CUSTOMER PORTAL (For Resolving Past Due Billing Errors)
export async function startCustomerPortalSession() {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  const userEmail = session?.user?.email;

  if (!tenantId) throw new Error("Unauthorized context.");
  if (!userEmail) throw new Error("User email not found in session.");

  // Fetch the tenant from the database to see if we already have a customer ID mapped
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeCustomerId: true },
  });

  let customerId = tenant?.stripeCustomerId;

  // If not found in database (e.g. local development or fallback), look up/create dynamically in Stripe
  if (!customerId) {
    const customers = await stripe.customers.list({
      email: userEmail,
      limit: 1,
    });

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          tenantId: tenantId,
        },
      });
      customerId = customer.id;
    }

    // Save the customerId back to the database for future requests
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { stripeCustomerId: customerId },
    });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    return_url: `${BASE_URL}/settings`,
    customer: customerId,
  });

  if (!portalSession.url) throw new Error("Stripe portal routing failed.");

  redirect(portalSession.url);
}
