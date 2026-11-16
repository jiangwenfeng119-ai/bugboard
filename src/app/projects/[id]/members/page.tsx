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
            普通用户只有在这份名单里才能看见本项目。改报障状态，要在本项目里是管理员。账号管理员可以打开全部项目，并维护这份名单。开户和停用账号仍在管理后台。
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
          <dd>可改本项目的报障状态。立即发布和标记已发布也要这个角色。本机发布任务来领队列时，用的 Key 还得是管理员级。</dd>
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
