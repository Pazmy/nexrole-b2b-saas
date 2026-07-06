import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ***** Handle Scope Issues with .env files
const __filename = fileURLToPath(import.meta.url);
let currentDir = path.dirname(__filename);

// console.log("[Dotenv Debug] __filename:", __filename);
let envPath = "";
while (currentDir !== path.parse(currentDir).root) {
  const checkPath = path.join(currentDir, ".env");
  if (fs.existsSync(checkPath)) {
    envPath = checkPath;
    break;
  }
  currentDir = path.dirname(currentDir);
}
// console.log("[Dotenv Debug] Resolved envPath:", envPath);

if (envPath) {
  const result = dotenv.config({ path: envPath });
  // console.log("[Dotenv Debug] dotenv config result:", result.error ? "Error: " + result.error.message : "Success");
} else {
  // console.log("[Dotenv Debug] envPath not found, running default dotenv.config()");
  dotenv.config();
}
// console.log("[Dotenv Debug] STRIPE_WEBHOOK_SECRET loaded:", process.env.STRIPE_WEBHOOK_SECRET ? "YES (starts with " + process.env.STRIPE_WEBHOOK_SECRET.substring(0, 10) + "...)" : "NO");
// *****END******

import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { prisma } from "@nexrole/database";
import { authTenant } from "./middleware.js";
import { apiKeyAuth } from "./middleware/apiKeyAuth.js";
import { webhookRouter } from "./routes/webhook.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { logger } from "./lib/logger.js";
import { loggerMiddleware, getContextLogger } from "./middleware/loggerMiddleware.js";

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000"];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests from this IP, please try again after 15 minutes."
  }
});

app.use(loggerMiddleware);
app.use(helmet());

app.use("/api/webhooks", webhookRouter);

app.use(cors(corsOptions));
app.use(express.json());
app.use("/api/v1", apiLimiter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "API is running" });
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { role: true, tenant: true },
    });
    res.status(200).json(users);
  } catch (error) {
    getContextLogger().error({ error }, "Database Error fetching users");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.get(
  "/api/transactions",
  authTenant,
  async (req: Request, res: Response) => {
    try {
      const tenantTransaction = await prisma.transaction.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json(tenantTransaction);
    } catch (error) {
      getContextLogger().error({ error }, "Failed to fetch transactions");
      res
        .status(500)
        .json({ error: "Internal server error reading company data logs." });
    }
  },
);

// Third-Party Developer API Route (Used programmatically by machine scripts via X-API-Key headers)
app.get(
  "/api/v1/transactions",
  apiKeyAuth,
  async (req: Request, res: Response) => {
    try {
      getContextLogger().info(
        { tenantId: req.tenantId },
        "Programmatic API extraction triggered"
      );

      const transactions = await prisma.transaction.findMany({
        where: { tenantId: req.tenantId },
        select: {
          id: true,
          amount: true,
          status: true,
          description: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      res.status(200).json({
        object: "list",
        count: transactions.length,
        data: transactions,
      });
    } catch (error) {
      getContextLogger().error({ error }, "Programmatic Endpoint Processing Failure");
      res
        .status(500)
        .json({ error: "Internal server error exporting system metrics." });
    }
  },
);

// Global Error Handler Middleware (must be registered after all route definitions)
app.use(errorHandler);

const server = app.listen(PORT, () => {
  logger.info(`🚀 API Server running on http://localhost:${PORT}`);
});

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  logger.info(`\n[${signal}] Received. Starting graceful shutdown sequence...`);

  // Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error({ err }, "Error closing server");
      process.exit(1);
    }
    logger.info("HTTP server closed. No longer accepting new connections.");

    try {
      // Disconnect database client
      await prisma.$disconnect();
      logger.info("Database connection pool closed successfully.");
      process.exit(0);
    } catch (dbErr) {
      logger.error({ err: dbErr }, "Error disconnecting database client");
      process.exit(1);
    }
  });

  // Force close after 10s timeout to prevent hanging forever
  setTimeout(() => {
    logger.error("Forcing shutdown after timeout expired.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
