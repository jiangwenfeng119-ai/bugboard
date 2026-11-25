"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
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
  const [editing, setEditing] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function resetForm() {
    setUsername("");
    setPassword("");
    setRole("user");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
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
    if (editing?.id === u.id) setEditing(null);
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
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
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
          创建
        </button>
      </form>
      {error ? <p className="bb-error">{error}</p> : null}
      <div className="bb-table-wrap">
      <table className="bb-table bb-user-table">
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
                  onClick={() => setEditing(u)}
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
      {editing ? (
        <UserEditDialog
          user={editing}
          canAppointSuperAdmin={canAppointSuperAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function UserEditDialog({
  user,
  canAppointSuperAdmin,
  onClose,
  onSaved,
}: {
  user: User;
  canAppointSuperAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [username, setUsername] = useState(user.username);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin" | "superadmin">(
    user.role === "superadmin" ? "superadmin" : user.role === "admin" ? "admin" : "user"
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.body.classList.add("bb-modal-open");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bb-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, loading, onClose]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const body: { username: string; role: string; password?: string } = { username, role };
    if (password) body.password = password;
    const res = await fetch(`/api/users/${user.id}`, {
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
    onSaved();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="bb-modal" role="presentation">
      <button type="button" className="bb-modal-backdrop" aria-label="关闭编辑" onClick={() => (loading ? undefined : onClose())} />
      <div className="bb-modal-card is-compact" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="bb-sheet-head">
          <h2 id={titleId}>编辑用户</h2>
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onClose} disabled={loading}>
            关闭
          </button>
        </div>
        <form className="bb-sheet-body" onSubmit={onSubmit}>
          <div className="bb-field">
            <label className="bb-label" htmlFor="bb-user-edit-name">
              用户名
            </label>
            <input
              id="bb-user-edit-name"
              className="bb-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="bb-field">
            <label className="bb-label" htmlFor="bb-user-edit-password">
              新密码
            </label>
            <input
              id="bb-user-edit-password"
              className="bb-input"
              type="password"
              placeholder="留空不改"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="bb-field">
            <label className="bb-label" htmlFor="bb-user-edit-role">
              角色
            </label>
            <select
              id="bb-user-edit-role"
              className="bb-select"
              value={role}
              onChange={(e) => setRole(e.target.value as "user" | "admin" | "superadmin")}
            >
              <option value="user">用户</option>
              <option value="admin">管理员</option>
              {canAppointSuperAdmin ? <option value="superadmin">超级管理员</option> : null}
            </select>
          </div>
          {error ? <p className="bb-error">{error}</p> : null}
          <div className="bb-sheet-foot">
            <button className="bb-btn bb-btn-ghost" type="button" onClick={onClose} disabled={loading}>
              取消
            </button>
            <button className="bb-btn" type="submit" disabled={loading}>
              {loading ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
