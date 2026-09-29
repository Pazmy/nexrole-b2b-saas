import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
export { writeRequiredAudit, AuditPersistenceError } from "./audit.js";
export { BillingService, BillingError } from "./billing-service.js";
export { BillingReconciler, ReconciliationError } from "./billing-reconciliation.js";
export { stripeReconciliationProvider } from "./stripe-reconciliation-provider.js";
export { getCheckoutDecision, getInvoiceSubscriptionId, matchesBillingOwnership, BILLING_SUBSCRIPTION_STATUSES } from "./billing-rules.js";
let prismaInstance = null;
function getPrisma() {
    if (!prismaInstance) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error("DATABASE_URL environment variable is not defined");
        }
        const pool = new pg.Pool({ connectionString });
        const adapter = new PrismaPg(pool);
        prismaInstance = new PrismaClient({ adapter });
    }
    return prismaInstance;
}
export const prisma = new Proxy({}, {
    get(target, prop) {
        const instance = getPrisma();
        const value = Reflect.get(instance, prop);
        if (typeof value === "function") {
            return value.bind(instance);
        }
        return value;
    }
});
