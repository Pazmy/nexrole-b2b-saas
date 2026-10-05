import { prisma } from "@nexrole/database";
import { ShieldCheck } from "lucide-react";
import { hashToken } from "@/lib/accounts";
import { tokenSchema } from "@/lib/account-validation";
import InviteAcceptanceForm from "./invite-acceptance-form";

interface InvitePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ProcessInvitePage({
  searchParams,
}: InvitePageProps) {
  const resolvedParams = await searchParams;
  const parsed = tokenSchema.safeParse(resolvedParams.token);
  const token = parsed.success ? parsed.data : null;

  if (!token) {
    return renderFailureCard(
      "This invitation is no longer available",
      "The invitation link is missing or invalid. Ask your workspace administrator for a new invitation.",
    );
  }

  // Only the hash is stored; the raw token stays in the invitation link.
  const invite = await prisma.invitation.findUnique({
    where: { token: hashToken(token) },
  });

  if (!invite || invite.expiresAt <= new Date()) {
    return renderFailureCard(
      "This invitation is no longer available",
      "It may be expired or already used. Ask your workspace administrator for a new invitation.",
    );
  }

  // Fetch tenant information context to present to the user
  const tenant = await prisma.tenant.findUnique({
    where: { id: invite.tenantId },
    select: { name: true },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-white">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-950/50 border border-blue-800 text-blue-400 mb-4">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold text-zinc-100">Join Workspace</h1>
          <p className="text-xs text-zinc-400 mt-1">
            You are invited to join{" "}
            <span className="font-semibold text-zinc-200">{tenant?.name}</span>
          </p>
        </div>

        <InviteAcceptanceForm token={token} email={invite.email} />
      </div>
    </div>
  );
}

function renderFailureCard(title: string, msg: string) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-white">
      <div className="w-full max-w-md rounded-xl border border-red-900/30 bg-zinc-900 p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-950 border border-red-900 text-red-400 font-bold mb-4">
          !
        </div>
        <h1 className="text-lg font-bold text-zinc-100">{title}</h1>
        <p className="text-xs text-zinc-400 mt-2">{msg}</p>
      </div>
    </div>
  );
}
