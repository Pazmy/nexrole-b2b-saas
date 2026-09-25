import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import { prisma } from "@nexrole/database";

export class RateLimitError extends Error {
  constructor() { super("Too many attempts. Please wait 15 minutes and try again."); }
}

export async function takeLimit(scope: string, identity: string, maximum: number) {
  const key = createHash("sha256").update(`${scope}:${identity}`).digest("hex");
  // A single atomic PostgreSQL upsert shares limits between all application instances.
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO auth_rate_limits (key, count, "expiresAt") VALUES (${key}, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_rate_limits."expiresAt" <= NOW() THEN 1 ELSE LEAST(auth_rate_limits.count + 1, ${maximum + 1}) END,
      "expiresAt" = CASE WHEN auth_rate_limits."expiresAt" <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE auth_rate_limits."expiresAt" END
    RETURNING count`;
  if (!rows[0] || rows[0].count > maximum) throw new RateLimitError();
}

export async function limitAccountRequest(scope: string, identity: string, maximum = 5) {
  // Trust only a header explicitly configured and overwritten by the deployment's reverse proxy.
  const header = process.env.RATE_LIMIT_IP_HEADER;
  const candidate = header ? (await headers()).get(header)?.trim() : undefined;
  const ip = candidate && isIP(candidate) ? candidate : "shared";
  await takeLimit(`${scope}:network`, ip, ip === "shared" ? 200 : 30);
  await takeLimit(`${scope}:identity`, identity, maximum);
}
