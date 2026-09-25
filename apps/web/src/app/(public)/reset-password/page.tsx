import Link from "next/link";
import { AccountForm } from "@/components/account-form";
import { resetPasswordAction } from "@/app/account-actions";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="min-h-screen bg-zinc-950 p-6 pt-20 text-zinc-100">{token ? <AccountForm title="Reset password"
    description="Choose a new password. This ends all your existing sessions." action={resetPasswordAction} token={token}
    fields={[{ name: "password", label: "New password", type: "password", autoComplete: "new-password" }]} button="Reset password" /> :
    <p className="text-center">This reset link is missing. <Link className="text-blue-400" href="/forgot-password">Request a new link</Link>.</p>}</main>;
}
