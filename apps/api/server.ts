import { app } from "./app.js";
import { env } from "./lib/env.js";
import { prisma } from "@nexrole/database";
import { logger } from "./lib/logger.js";

const PORT = env.PORT;

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
