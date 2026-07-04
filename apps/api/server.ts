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
import { prisma } from "@nexrole/database";
import { authTenant } from "./middleware.js";
import { apiKeyAuth } from "./middleware/apiKeyAuth.js";
import { webhookRouter } from "./routes/webhook.js";

const app = express();
const PORT = process.env.PORT || 5000;

app.use("/api/webhooks", webhookRouter);

app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());

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
    console.error("Database Error:", error);
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
      console.error("Failed to fetch transactions:", error);
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
      console.log(
        `Programmatic API extraction triggered for Tenant ID: [${req.tenantId}]`,
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
      console.error("Programmatic Endpoint Processing Failure:", error);
      res
        .status(500)
        .json({ error: "Internal server error exporting system metrics." });
    }
  },
);

app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
});
