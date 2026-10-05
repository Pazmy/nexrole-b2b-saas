import { env } from "./lib/env.js";
import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { prisma } from "@nexrole/database";
import { apiKeyAuth } from "./middleware/apiKeyAuth.js";
import { webhookRouter } from "./routes/webhook.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { loggerMiddleware, getContextLogger } from "./middleware/loggerMiddleware.js";

export const app = express();

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(",")
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

