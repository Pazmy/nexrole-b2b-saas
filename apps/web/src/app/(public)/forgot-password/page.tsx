import { AccountForm } from "@/components/account-form";
import { forgotPasswordAction } from "@/app/account-actions";

export default function ForgotPasswordPage() {
  return <main className="min-h-screen bg-zinc-950 p-6 pt-20"><AccountForm title="Forgot password"
    description="Enter your account email to request a password reset link." action={forgotPasswordAction}
    fields={[{ name: "email", label: "Email", type: "email", autoComplete: "email" }]} button="Send reset email" finishOnSuccess={false} /></main>;
}
