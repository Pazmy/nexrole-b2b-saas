import { AccountForm } from "@/components/account-form";
import { verifyEmailAction, resendVerificationAction } from "@/app/account-actions";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="min-h-screen bg-zinc-950 p-6 pt-20"><AccountForm
    title={token ? "Verify your email" : "Resend verification"}
    description={token ? "Confirm your email address to finish setting up your account." : "Enter your account email to request a new verification link."}
    action={token ? verifyEmailAction : resendVerificationAction} token={token}
    fields={token ? [] : [{ name: "email", label: "Email", type: "email", autoComplete: "email" }]}
    button={token ? "Verify email" : "Send verification email"} finishOnSuccess={Boolean(token)}
  /></main>;
}
