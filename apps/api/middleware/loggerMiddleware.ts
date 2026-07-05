import { Request, Response, NextFunction } from "express";
import { AsyncLocalStorage } from "async_hooks";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";

export interface LogContext {
  correlationId: string;
  tenantId?: string;
}

export const logStorage = new AsyncLocalStorage<LogContext>();

export function getContextLogger() {
  const context = logStorage.getStore();
  if (context) {
    return logger.child(context);
  }
  return logger;
}

export function loggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] || req.headers["x-request-id"] || randomUUID()) as string;
  res.setHeader("X-Correlation-ID", correlationId);

  req.correlationId = correlationId;

  const context: LogContext = { correlationId };

  // Bind tenantId dynamically when it's resolved by downstream middlewares
  Object.defineProperty(context, "tenantId", {
    get() {
      return req.tenantId;
    },
    enumerable: true,
  });

  logStorage.run(context, () => {
    const startTime = process.hrtime();
    const contextLogger = getContextLogger();

    contextLogger.info({
      req: {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      }
    }, `Incoming Request: ${req.method} ${req.url}`);

    res.on("finish", () => {
      const diff = process.hrtime(startTime);
      const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
      
      contextLogger.info({
        res: {
          statusCode: res.statusCode,
        },
        durationMs,
      }, `Request Completed: ${req.method} ${req.url} -> ${res.statusCode} (${durationMs}ms)`);
    });

    next();
  });
}
