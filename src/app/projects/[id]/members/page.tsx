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
  const adminCount = members.filter((m) => m.role === "admin").length;
  const userCount = members.length - adminCount;

  return (
    <div className="bb-card bb-section-card bb-members">
      <header className="bb-members-head">
        <div>
          <h2>项目成员</h2>
          <p className="bb-muted bb-members-lead">
            谁能看见并处理这个项目的报障，由这里的名单决定。项目角色只管本项目；开户、停用账号仍在管理后台。
          </p>
        </div>
        <p className="bb-members-count" aria-live="polite">
          共 <strong>{members.length}</strong> 人
          {members.length > 0 ? (
            <>
              · 管理员 {adminCount} · 用户 {userCount}
            </>
          ) : null}
        </p>
      </header>

      <dl className="bb-members-roles">
        <div>
          <dt>用户</dt>
          <dd>可提报、跟进自己的单，并作为原报障人确认或打回。</dd>
        </div>
        <div>
          <dt>管理员</dt>
          <dd>可改本项目报障状态、处理成员与发布相关操作。</dd>
        </div>
      </dl>

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
