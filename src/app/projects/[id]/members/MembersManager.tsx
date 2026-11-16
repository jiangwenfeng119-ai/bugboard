"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { roleLabel } from "@/lib/roles";

type Member = {
  id: number;
  username: string;
  role: string;
  account_role: string;
  active: number;
};

export function MembersManager({
  projectId,
  members,
  users,
}: {
  projectId: number;
  members: Member[];
  users: { id: number; username: string; active: boolean }[];
}) {
  const router = useRouter();
  const [userIds, setUserIds] = useState<string[]>([]);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [error, setError] = useState("");
  const memberIds = new Set(members.map((m) => m.id));
  const candidates = users.filter((u) => u.active && !memberIds.has(u.id));

  function toggleUser(id: string) {
    setUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function addMembers() {
    setError("");
    if (userIds.length === 0) return;
    const res = await fetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: userIds.map(Number), role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "添加失败");
      return;
    }
    setUserIds([]);
    setRole("user");
    router.refresh();
  }

  async function changeRole(id: number, next: string) {
    setError("");
    const res = await fetch(`/api/projects/${projectId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: id, role: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "修改角色失败");
      return;
    }
    router.refresh();
  }

  async function removeMember(id: number) {
    if (!confirm("确定移除此成员？")) return;
    const res = await fetch(
      `/api/projects/${projectId}/members?userId=${id}`,
      { method: "DELETE" }
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "移除失败");
      return;
    }
    router.refresh();
  }

  return (
    <div className="bb-members-body">
      <section className="bb-members-add-block" aria-labelledby="members-add-heading">
        <div className="bb-members-block-head">
          <h3 id="members-add-heading">添加成员</h3>
          <p className="bb-muted">
            从已开户且未加入本项目的用户里勾选，再指定项目角色。
          </p>
        </div>
        <div className="bb-member-add">
          <div className="bb-select bb-multi-select">
            {candidates.length === 0 ? (
              <div className="bb-multi-select-empty">暂无可添加用户</div>
            ) : (
              candidates.map((u) => {
                const id = String(u.id);
                const checked = userIds.includes(id);
                return (
                  <label key={u.id} className="bb-multi-select-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleUser(id)}
                    />
                    <span>{u.username}</span>
                  </label>
                );
              })
            )}
          </div>
          <select
            className="bb-select bb-member-role"
            aria-label="项目角色"
            value={role}
            onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "user")}
          >
            <option value="user">用户</option>
            <option value="admin">管理员</option>
          </select>
          <button
            type="button"
            className="bb-btn"
            onClick={addMembers}
            disabled={userIds.length === 0}
          >
            添加{userIds.length > 0 ? `（${userIds.length}）` : ""}
          </button>
        </div>
      </section>

      {error ? <p className="bb-error">{error}</p> : null}

      <section className="bb-members-list-block" aria-labelledby="members-list-heading">
        <div className="bb-members-block-head">
          <h3 id="members-list-heading">当前成员</h3>
          <p className="bb-muted">改角色即时生效；移除后对方将看不到本项目报障。</p>
        </div>
        {members.length === 0 ? (
          <div className="bb-empty">暂无成员。先在上方添加，或到管理后台开户后再回来。</div>
        ) : (
          <div className="bb-table-wrap bb-members-table-wrap">
            <table className="bb-table bb-members-table">
              <colgroup>
                <col className="bb-members-col-user" />
                <col className="bb-members-col-role" />
                <col className="bb-members-col-action" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">用户</th>
                  <th scope="col">项目角色</th>
                  <th scope="col">
                    <span className="bb-sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className={!m.active ? "is-inactive" : undefined}>
                    <td>
                      <div className="bb-members-user">
                        <span className="bb-members-username">{m.username}</span>
                        <span className="bb-muted bb-members-meta">
                          账号：{roleLabel(m.account_role)}
                          {!m.active ? " · 已停用" : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <select
                        className="bb-select bb-member-role"
                        aria-label={`${m.username} 的项目角色`}
                        value={m.role === "admin" ? "admin" : "user"}
                        onChange={(e) => changeRole(m.id, e.target.value)}
                      >
                        <option value="user">用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </td>
                    <td className="bb-members-action">
                      <button
                        type="button"
                        className="bb-btn bb-btn-ghost"
                        aria-label={`移除 ${m.username}`}
                        onClick={() => removeMember(m.id)}
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
