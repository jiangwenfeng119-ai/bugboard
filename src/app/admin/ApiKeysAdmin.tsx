"use client";

import {
  Dispatch,
  FormEvent,
  Fragment,
  ReactNode,
  RefObject,
  SetStateAction,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { HoverTip } from "@/components/HoverTip";
import {
  IconBan,
  IconCircleCheck,
  IconCheck,
  IconCopy,
  IconEllipsis,
  IconMinus,
  IconPencil,
  IconX,
} from "@/components/Icons";
import { formatDateTime } from "@/lib/time";
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
  use_count: number;
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

function TipButton({
  label,
  className,
  pressed,
  controls,
  expanded,
  popup,
  buttonRef,
  onClick,
  children,
}: {
  label: string;
  className?: string;
  pressed?: boolean;
  controls?: string;
  expanded?: boolean;
  popup?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  children: ReactNode;
}) {
  const localRef = useRef<HTMLButtonElement>(null);
  const ref = buttonRef ?? localRef;
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean } | null>(
    null
  );

  function show() {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const above = rect.bottom + 36 > window.innerHeight && rect.top > 36;
    const x = Math.min(
      Math.max(48, rect.left + rect.width / 2),
      window.innerWidth - 48
    );
    setTip({ x, y: above ? rect.top - 6 : rect.bottom + 6, above });
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={className}
        aria-label={label}
        aria-pressed={pressed}
        aria-controls={controls}
        aria-expanded={expanded}
        aria-haspopup={popup ? "menu" : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setTip(null)}
        onFocus={show}
        onBlur={() => setTip(null)}
        onClick={() => {
          setTip(null);
          onClick();
        }}
      >
        {children}
      </button>
      {tip
        ? createPortal(
            <span
              className={
                tip.above
                  ? "bb-hover-tip is-above is-center"
                  : "bb-hover-tip is-center"
              }
              style={{ left: tip.x, top: tip.y }}
              role="tooltip"
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </>
  );
}

type RowAction = {
  key: string;
  label: string;
  className?: string;
  pressed?: boolean;
  onClick: () => void;
  icon: ReactNode;
};

function KeyRowActions({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: RowAction[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [box, setBox] = useState<{
    top: number;
    left: number;
    align: "left" | "right";
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    function place() {
      const el = buttonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const menuGuess = 20 + actions.length * 40;
      const alignLeft = rect.left - menuGuess > 8;
      setBox({
        top: rect.top + rect.height / 2,
        left: alignLeft ? rect.left - 6 : rect.right + 6,
        align: alignLeft ? "left" : "right",
      });
    }
    place();
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onOpenChange(false);
      buttonRef.current?.focus();
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, actions.length, onOpenChange]);

  return (
    <div className="bb-key-actions" ref={rootRef}>
      <TipButton
        buttonRef={buttonRef}
        label="操作"
        className="bb-icon-btn"
        pressed={open}
        controls={menuId}
        expanded={open}
        popup
        onClick={() => onOpenChange(!open)}
      >
        <IconEllipsis size={15} />
      </TipButton>
      {open && box
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="bb-key-action-pop"
              role="group"
              aria-label="操作"
              style={{
                top: box.top,
                left: box.left,
                transform:
                  box.align === "left"
                    ? "translate(-100%, -50%)"
                    : "translate(0, -50%)",
              }}
            >
              {actions.map((action) => (
                <TipButton
                  key={action.key}
                  label={action.label}
                  className={action.className ?? "bb-icon-btn"}
                  pressed={action.pressed}
                  onClick={() => {
                    onOpenChange(false);
                    action.onClick();
                  }}
                >
                  {action.icon}
                </TipButton>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
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
  const [copyNote, setCopyNote] = useState("");
  const copiedTimer = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
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

  function markCopied(token: string, note = "") {
    setCopiedToken(token);
    setCopyNote(note);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopiedToken(null);
      setCopyNote("");
    }, 2000);
  }

  async function copyHandoff(token: string, text: string, note = "") {
    const ok = await writeClipboard(text);
    if (!ok) {
      setCopyNote("");
      setError("复制失败，请允许剪贴板权限后重试");
      return;
    }
    setError("");
    markCopied(token, note);
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

  function projectPicker(
    ids: number[],
    setter: Dispatch<SetStateAction<number[]>>
  ) {
    return (
      <div>
        <div className="bb-label">绑定项目（用户级必选）</div>
        <div className="bb-key-checks">
          {projects.map((p) => (
            <label key={p.id} className="bb-key-check">
              <input
                type="checkbox"
                checked={ids.includes(p.id)}
                onChange={() => toggleProject(p.id, setter)}
              />
              {p.name}
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bb-keys">
      {reveal ? (
        <div className="bb-card bb-key-reveal">
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
                        use_count: 0,
                        created_at: "",
                        projectIds: reveal.projectIds,
                      },
                      reveal.rawKey
                    )
                  )
                }
              >
                {copiedToken === "reveal" ? (
                  <IconCheck size={15} />
                ) : (
                  <IconCopy size={15} />
                )}
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
          <p className="bb-key-note">
            复制内容包含服务地址、Key 和 MCP 配置，可直接粘贴给 Agent。
          </p>
        </div>
      ) : null}

      <form className="bb-key-create" onSubmit={onCreate}>
        <div className="bb-key-create-row">
          <input
            className="bb-input"
            placeholder="Key 名称（如 agent-qa）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            aria-label="Key 名称"
          />
          <select
            className="bb-select"
            value={role}
            onChange={(e) => setRole(e.target.value as "user" | "admin")}
            aria-label="Key 角色"
          >
            <option value="user">用户级</option>
            <option value="admin">管理员级</option>
          </select>
          <button className="bb-btn" type="submit" disabled={createDisabled}>
            创建
          </button>
        </div>
        {role === "user" ? (
          projectPicker(projectIds, setProjectIds)
        ) : (
          <p className="bb-key-note">管理员级 Key 默认可访问全部项目</p>
        )}
      </form>
      {error ? <p className="bb-error">{error}</p> : null}
      {copyNote ? (
        <p className="bb-key-note" role="status">
          {copyNote}
        </p>
      ) : null}

      <div className="bb-table-wrap">
        <table className="bb-table bb-key-table">
          <thead>
            <tr>
              <th className="bb-col-key-name" scope="col">
                名称
              </th>
              <th className="bb-col-key-prefix" scope="col">
                前缀
              </th>
              <th className="bb-col-key-role" scope="col">
                角色
              </th>
              <th className="bb-col-key-projects" scope="col">
                绑定项目
              </th>
              <th className="bb-col-key-used" scope="col">
                最近使用
              </th>
              <th className="bb-col-key-calls" scope="col">
                调用次数
              </th>
              <th className="bb-col-key-status" scope="col">
                状态
              </th>
              <th className="bb-col-key-actions is-end" scope="col">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const status = keyStatus(k);
              const isEditing = editingId === k.id;
              const copied = copiedToken === `row-${k.id}`;
              const hasSecret = Boolean(secrets[k.id]);
              const projectsLabel = boundProjectLabel(k);
              const copyLabel = copied
                ? hasSecret
                  ? "已复制给 Agent"
                  : "已复制，不含完整 Key"
                : hasSecret
                  ? "复制给 Agent"
                  : "复制给 Agent（不含完整 Key）";
              return (
                <Fragment key={k.id}>
                  <tr>
                    <td className="bb-key-name">
                      <HoverTip text={k.name}>{k.name}</HoverTip>
                    </td>
                    <td>
                      <div className="bb-key-prefix">
                        <code className="bb-key-code">{k.key_prefix}…</code>
                        <TipButton
                          label={copyLabel}
                          className={
                            copied
                              ? hasSecret
                                ? "bb-icon-btn is-copied"
                                : "bb-icon-btn is-partial"
                              : "bb-icon-btn"
                          }
                          onClick={() =>
                            copyHandoff(
                              `row-${k.id}`,
                              handoffFor(k, secrets[k.id] ?? null),
                              hasSecret
                                ? ""
                                : "已复制。这次不含完整 Key，明文只在创建或重新生成后保留在本页。"
                            )
                          }
                        >
                          {copied ? (
                            <IconCheck size={15} />
                          ) : (
                            <IconCopy size={15} />
                          )}
                        </TipButton>
                      </div>
                    </td>
                    <td className="bb-key-token">
                      {k.role === "admin" ? "管理员级" : "用户级"}
                    </td>
                    <td className="bb-key-projects">
                      <HoverTip text={projectsLabel}>{projectsLabel}</HoverTip>
                    </td>
                    <td className="bb-key-time">
                      {k.last_used_at ? formatDateTime(k.last_used_at) : "—"}
                    </td>
                    <td className="bb-key-calls">
                      {(k.use_count ?? 0).toLocaleString("zh-CN")}
                    </td>
                    <td className="bb-key-token">{statusLabel(status)}</td>
                    <td className="bb-key-actions-cell">
                      <KeyRowActions
                        open={openMenuId === k.id}
                        onOpenChange={(next) =>
                          setOpenMenuId(next ? k.id : null)
                        }
                        actions={[
                          ...(status !== "revoked"
                            ? [
                                {
                                  key: "edit",
                                  label: isEditing ? "收起编辑" : "编辑",
                                  pressed: isEditing,
                                  className: "bb-icon-btn",
                                  onClick: () =>
                                    isEditing ? cancelEdit() : startEdit(k),
                                  icon: isEditing ? (
                                    <IconX size={15} />
                                  ) : (
                                    <IconPencil size={15} />
                                  ),
                                },
                              ]
                            : []),
                          ...(status === "active"
                            ? [
                                {
                                  key: "disable",
                                  label: "禁用",
                                  className: "bb-icon-btn is-warn",
                                  onClick: () =>
                                    patchKey(k.id, { disabled: true }),
                                  icon: <IconBan size={15} />,
                                },
                              ]
                            : []),
                          ...(status === "disabled"
                            ? [
                                {
                                  key: "enable",
                                  label: "启用",
                                  className: "bb-icon-btn is-ok",
                                  onClick: () =>
                                    patchKey(k.id, { disabled: false }),
                                  icon: <IconCircleCheck size={15} />,
                                },
                              ]
                            : []),
                          {
                            key: "delete",
                            label: "删除",
                            className: "bb-icon-btn is-danger",
                            onClick: () => onDelete(k.id),
                            icon: <IconMinus size={15} />,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                  {isEditing ? (
                    <tr className="bb-key-edit-row">
                      <td colSpan={8}>
                        <form className="bb-key-edit" onSubmit={onSaveEdit}>
                          <div className="bb-key-edit-fields">
                            <input
                              className="bb-input"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              required
                              aria-label="Key 名称"
                            />
                            <select
                              className="bb-select"
                              value={editRole}
                              onChange={(e) =>
                                setEditRole(e.target.value as "user" | "admin")
                              }
                              aria-label="Key 角色"
                            >
                              <option value="user">用户级</option>
                              <option value="admin">管理员级</option>
                            </select>
                          </div>
                          {editRole === "user" ? (
                            projectPicker(editProjectIds, setEditProjectIds)
                          ) : (
                            <p className="bb-key-note">
                              管理员级 Key 默认可访问全部项目
                            </p>
                          )}
                          <div className="bb-key-edit-actions">
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
