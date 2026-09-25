import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254));
// bcrypt ignores bytes beyond 72. Reject rather than silently truncate passwords.
export const newPasswordSchema = z.string().min(12, "Use at least 12 characters.")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "Use a password of at most 72 bytes.");
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(256),
});
export const registrationSchema = z.object({
  name: z.string().trim().min(2, "Company name must have at least 2 characters.").max(120),
  email: emailSchema,
  password: newPasswordSchema,
});
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, "This link is invalid or has expired. Request a new one.");
export const tokenPasswordSchema = z.object({ token: tokenSchema, password: newPasswordSchema });
export type AccountState = { success?: boolean; error?: string | null; message?: string } | null;
