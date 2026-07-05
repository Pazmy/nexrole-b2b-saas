import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // 1. Server-side detailed logging
  console.error("[Global Error Handler] Caught exception:", err);

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
