## Appendix A: Credential Acquisition & Secret Provisioning Guide

This section details how to acquire every environmental token variable required to run NexRole B2B SaaS securely across local and cloud lifecycles.

---

### 1. Stripe Credentials Pipeline

#### A. Stripe Secret Key (`STRIPE_SECRET_KEY`)

- **Local Development (`sk_test_...`):**
  1. Log into your account console via the [Stripe Dashboard](https://dashboard.stripe.com).
  2. In the top right header panel, ensure the **Test Mode** toggle is switched **ON**.
  3. Navigate to **Developers** $\rightarrow$ **API Keys**.
  4. Under the "Standard Keys" sheet, locate the **Secret Key** row and click **Reveal live token**.
  5. Copy the resulting string and append it directly to your local `.env` file.
- **Cloud Production (`sk_live_...`):**
  1. Log into your live-verified Stripe account console dashboard.
  2. Ensure the **Test Mode** toggle is switched **OFF** (Live Mode active).
  3. Navigate to **Developers** $\rightarrow$ **API Keys** and reveal the live secret key string.
  4. Inject this securely into your cloud environment variable vault container (e.g., Vercel / AWS Parameter Store).

#### B. Stripe Subscription Price ID (`STRIPE_PRO_PRICE_ID`)

1. Inside your Stripe Dashboard (Test Mode for local development, Live Mode for production release execution), select the **Product Catalog** tab.
2. Click **+ Add Product**. Name the item `Enterprise Pro` (or your preferred premium branding).
3. Under billing mechanics, set the pricing structure configuration to **Recurring** and select **Monthly** from the menu rules.
4. Input your subscription value fee amount (e.g., `$49.00`).
5. Click **Save Product**.
6. On the product specification page that opens up, look down into the "Pricing" data grid sheet and copy the unique **API ID token string** starting with `price_...`.

#### C. Stripe Webhook Verification Secret (`STRIPE_WEBHOOK_SECRET`)

- **Local Development Flow (Using Stripe CLI Reverse Tunnel):**
  1. Spin up your local platform application servers.
  2. Open a separate shell terminal and invoke authentication authorization protocols:
     ```bash
     stripe login
     ```
  3. Establish the secure edge proxy listener bridge by pointing data straight at your local running Express port:
     ```bash
     stripe listen --forward-to localhost:5000/api/webhooks/stripe
     ```
  4. Look closely at the raw console logs outputted by the terminal command sequence. Copy the string starting with `whsec_...` that appears right inside the text block.
- **Cloud Production Flow (Using Direct Link Ingestion):**
  1. Navigate to your cloud Stripe Dashboard (Live Mode active) $\rightarrow$ **Developers** $\rightarrow$ **Webhooks**.
  2. Click the **+ Add Endpoint** conversion action button.
  3. Input your live microservice domain webhook landing path exactly:
     ```text
     [https://api.yourproductiondomain.com/api/webhooks/stripe](https://api.yourproductiondomain.com/api/webhooks/stripe)
     ```
  4. Check the event selector scope array properties to intercept exactly three events:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `invoice.payment_failed`
  5. Save the endpoint entity entry. On the status control dashboard panel that loads up, locate the **Signing Secret** block wrapper and reveal the production `whsec_...` security token payload.

---

### 2. NexRole Internal Developer Machine Keys (`nr_live_...`)

This details the extraction sequence to provision machine keys built during **Phase 5** for background integrations or internal scripts:

```text
[ SuperAdmin Login ] ──> [ Settings Console ] ──> [ Developer Tab ] ──> [ Generate Token ] ──> [ Copy Key Once ]
```
