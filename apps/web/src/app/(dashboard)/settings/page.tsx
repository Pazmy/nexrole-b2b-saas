import { auth } from "@/auth";
import { prisma } from "@nexrole/database";
import { ProfileForm } from "./_components/ProfileForm";
import { Building2, Users, UserCheck } from "lucide-react";
import Link from "next/link";
import { ROLE } from "@/lib/constants";
import InviteMemberForm from "@/components/invite-member-form";

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

enum Tabs {
  Profile = "profile",
  Team = "team",
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const session = await auth();
  const tenantId = (session?.user as { tenantId?: string })?.tenantId;
  const userRole = (session?.user as { role?: string })?.role;

  const resolvedParams = await searchParams;
  const activeTab = resolvedParams.tab || Tabs.Profile;

  const [tenant, teamMembers] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.user.findMany({
      where: { tenantId },
      include: { role: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Console Configurations
        </h1>
        <p className="text-zinc-400 mt-1">
          Manage corporate boundaries, access levels, and workspace directory
          logs.
        </p>
      </div>

      {/* TAB CONTROLLERS (URL-Driven Link Nodes) */}
      <div className="flex border-b border-zinc-800 gap-2">
        <Link
          href={`?tab=${Tabs.Profile}`}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === Tabs.Profile
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Building2 className="h-4 w-4" />
          Company Profile
        </Link>
        <Link
          href={`?tab=${Tabs.Team}`}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-all ${
            activeTab === Tabs.Team
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Users className="h-4 w-4" />
          Team Members ({teamMembers.length})
        </Link>
      </div>

      {/* PROFILE SUB-PANEL VIEW */}
      {activeTab === Tabs.Profile && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-zinc-200">
              Organization Settings
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Modify the foundational credentials of your enterprise profile.
            </p>
          </div>

          <ProfileForm tenant={tenant} userRole={userRole} />
        </div>
      )}

      {/* TEAM SUB-PANEL VIEW */}
      {activeTab === Tabs.Team && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-zinc-200">
                Active Membership Log
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Real-time listing of verified identities inside this company
                container.
              </p>
            </div>

            {/* RBAC INTERFACE LOCK */}
            {userRole === ROLE.SUPER_ADMIN && <InviteMemberForm />}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/40 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    <th className="p-4">User Email Address</th>
                    <th className="p-4">Assigned Authorization Tier</th>
                    <th className="p-4 text-right">
                      System Enrollment Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-sm">
                  {teamMembers.map((member) => (
                    <tr
                      key={member.id}
                      className="hover:bg-zinc-850/20 transition-colors"
                    >
                      <td className="p-4 text-zinc-200 font-medium font-mono">
                        {member.email}
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold font-mono border uppercase ${
                            member.role.name === ROLE.SUPER_ADMIN
                              ? "bg-blue-950/40 border-blue-800/40 text-blue-400"
                              : "bg-zinc-800 border-zinc-700 text-zinc-300"
                          }`}
                        >
                          <UserCheck className="h-3 w-3" />
                          {member.role.name}
                        </span>
                      </td>
                      <td className="p-4 text-right font-mono text-zinc-500 text-xs">
                        {new Date(member.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
