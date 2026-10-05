import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emailConfig } from "./email-config";

export async function sendAccountEmail(to: string, purpose: "verify" | "reset" | "invite", token: string) {
  const config = emailConfig();
  const route = { verify: "/verify-email", reset: "/reset-password", invite: "/register/invite" }[purpose];
  const url = new URL(route, config.baseUrl);
  url.searchParams.set("token", token);
  const subject = { verify: "Verify your NexRole email", reset: "Reset your NexRole password", invite: "Join your NexRole workspace" }[purpose];
  const lifetime = purpose === "reset" ? "30 minutes" : "24 hours";
  const text = `${subject}\n\nOpen this link to continue:\n${url}\n\nThis link expires in ${lifetime} and can only be used once. If you did not request this email, you can ignore it.`;
  if (config.mode === "preview") {
    // Never use public/: these files contain bearer credentials and stay on the developer's machine.
    const directory = path.resolve(process.cwd(), ".email-previews");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, `${Date.now()}-${randomUUID()}.txt`), `To: ${to}\nSubject: ${subject}\n\n${text}`, { mode: 0o600, flag: "wx" });
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.from, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  // Do not log provider bodies, recipients, or token URLs.
  if (!response.ok) throw new Error("Email delivery failed. Try again later.");
}
