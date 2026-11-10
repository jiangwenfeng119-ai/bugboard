"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = {
  id: number;
  username: string;
  role: string;
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
    <div>
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
          style={{ alignSelf: "flex-start" }}
        >
          添加
        </button>
      </div>
      {error ? <p className="bb-error">{error}</p> : null}
      {members.length === 0 ? (
        <div className="bb-empty">暂无成员</div>
      ) : (
        <div className="bb-table-wrap">
        <table className="bb-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>角色</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.username}</td>
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
                <td>
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
    </div>
  );
}
