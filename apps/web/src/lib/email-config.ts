import "server-only";

export function emailConfig() {
  const production = process.env.NODE_ENV === "production";
  const mode = process.env.EMAIL_MODE || (production ? "" : "preview");
  if (mode !== "preview" && mode !== "resend") throw new Error("Set EMAIL_MODE to resend in production.");
  if (production && mode === "preview") throw new Error("Email preview mode is only allowed in development or tests.");
  // Read the origin at runtime; direct NEXT_PUBLIC_* access can be frozen at build time.
  const runtimeEnvironment = process.env;
  const baseUrl = new URL(runtimeEnvironment.NEXT_PUBLIC_APP_URL || (production ? "" : "http://localhost:3000"));
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password ||
      baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash || (production && baseUrl.protocol !== "https:")) {
    throw new Error("NEXT_PUBLIC_APP_URL must be an application origin (HTTPS in production).");
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (mode === "resend" && (!apiKey?.startsWith("re_") || /placeholder|your_actual/i.test(apiKey) ||
      !from || !/^[^\r\n]+@[^\r\n]+$/.test(from))) {
    throw new Error("Configure RESEND_API_KEY and EMAIL_FROM before enabling Resend.");
  }
  return { mode, baseUrl: baseUrl.origin, apiKey, from };
}
