import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/roles";
import { requireUser } from "@/lib/session-guard";
import { listMembers, listUsers } from "@/lib/services";
import { MembersManager } from "./MembersManager";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await requireUser();
  if (!isAdminRole(identity.role)) redirect(`/projects/${(await params).id}/bugs`);
  const { id } = await params;
  const members = listMembers(identity, Number(id));
  const users = listUsers(identity);

  return (
    <div className="bb-card" style={{ padding: "1rem" }}>
      <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>项目成员</h2>
      <MembersManager
        projectId={Number(id)}
        members={members}
        users={users.map((u) => ({
          id: u.id,
          username: u.username,
          active: !!u.active,
        }))}
      />
    </div>
  );
}
