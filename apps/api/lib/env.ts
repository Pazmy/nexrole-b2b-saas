import { z } from "zod";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Load dotenv configuration immediately in ESM context before validation
const __filename = fileURLToPath(import.meta.url);
let currentDir = path.dirname(__filename);
let envPath = "";

while (currentDir !== path.parse(currentDir).root) {
  const checkPath = path.join(currentDir, ".env");
  if (fs.existsSync(checkPath)) {
    envPath = checkPath;
    break;
  }
  currentDir = path.dirname(currentDir);
}

if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.string().default("5000").transform(Number),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  AUTH_SECRET: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  ALLOWED_ORIGINS: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables in Express API:",
    parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  );
  process.exit(1);
}

export const env = parsed.data;
