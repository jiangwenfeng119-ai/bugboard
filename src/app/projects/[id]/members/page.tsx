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
    <div className="bb-card bb-section-card">
      <h2>项目成员</h2>
      <p className="bb-muted">
        项目角色只决定能不能改这个项目的报障。后台角色仍在管理后台设置。
      </p>
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
