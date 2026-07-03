import { prisma } from "@nexrole/database";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ShieldCheck, UserPlus } from "lucide-react";

interface InvitePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ProcessInvitePage({
  searchParams,
}: InvitePageProps) {
  const resolvedParams = await searchParams;
  const token = resolvedParams.token;

  if (!token) {
    return renderFailureCard(
      "Missing Authorization Token",
      "A valid secure token parameter must be passed inside the routing context URL.",
    );
  }

  // 1. Look up invitation parameters inside database logs
  const invite = await prisma.invitation.findUnique({
    where: { token },
  });

  if (!invite || invite.expiresAt < new Date()) {
    return renderFailureCard(
      "Expired or Invalid Token",
      "This workspace invitation token signature is unrecognized or expired.",
    );
  }

  // Fetch tenant information context to present to the user
  const tenant = await prisma.tenant.findUnique({
    where: { id: invite.tenantId },
  });

  // 2. Process Registration Completion using inline server configurations
  async function submitInviteRegistration(formData: FormData) {
    "use server";
    const password = formData.get("password") as string;
    const incomingToken = formData.get("token") as string;

    const activeInvite = await prisma.invitation.findUnique({
      where: { token: incomingToken },
    });
    if (!activeInvite || activeInvite.expiresAt < new Date())
      throw new Error("Token expired");

    const encryptedPassword = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.create({
        data: {
          email: activeInvite.email,
          passwordHash: encryptedPassword,
          tenantId: activeInvite.tenantId,
          roleId: activeInvite.roleId,
        },
      }),
      prisma.invitation.delete({ where: { token: incomingToken } }), // Consume invitation token
    ]);

    redirect("/login");
  }

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

        <form action={submitInviteRegistration} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400 font-medium uppercase">
              Your Account Email
            </label>
            <Input
              value={invite.email}
              disabled
              className="bg-zinc-950 border-zinc-800 text-zinc-500 disabled:opacity-100 font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400 font-medium uppercase">
              Account Password
            </label>
            <Input
              name="password"
              type="password"
              placeholder="Choose a password"
              required
              className="bg-zinc-950 border-zinc-800 text-white placeholder-zinc-700"
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 font-medium gap-2 text-white"
          >
            <UserPlus className="h-4 w-4" />
            Complete Workspace Enrollment
          </Button>
        </form>
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
