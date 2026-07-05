import { Request, Response, NextFunction } from "express";
import { getContextLogger } from "./loggerMiddleware.js";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const contextLogger = getContextLogger();

  // 1. Server-side detailed logging using contextLogger
  contextLogger.error({ err }, "[Global Error Handler] Caught exception");

  // 2. Determine response status code
  const statusCode = err.status || err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === "production";

  // 3. Respond with sanitized JSON
  res.status(statusCode).json({
    error: {
      message: isProduction ? "An unexpected internal server error occurred." : err.message || "Internal server error.",
      ...(isProduction ? {} : { stack: err.stack }),
    },
  });
}
