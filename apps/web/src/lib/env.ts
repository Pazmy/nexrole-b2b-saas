import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().min(1),
  EXPRESS_API_URL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRO_PRICE_ID: z.string().min(1),
});

let envData: z.infer<typeof envSchema>;

if (typeof window === "undefined") {
  const parsed = envSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    EXPRESS_API_URL: process.env.EXPRESS_API_URL,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRO_PRICE_ID: process.env.STRIPE_PRO_PRICE_ID,
  });

  if (!parsed.success) {
    console.error(
      "❌ Invalid environment variables in Next.js:",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    );
    throw new Error("Invalid environment configuration. See logs above.");
  }

  envData = parsed.data;
} else {
  envData = {
    DATABASE_URL: "",
    AUTH_SECRET: "",
    NODE_ENV: (process.env.NODE_ENV as "development" | "production" | "test") || "development",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "",
    EXPRESS_API_URL: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    STRIPE_PRO_PRICE_ID: "",
  };
}

export const env = envData;
