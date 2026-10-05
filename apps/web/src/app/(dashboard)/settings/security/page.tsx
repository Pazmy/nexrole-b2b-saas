import { requirePermission } from "@/lib/authorization";
import { AccountForm } from "@/components/account-form";
import { changePasswordAction } from "@/app/account-actions";

export default async function SecurityPage() {
  await requirePermission("workspace:read");
  return <AccountForm title="Change password" description="Enter your current password and choose a new one. You will need to sign in again on every device."
    action={changePasswordAction} button="Change password" fields={[
      { name: "currentPassword", label: "Current password", type: "password", autoComplete: "current-password" },
      { name: "password", label: "New password", type: "password", autoComplete: "new-password" },
    ]} />;
}
