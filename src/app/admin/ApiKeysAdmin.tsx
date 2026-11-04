"use client";

import {
  Dispatch,
  FormEvent,
  Fragment,
  SetStateAction,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { IconMinus } from "@/components/Icons";

type KeyRow = {
  id: number;
  name: string;
  key_prefix: string;
  role: string;
  revoked_at: string | null;
  disabled_at: string | null;
  last_used_at: string | null;
  created_at: string;
  projectIds: number[];
};

function keyStatus(k: KeyRow): "revoked" | "disabled" | "active" {
  if (k.revoked_at) return "revoked";
  if (k.disabled_at) return "disabled";
  return "active";
}

function statusLabel(status: ReturnType<typeof keyStatus>) {
  if (status === "revoked") return "已吊销";
  if (status === "disabled") return "已禁用";
  return "有效";
}

async function readJsonBody(res: Response) {
  return (await res.json().catch(() => null)) as { error?: string; rawKey?: string } | null;
}

export function ApiKeysAdmin({
  keys,
  projects,
}: {
  keys: KeyRow[];
  projects: { id: number; name: string }[];
}) {
  const router = useRouter();
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  const [name, setName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editProjectIds, setEditProjectIds] = useState<number[]>([]);
  const [editLoading, setEditLoading] = useState(false);

  function boundProjectLabel(k: KeyRow) {
    if (k.role === "admin") return "—";
    if (!k.projectIds.length) return "—";
    return k.projectIds
      .map((id) => projectNameById.get(id) || `#${id}`)
      .join("、");
  }

  function toggleProject(
    id: number,
    setter: Dispatch<SetStateAction<number[]>>
  ) {
    setter((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (role === "user" && projectIds.length === 0) {
      setError("用户级 Key 必须绑定至少一个项目");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, projectIds }),
      });
      const data = await readJsonBody(res);
      if (!res.ok || !data?.rawKey) {
        setError(data?.error || `创建失败（${res.status}）`);
        return;
      }
      setRawKey(data.rawKey);
      setName("");
      setProjectIds([]);
      router.refresh();
    } catch {
      setError("创建失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  const createDisabled =
    loading || (role === "user" && projectIds.length === 0);

  function startEdit(k: KeyRow) {
    setEditingId(k.id);
    setEditName(k.name);
    setEditRole(k.role === "admin" ? "admin" : "user");
    setEditProjectIds([...k.projectIds]);
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function patchKey(id: number, body: Record<string, unknown>) {
    setError("");
    try {
      const res = await fetch(`/api/api-keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonBody(res);
      if (!res.ok || !data) {
        setError(data?.error || `操作失败（${res.status}）`);
        return false;
      }
      if (data.rawKey) setRawKey(data.rawKey);
      router.refresh();
      return true;
    } catch {
      setError("操作失败，请稍后重试");
      return false;
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (editingId == null) return;
    setEditLoading(true);
    const ok = await patchKey(editingId, {
      name: editName,
      role: editRole,
      projectIds: editRole === "user" ? editProjectIds : [],
    });
    setEditLoading(false);
    if (ok) setEditingId(null);
  }

  async function onRegenerate() {
    if (editingId == null) return;
    if (!confirm("重新生成后旧 Key 立即失效，确定继续？")) return;
    setEditLoading(true);
    const ok = await patchKey(editingId, { regenerate: true });
    setEditLoading(false);
    if (ok) setEditingId(null);
  }

  async function onDelete(id: number) {
    if (!confirm("确定删除该 Key？删除后立即失效且不可恢复。")) return;
    setError("");
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      const data = await readJsonBody(res);
      if (!res.ok || !data) {
        setError(data?.error || `删除失败（${res.status}）`);
        return;
      }
      if (editingId === id) setEditingId(null);
      router.refresh();
    } catch {
      setError("删除失败，请稍后重试");
    }
  }

  return (
    <div>
      {rawKey ? (
        <div
          className="bb-card"
          style={{
            padding: "1rem",
            marginBottom: "1rem",
            borderColor: "var(--warning)",
            background: "color-mix(in srgb, var(--warning) 8%, white)",
          }}
        >
          <strong>请立即复制明文 Key（仅显示一次）</strong>
          <pre
            style={{
              margin: "0.6rem 0",
              padding: "0.75rem",
              background: "#fff",
              borderRadius: 8,
              overflow: "auto",
            }}
          >
            {rawKey}
          </pre>
          <button
            type="button"
            className="bb-btn bb-btn-secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(rawKey);
            }}
          >
            复制
          </button>{" "}
          <button
            type="button"
            className="bb-btn bb-btn-ghost"
            onClick={() => setRawKey(null)}
          >
            我已保存，关闭
          </button>
        </div>
      ) : null}

      <form onSubmit={onCreate} style={{ marginBottom: "1rem" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto auto",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <input
            className="bb-input"
            placeholder="Key 名称（如 agent-qa）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select
            className="bb-select"
            style={{ width: "auto" }}
            value={role}
            onChange={(e) => setRole(e.target.value as "user" | "admin")}
          >
            <option value="user">用户级</option>
            <option value="admin">管理员级</option>
          </select>
          <button className="bb-btn" type="submit" disabled={createDisabled}>
            创建
          </button>
        </div>
        {role === "user" ? (
          <div>
            <div className="bb-label">绑定项目（用户级必选）</div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {projects.map((p) => (
                <label key={p.id} style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={projectIds.includes(p.id)}
                    onChange={() => toggleProject(p.id, setProjectIds)}
                    style={{ marginRight: 6 }}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="bb-muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            管理员级 Key 默认可访问全部项目
          </p>
        )}
      </form>
      {error ? <p className="bb-error">{error}</p> : null}

      <div className="bb-table-wrap">
      <table className="bb-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>前缀</th>
            <th>角色</th>
            <th>绑定项目</th>
            <th>最近使用</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const status = keyStatus(k);
            const isEditing = editingId === k.id;
            return (
              <Fragment key={k.id}>
                <tr>
                  <td>{k.name}</td>
                  <td>
                    <code>{k.key_prefix}…</code>
                  </td>
                  <td>{k.role === "admin" ? "管理员级" : "用户级"}</td>
                  <td>{boundProjectLabel(k)}</td>
                  <td className="bb-muted">
                    {k.last_used_at
                      ? new Date(k.last_used_at).toLocaleString("zh-CN")
                      : "—"}
                  </td>
                  <td>{statusLabel(status)}</td>
                  <td>
                    <div className="bb-cell-actions" style={{ justifyContent: "flex-end" }}>
                      {status !== "revoked" ? (
                        <button
                          type="button"
                          className="bb-btn bb-btn-secondary"
                          onClick={() =>
                            isEditing ? cancelEdit() : startEdit(k)
                          }
                        >
                          {isEditing ? "收起" : "编辑"}
                        </button>
                      ) : null}
                      {status === "active" ? (
                        <button
                          type="button"
                          className="bb-btn bb-btn-secondary"
                          onClick={() =>
                            patchKey(k.id, { disabled: true })
                          }
                        >
                          禁用
                        </button>
                      ) : null}
                      {status === "disabled" ? (
                        <button
                          type="button"
                          className="bb-btn bb-btn-secondary"
                          onClick={() =>
                            patchKey(k.id, { disabled: false })
                          }
                        >
                          启用
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="bb-quiet-remove"
                        onClick={() => onDelete(k.id)}
                        aria-label={`删除 Key ${k.name}`}
                        title="删除 Key"
                      >
                        <IconMinus size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
                {isEditing ? (
                  <tr>
                    <td colSpan={7}>
                      <form
                        onSubmit={onSaveEdit}
                        style={{
                          display: "grid",
                          gap: "0.5rem",
                          padding: "0.5rem 0",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: "0.5rem",
                          }}
                        >
                          <input
                            className="bb-input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            required
                          />
                          <select
                            className="bb-select"
                            style={{ width: "auto" }}
                            value={editRole}
                            onChange={(e) =>
                              setEditRole(e.target.value as "user" | "admin")
                            }
                          >
                            <option value="user">用户级</option>
                            <option value="admin">管理员级</option>
                          </select>
                        </div>
                        {editRole === "user" ? (
                          <div>
                            <div className="bb-label">绑定项目（用户级必选）</div>
                            <div
                              style={{
                                display: "flex",
                                gap: "0.75rem",
                                flexWrap: "wrap",
                              }}
                            >
                              {projects.map((p) => (
                                <label key={p.id} style={{ cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={editProjectIds.includes(p.id)}
                                    onChange={() =>
                                      toggleProject(p.id, setEditProjectIds)
                                    }
                                    style={{ marginRight: 6 }}
                                  />
                                  {p.name}
                                </label>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p
                            className="bb-muted"
                            style={{ margin: 0, fontSize: "0.85rem" }}
                          >
                            管理员级 Key 默认可访问全部项目
                          </p>
                        )}
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            className="bb-btn"
                            type="submit"
                            disabled={editLoading}
                          >
                            保存
                          </button>
                          {status === "active" ? (
                            <button
                              type="button"
                              className="bb-btn bb-btn-secondary"
                              disabled={editLoading}
                              onClick={onRegenerate}
                            >
                              重新生成 Key
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="bb-btn bb-btn-ghost"
                            onClick={cancelEdit}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
