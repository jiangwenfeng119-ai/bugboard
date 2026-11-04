"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { roleLabel } from "@/lib/roles";

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
      body: JSON.stringify({ userIds: userIds.map(Number) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "添加失败");
      return;
    }
    setUserIds([]);
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
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <div className="bb-select bb-multi-select" style={{ flex: 1 }}>
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
                <td>{roleLabel(m.role)}</td>
                <td>
                  <button
                    type="button"
                    className="bb-btn bb-btn-ghost"
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
