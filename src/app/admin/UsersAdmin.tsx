"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { IconMinus } from "@/components/Icons";
import { isSuperAdminRole, roleLabel } from "@/lib/roles";

type User = {
  id: number;
  username: string;
  role: string;
  active: number;
  created_at: string;
};

export function UsersAdmin({
  users,
  currentUserId,
  actorRole,
}: {
  users: User[];
  currentUserId: number;
  actorRole: string;
}) {
  const router = useRouter();
  const canAppointSuperAdmin = isSuperAdminRole(actorRole);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin" | "superadmin">("user");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setUsername("");
    setPassword("");
    setRole("user");
    setEditingId(null);
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setUsername(u.username);
    setPassword("");
    setRole(
      u.role === "superadmin"
        ? "superadmin"
        : u.role === "admin"
          ? "admin"
          : "user"
    );
    setError("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (editingId !== null) {
      const body: { username: string; role: string; password?: string } = {
        username,
        role,
      };
      if (password) body.password = password;

      const res = await fetch(`/api/users/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(data.error || "更新失败");
        return;
      }
      resetForm();
      router.refresh();
      return;
    }

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, role }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "创建失败");
      return;
    }
    resetForm();
    router.refresh();
  }

  async function toggleActive(id: number, active: boolean) {
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "更新失败");
      return;
    }
    router.refresh();
  }

  async function onDelete(u: User) {
    if (!window.confirm(`确定删除用户「${u.username}」？此操作不可恢复。`)) {
      return;
    }
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "删除失败");
      return;
    }
    if (editingId === u.id) resetForm();
    router.refresh();
  }

  return (
    <div>
      <form className="bb-inline-form" onSubmit={onSubmit}>
        <input
          className="bb-input"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          className="bb-input"
          type="password"
          placeholder={editingId !== null ? "新密码（留空不改）" : "密码"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={editingId !== null ? undefined : 6}
          required={editingId === null}
        />
        <select
          className="bb-select"
          style={{ width: "auto" }}
          aria-label="角色"
          value={role}
          onChange={(e) =>
            setRole(e.target.value as "user" | "admin" | "superadmin")
          }
        >
          <option value="user">用户</option>
          <option value="admin">管理员</option>
          {canAppointSuperAdmin ? (
            <option value="superadmin">超级管理员</option>
          ) : null}
        </select>
        <button className="bb-btn" type="submit" disabled={loading}>
          {editingId !== null ? "保存" : "创建"}
        </button>
        {editingId !== null ? (
          <button
            className="bb-btn bb-btn-secondary"
            type="button"
            onClick={resetForm}
            disabled={loading}
          >
            取消
          </button>
        ) : null}
      </form>
      {error ? <p className="bb-error">{error}</p> : null}
      <div className="bb-table-wrap">
      <table className="bb-table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>角色</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const locked =
              u.role === "superadmin" && !canAppointSuperAdmin;
            return (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{roleLabel(u.role)}</td>
              <td>{u.active ? "启用" : "禁用"}</td>
              <td>
                <div className="bb-cell-actions">
                <button
                  type="button"
                  className="bb-btn bb-btn-secondary"
                  onClick={() => startEdit(u)}
                  disabled={locked}
                  aria-label={`编辑 ${u.username}`}
                  title={locked ? "只有超级管理员可以修改超级管理员" : undefined}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="bb-btn bb-btn-secondary"
                  onClick={() => toggleActive(u.id, !u.active)}
                  disabled={locked}
                  aria-label={`${u.active ? "禁用" : "启用"} ${u.username}`}
                  title={locked ? "只有超级管理员可以修改超级管理员" : undefined}
                >
                  {u.active ? "禁用" : "启用"}
                </button>
                <button
                  type="button"
                  className="bb-quiet-remove"
                  onClick={() => onDelete(u)}
                  disabled={locked || u.id === currentUserId}
                  aria-label={
                    locked
                      ? "只有超级管理员可以修改超级管理员"
                      : u.id === currentUserId
                        ? "不能删除当前登录账号"
                        : `删除用户 ${u.username}`
                  }
                  title={
                    locked
                      ? "只有超级管理员可以修改超级管理员"
                      : u.id === currentUserId
                        ? "不能删除当前登录账号"
                        : "删除用户"
                  }
                >
                  <IconMinus size={11} />
                </button>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
