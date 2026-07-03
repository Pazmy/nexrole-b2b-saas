import express from "express";

// Middleware to supply raw request bodies required for cryptographically checking Stripe signatures
export const rawBodyParser = express.raw({ type: "application/json" });
