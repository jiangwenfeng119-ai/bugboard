"use client";

import {
  Dispatch,
  FormEvent,
  Fragment,
  SetStateAction,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { IconMinus } from "@/components/Icons";
import {
  buildMcpHandoff,
  resolveBugboardBaseUrl,
} from "@/lib/mcp-handoff";

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

type KeyWriteResponse = {
  error?: string;
  rawKey?: string;
  id?: number;
  prefix?: string;
  ok?: boolean;
};

async function readJsonBody(res: Response) {
  return (await res.json().catch(() => null)) as KeyWriteResponse | null;
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

type Reveal = {
  id: number;
  rawKey: string;
  name: string;
  role: "user" | "admin";
  projectIds: number[];
};

export function ApiKeysAdmin({
  keys,
  projects,
  mcpScriptPath,
  configuredBaseUrl,
}: {
  keys: KeyRow[];
  projects: { id: number; name: string }[];
  mcpScriptPath: string | null;
  configuredBaseUrl: string | null;
}) {
  const router = useRouter();
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects]
  );

  const [name, setName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [secrets, setSecrets] = useState<Record<number, string>>({});
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"user" | "admin">("user");
  const [editProjectIds, setEditProjectIds] = useState<number[]>([]);
  const [editLoading, setEditLoading] = useState(false);

  function remember(item: Reveal) {
    setReveal(item);
    setSecrets((prev) => ({ ...prev, [item.id]: item.rawKey }));
  }

  function projectNamesFor(roleName: string, ids: number[]) {
    if (roleName === "admin") return [];
    return ids.map((id) => projectNameById.get(id) || `#${id}`);
  }

  function handoffFor(k: KeyRow, rawKey: string | null) {
    const origin =
      typeof window === "undefined" ? "" : window.location.origin;
    return buildMcpHandoff({
      baseUrl: resolveBugboardBaseUrl(origin, configuredBaseUrl),
      keyId: k.id,
      keyName: k.name,
      role: k.role === "admin" ? "admin" : "user",
      projectNames: projectNamesFor(k.role, k.projectIds),
      keyPrefix: k.key_prefix,
      rawKey,
      mcpScriptPath,
      status: keyStatus(k),
    });
  }

  function markCopied(token: string) {
    setCopiedToken(token);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedToken(null), 2000);
  }

  async function copyHandoff(token: string, text: string) {
    const ok = await writeClipboard(text);
    if (!ok) {
      setError("复制失败，请允许剪贴板权限后重试");
      return;
    }
    setError("");
    markCopied(token);
  }

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
      if (!res.ok || !data?.rawKey || data.id == null) {
        setError(data?.error || `创建失败（${res.status}）`);
        return;
      }
      remember({
        id: data.id,
        rawKey: data.rawKey,
        name: name.trim(),
        role,
        projectIds: role === "user" ? [...projectIds] : [],
      });
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
        return { ok: false as const };
      }
      if (data.rawKey) {
        const row = keys.find((k) => k.id === id);
        if (row) {
          remember({
            id: row.id,
            rawKey: data.rawKey,
            name: row.name,
            role: row.role === "admin" ? "admin" : "user",
            projectIds: [...row.projectIds],
          });
        }
      }
      router.refresh();
      return { ok: true as const, rawKey: data.rawKey };
    } catch {
      setError("操作失败，请稍后重试");
      return { ok: false as const };
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (editingId == null) return;
    setEditLoading(true);
    const result = await patchKey(editingId, {
      name: editName,
      role: editRole,
      projectIds: editRole === "user" ? editProjectIds : [],
    });
    setEditLoading(false);
    if (result.ok) setEditingId(null);
  }

  async function onRegenerate() {
    if (editingId == null) return;
    if (!confirm("重新生成后旧 Key 立即失效，确定继续？")) return;
    setEditLoading(true);
    const result = await patchKey(editingId, { regenerate: true });
    setEditLoading(false);
    if (result.ok) setEditingId(null);
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
      setSecrets((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReveal((current) => (current?.id === id ? null : current));
      router.refresh();
    } catch {
      setError("删除失败，请稍后重试");
    }
  }

  return (
    <div>
      {reveal ? (
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
          <div className="bb-key-reveal-row">
            <pre>{reveal.rawKey}</pre>
            <div className="bb-key-reveal-actions">
              <button
                type="button"
                className="bb-btn"
                onClick={() =>
                  copyHandoff(
                    "reveal",
                    handoffFor(
                      {
                        id: reveal.id,
                        name: reveal.name,
                        key_prefix: reveal.rawKey.slice(0, 10),
                        role: reveal.role,
                        revoked_at: null,
                        disabled_at: null,
                        last_used_at: null,
                        created_at: "",
                        projectIds: reveal.projectIds,
                      },
                      reveal.rawKey
                    )
                  )
                }
              >
                {copiedToken === "reveal" ? "已复制" : "复制给 Agent"}
              </button>
              <button
                type="button"
                className="bb-btn bb-btn-ghost"
                onClick={() => setReveal(null)}
              >
                我已保存，关闭
              </button>
            </div>
          </div>
          <p className="bb-muted" style={{ margin: 0, fontSize: "0.85rem" }}>
            复制内容包含服务地址、Key 和 MCP 配置，可直接粘贴给 Agent。
          </p>
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
                    <div className="bb-key-prefix">
                      <code>{k.key_prefix}…</code>
                      <button
                        type="button"
                        className="bb-btn bb-btn-secondary"
                        title={
                          secrets[k.id]
                            ? "复制服务地址、Key 和 MCP 配置，可直接粘贴给 Agent"
                            : "明文只在创建或重新生成后保留在本页。现在复制的说明不含完整 Key"
                        }
                        onClick={() =>
                          copyHandoff(
                            `row-${k.id}`,
                            handoffFor(k, secrets[k.id] ?? null)
                          )
                        }
                      >
                        {copiedToken === `row-${k.id}`
                          ? secrets[k.id]
                            ? "已复制"
                            : "已复制，不含 Key"
                          : "复制给 Agent"}
                      </button>
                    </div>
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
