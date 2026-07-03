import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "@nexrole/database";

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const rawApiKey = req.headers["x-api-key"] as string;

  if (!rawApiKey) {
    res
      .status(401)
      .json({ error: "Access denied. X-API-Key header is missing." });
    return;
  }

  try {
    // Hash the incoming raw key to match against our stored hash signatures
    const hashedKey = crypto
      .createHash("sha256")
      .update(rawApiKey)
      .digest("hex");

    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: hashedKey },
    });

    if (!keyRecord) {
      res.status(403).json({
        error: "Forbidden. The provided API key is invalid or unrecognized.",
      });
      return;
    }

    // Bind the multi-tenant scope boundary parameters directly onto the request thread
    req.tenantId = keyRecord.tenantId;
    next();
  } catch (error) {
    console.error("API Key Interceptor Failure:", error);
    res.status(500).json({
      error: "An internal security exception occurred during verification.",
    });
  }
}
