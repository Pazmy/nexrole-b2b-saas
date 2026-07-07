import { Request, Response, NextFunction } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "./lib/env.js";

export function authTenant(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res
      .status(401)
      .json({ error: "Access denied. No authentication token provided." });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      env.AUTH_SECRET,
    ) as JwtPayload;

    req.tenantId = decoded.tenantId;
    req.userRole = decoded.role;
    req.userEmail = decoded.email;

    next();
  } catch {
    res.status(403).json({ error: "Invalid or expired authorization token." });
  }
}
