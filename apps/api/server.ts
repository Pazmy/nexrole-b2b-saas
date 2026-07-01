import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { prisma } from "@nexrole/database";
import { authTenant } from "./middleware.js";

dotenv.config({ path: "../../.env" });

const app = express();
const PORT = process.env.PORT || 5000;

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

app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
});
