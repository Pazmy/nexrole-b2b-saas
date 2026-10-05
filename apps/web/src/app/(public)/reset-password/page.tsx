import Link from "next/link";
import { AccountForm } from "@/components/account-form";
import { resetPasswordAction } from "@/app/account-actions";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="min-h-screen bg-zinc-950 p-6 pt-20 text-zinc-100">{token ? <AccountForm title="Reset password"
    description="Choose a new password. This ends all your existing sessions." action={resetPasswordAction} token={token}
    fields={[{ name: "password", label: "New password", type: "password", autoComplete: "new-password" }]} button="Reset password"
    errorLinks={[{ href: "/forgot-password", label: "Request a new reset link" }]} /> :
    <section className="mx-auto w-full max-w-md space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-8">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <p>This reset link is missing.</p>
      <nav className="flex flex-wrap gap-4 text-sm text-blue-400">
        <Link href="/forgot-password">Request a new reset link</Link>
        <Link href="/login">Sign in</Link>
      </nav>
    </section>}</main>;
}
