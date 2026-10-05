import { redirect } from "next/navigation";

export default function MembersPage() {
  redirect("/settings?tab=team");
}
