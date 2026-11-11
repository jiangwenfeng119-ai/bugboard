"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconPencil } from "@/components/Icons";
import type { ProjectDocument, ProjectDocumentKind } from "@/lib/project-documents";
import { logoFileError, projectLogoSrc } from "@/lib/project-logo-shared";
import {
  PROFILE_GROUPS,
  VERIFY_ENV_OPTIONS,
  profileField,
  profileFromRow,
  profileHref,
  verifyEnvLabel,
  type ProfileFieldKey,
  type ProjectProfile,
  type VerifyEnv,
} from "@/lib/project-profile";

export type ProjectDraft = {
  name: string;
  code: string;
  description: string;
  profile: ProjectProfile;
};

type SavedProject = ProjectDraft & {
  id: number;
  documents: ProjectDocument[];
  hasLogo: boolean;
  updatedAt: string;
};

const emptyPending = (): Record<ProjectDocumentKind, File[]> => ({
  design: [],
  docs: [],
});

export function ProjectProfileDialog({
  open,
  projectId,
  isAdmin,
  draft,
  hasLogo,
  updatedAt,
  documents,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: number;
  isAdmin: boolean;
  draft: ProjectDraft;
  hasLogo: boolean;
  updatedAt: string;
  documents: ProjectDocument[];
  onClose: () => void;
  onSaved: (project: SavedProject) => void;
}) {
  const titleId = useId();
  const formId = useId();
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [name, setName] = useState(draft.name);
  const [code, setCode] = useState(draft.code);
  const [description, setDescription] = useState(draft.description);
  const [profile, setProfile] = useState<ProjectProfile>(draft.profile);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(emptyPending);
  const [removed, setRemoved] = useState<number[]>([]);
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setMode("view");
    setError("");
    setName(draft.name);
    setCode(draft.code);
    setDescription(draft.description);
    setProfile(draft.profile);
    setPending(emptyPending());
    setRemoved([]);
    setPendingLogo(null);
    setLogoRemoved(false);
    // 只在打开或切换项目时回到只读，避免编辑过程中被父组件重绘清掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("bb-modal-open");
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || loading) return;
      if (mode === "edit") {
        setMode("view");
        setError("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bb-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, mode, loading, onClose]);

  useEffect(() => {
    if (!pendingLogo) {
      setLogoPreview("");
      return;
    }
    const url = URL.createObjectURL(pendingLogo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingLogo]);

  function startEdit() {
    setName(draft.name);
    setCode(draft.code);
    setDescription(draft.description);
    setProfile(draft.profile);
    setPending(emptyPending());
    setRemoved([]);
    setPendingLogo(null);
    setLogoRemoved(false);
    setError("");
    setMode("edit");
  }

  function savedLogoSrc() {
    return hasLogo && !logoRemoved ? projectLogoSrc(projectId, updatedAt) : "";
  }

  function visibleDocuments(kind: ProjectDocumentKind) {
    return documents.filter((doc) => doc.kind === kind && !removed.includes(doc.id));
  }

  function setField(key: ProfileFieldKey, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (pendingLogo) {
        const bytes = new Uint8Array(await pendingLogo.arrayBuffer());
        const logoError = logoFileError(pendingLogo.name, bytes);
        if (logoError) {
          setError(logoError);
          return;
        }
      }
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, description, ...profile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error || "保存失败");
        return;
      }
      const project = (
        data as {
          project?: {
            id: number;
            name: string;
            code: string;
            description: string;
            updated_at?: string;
            has_logo?: boolean;
          } & ProjectProfile;
        }
      ).project;
      if (!project) {
        setError("保存失败");
        return;
      }
      const publish = (
        documentsNext: ProjectDocument[],
        logoState?: { hasLogo: boolean; updatedAt: string }
      ) => {
        onSaved({
          id: project.id,
          name: project.name,
          code: project.code,
          description: project.description,
          profile: profileFromRow(project),
          documents: documentsNext,
          hasLogo: logoState?.hasLogo ?? project.has_logo ?? hasLogo,
          updatedAt: logoState?.updatedAt ?? project.updated_at ?? updatedAt,
        });
      };
      let nextDocuments = documents.filter((doc) => !removed.includes(doc.id));
      for (const id of removed) {
        const deleted = await fetch(`/api/projects/${projectId}/documents/${id}`, {
          method: "DELETE",
        });
        const deletedData = await deleted.json().catch(() => ({}));
        if (!deleted.ok) {
          setError((deletedData as { error?: string }).error || "删除文档失败");
          publish(nextDocuments);
          return;
        }
        nextDocuments = (deletedData as { documents?: ProjectDocument[] }).documents || nextDocuments;
      }
      for (const kind of ["design", "docs"] as const) {
        if (pending[kind].length === 0) continue;
        const form = new FormData();
        form.set("kind", kind);
        for (const file of pending[kind]) form.append("files", file, file.name);
        const uploaded = await fetch(`/api/projects/${projectId}/documents`, {
          method: "POST",
          body: form,
        });
        const uploadedData = await uploaded.json().catch(() => ({}));
        if (!uploaded.ok) {
          setError((uploadedData as { error?: string }).error || "上传文档失败");
          publish(nextDocuments);
          return;
        }
        nextDocuments = (uploadedData as { documents?: ProjectDocument[] }).documents || nextDocuments;
      }
      let nextHasLogo = project.has_logo ?? hasLogo;
      let nextUpdatedAt = project.updated_at ?? updatedAt;
      if (pendingLogo) {
        const form = new FormData();
        form.set("file", pendingLogo, pendingLogo.name);
        const uploaded = await fetch(`/api/projects/${projectId}/logo`, {
          method: "POST",
          body: form,
        });
        const uploadedData = (await uploaded.json().catch(() => ({}))) as {
          error?: string;
          has_logo?: boolean;
          updated_at?: string;
        };
        if (!uploaded.ok) {
          setError(uploadedData.error || "上传 Logo 失败");
          publish(nextDocuments, { hasLogo: nextHasLogo, updatedAt: nextUpdatedAt });
          return;
        }
        nextHasLogo = Boolean(uploadedData.has_logo);
        nextUpdatedAt = uploadedData.updated_at || nextUpdatedAt;
      } else if (logoRemoved && hasLogo) {
        const removedLogo = await fetch(`/api/projects/${projectId}/logo`, {
          method: "DELETE",
        });
        const removedData = (await removedLogo.json().catch(() => ({}))) as {
          error?: string;
          has_logo?: boolean;
          updated_at?: string;
        };
        if (!removedLogo.ok) {
          setError(removedData.error || "移除 Logo 失败");
          publish(nextDocuments, { hasLogo: nextHasLogo, updatedAt: nextUpdatedAt });
          return;
        }
        nextHasLogo = Boolean(removedData.has_logo);
        nextUpdatedAt = removedData.updated_at || nextUpdatedAt;
      }
      publish(nextDocuments, { hasLogo: nextHasLogo, updatedAt: nextUpdatedAt });
      setPending(emptyPending());
      setRemoved([]);
      setPendingLogo(null);
      setLogoRemoved(false);
      setMode("view");
    } catch {
      setError("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (!open || !mounted) return null;

  const codePreview = code.trim().toUpperCase() || "SOC";

  return createPortal(
    <div className="bb-modal" role="presentation">
      <button
        type="button"
        className="bb-modal-backdrop"
        aria-label="关闭项目资料"
        onClick={() => {
          if (loading || mode === "edit") return;
          onClose();
        }}
      />
      <div
        className="bb-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="bb-sheet-head">
          <div>
            <h2 id={titleId}>{mode === "edit" ? "编辑项目资料" : "项目资料"}</h2>
            <p className="bb-muted">
              {draft.name}
              {draft.code ? ` · ${draft.code}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="bb-btn bb-btn-ghost"
            onClick={onClose}
            disabled={loading}
          >
            关闭
          </button>
        </div>

        <div className="bb-sheet-body">
          {mode === "view" ? (
            <ProfileView
              projectId={projectId}
              name={draft.name}
              code={draft.code}
              description={draft.description}
              logoSrc={hasLogo ? projectLogoSrc(projectId, updatedAt) : ""}
              profile={draft.profile}
              documents={documents}
            />
          ) : (
            <form id={formId} onSubmit={onSubmit}>
              <section className="bb-profile-group">
                <h3>基本信息</h3>
                <div className="bb-profile-fields">
                  <div className="bb-field">
                    <label className="bb-label" htmlFor={`${formId}-name`}>
                      项目名称
                    </label>
                    <input
                      id={`${formId}-name`}
                      className="bb-input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="bb-field is-wide">
                    <label className="bb-label" htmlFor={`${formId}-code`}>
                      缩写
                    </label>
                    <input
                      id={`${formId}-code`}
                      className="bb-input"
                      value={code}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      required
                      minLength={2}
                      maxLength={8}
                      pattern="[A-Za-z][A-Za-z0-9]{1,7}"
                      spellCheck={false}
                    />
                    <p className="bb-muted bb-field-hint">
                      {`报障 ID 为缩写 + 年月日 + 序号，例如 ${codePreview}261106001。已有 ID 不会改。`}
                    </p>
                  </div>
                  <div className="bb-field is-wide">
                    <label className="bb-label" htmlFor={`${formId}-description`}>
                      说明
                    </label>
                    <input
                      id={`${formId}-description`}
                      className="bb-input"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </div>
                  <LogoField
                    previewSrc={logoPreview || savedLogoSrc()}
                    onPick={(file) => {
                      setPendingLogo(file);
                      setLogoRemoved(false);
                    }}
                    onRemove={() => {
                      setPendingLogo(null);
                      setLogoRemoved(true);
                    }}
                  />
                </div>
              </section>

              {PROFILE_GROUPS.map((group) => (
                <section key={group.title} className="bb-profile-group">
                  <h3>{group.title}</h3>
                  <div className="bb-profile-fields">
                    {group.keys.map((key) => {
                      const field = profileField(key);
                      const inputId = `${formId}-${key}`;
                      const wide = field.wide ? "is-wide" : "";
                      return (
                        <div key={key} className={`bb-field ${wide}`.trim()}>
                          <label className="bb-label" htmlFor={inputId}>
                            {field.label}
                          </label>
                          {field.kind === "textarea" ? (
                            <textarea
                              id={inputId}
                              className="bb-textarea bb-profile-notes-input"
                              value={profile[key]}
                              onChange={(event) => setField(key, event.target.value)}
                              rows={5}
                              maxLength={field.max}
                            />
                          ) : field.kind === "verify" ? (
                            <select
                              id={inputId}
                              className="bb-select"
                              value={profile.verify_env}
                              onChange={(event) =>
                                setField("verify_env", event.target.value as VerifyEnv)
                              }
                            >
                              {VERIFY_ENV_OPTIONS.map((option) => (
                                <option key={option.value || "unset"} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={inputId}
                              className="bb-input"
                              value={profile[key]}
                              onChange={(event) => setField(key, event.target.value)}
                              inputMode={field.kind === "url" ? "url" : "text"}
                              spellCheck={field.kind !== "url" && key !== "default_branch"}
                              maxLength={field.max}
                            />
                          )}
                          {field.hint ? <p className="bb-muted bb-field-hint">{field.hint}</p> : null}
                          {key === "design_url" || key === "docs_url" ? (
                            <DocumentFiles
                              projectId={projectId}
                              kind={key === "design_url" ? "design" : "docs"}
                              saved={visibleDocuments(key === "design_url" ? "design" : "docs")}
                              pending={pending[key === "design_url" ? "design" : "docs"]}
                              editing
                              onAdd={(files) => {
                                const kind = key === "design_url" ? "design" : "docs";
                                setPending((current) => ({
                                  ...current,
                                  [kind]: [...current[kind], ...files],
                                }));
                              }}
                              onDropPending={(index) => {
                                const kind = key === "design_url" ? "design" : "docs";
                                setPending((current) => ({
                                  ...current,
                                  [kind]: current[kind].filter((_, i) => i !== index),
                                }));
                              }}
                              onRemoveSaved={(id) =>
                                setRemoved((current) =>
                                  current.includes(id) ? current : [...current, id]
                                )
                              }
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              {error ? <p className="bb-error">{error}</p> : null}
            </form>
          )}
        </div>

        {mode === "edit" || isAdmin ? (
          <div className="bb-sheet-foot">
            {mode === "edit" ? (
              <>
                <button
                  type="button"
                  className="bb-btn bb-btn-ghost"
                onClick={() => {
                  setPending(emptyPending());
                  setRemoved([]);
                  setPendingLogo(null);
                  setLogoRemoved(false);
                  setMode("view");
                  setError("");
                }}
                  disabled={loading}
                >
                  取消
                </button>
                <button className="bb-btn" type="submit" form={formId} disabled={loading}>
                  {loading ? "保存中…" : "保存"}
                </button>
              </>
            ) : (
              <button type="button" className="bb-btn" onClick={startEdit}>
                <IconPencil size={15} />
                编辑
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

function LogoField({
  previewSrc,
  onPick,
  onRemove,
}: {
  previewSrc: string;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="bb-field is-wide">
      <label className="bb-label" htmlFor={inputId}>
        Logo
      </label>
      {previewSrc ? (
        // 本地预览或已保存的项目图。
        // eslint-disable-next-line @next/next/no-img-element
        <img className="bb-logo-preview" src={previewSrc} alt="" />
      ) : (
        <p className="bb-muted" style={{ margin: 0 }}>
          未上传
        </p>
      )}
      <div className="bb-logo-actions">
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          hidden
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(file);
            event.target.value = "";
          }}
        />
        <button type="button" className="bb-btn bb-btn-secondary" onClick={() => inputRef.current?.click()}>
          选择图片
        </button>
        {previewSrc ? (
          <button type="button" className="bb-btn bb-btn-ghost" onClick={onRemove}>
            移除
          </button>
        ) : null}
      </div>
      <p className="bb-muted bb-field-hint">png、jpg 或 webp，不超过 2MB。显示在项目列表和项目标题上。</p>
    </div>
  );
}

function ProfileView({
  projectId,
  name,
  code,
  description,
  logoSrc,
  profile,
  documents,
}: {
  projectId: number;
  name: string;
  code: string;
  description: string;
  logoSrc: string;
  profile: ProjectProfile;
  documents: ProjectDocument[];
}) {
  return (
    <div>
      <section className="bb-profile-group">
        <h3>基本信息</h3>
        <dl className="bb-profile-grid">
          <ProfileRow label="项目名称" value={name} />
          <ProfileRow label="缩写" value={code} />
          <ProfileRow label="说明" value={description} />
          <dt>Logo</dt>
          <dd>
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bb-logo-preview" src={logoSrc} alt="" />
            ) : (
              <span className="bb-muted">未上传</span>
            )}
          </dd>
        </dl>
      </section>
      {PROFILE_GROUPS.map((group) => (
        <section key={group.title} className="bb-profile-group">
          <h3>{group.title}</h3>
          {group.keys.length === 1 && group.keys[0] === "agent_notes" ? (
            profile.agent_notes ? (
              <p className="bb-profile-notes">{profile.agent_notes}</p>
            ) : (
              <p className="bb-muted bb-profile-notes">未填写</p>
            )
          ) : (
            <dl className="bb-profile-grid">
              {group.keys.map((key) =>
                key === "design_url" || key === "docs_url" ? (
                  <DocumentRow
                    key={key}
                    projectId={projectId}
                    label={profileField(key).label}
                    value={profile[key]}
                    documents={documents.filter(
                      (doc) => doc.kind === (key === "design_url" ? "design" : "docs")
                    )}
                  />
                ) : (
                  <ProfileRow
                    key={key}
                    label={profileField(key).label}
                    value={key === "verify_env" ? verifyEnvLabel(profile.verify_env) : profile[key]}
                    empty={key === "verify_env" ? profile.verify_env === "" : !profile[key]}
                    href={profileField(key).kind === "url" ? profileHref(profile[key]) : null}
                  />
                )
              )}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}

function DocumentRow({
  projectId,
  label,
  value,
  documents,
}: {
  projectId: number;
  label: string;
  value: string;
  documents: ProjectDocument[];
}) {
  const href = profileHref(value);
  const empty = !value && documents.length === 0;
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {empty ? (
          <span className="bb-muted">未填写</span>
        ) : (
          <>
            {value ? (
              href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {value}
                </a>
              ) : (
                <span>{value}</span>
              )
            ) : null}
            <DocumentFiles
              projectId={projectId}
              kind={label === "设计稿" ? "design" : "docs"}
              saved={documents}
              pending={[]}
              editing={false}
              onAdd={() => undefined}
              onDropPending={() => undefined}
              onRemoveSaved={() => undefined}
            />
          </>
        )}
      </dd>
    </>
  );
}

function DocumentFiles({
  projectId,
  saved,
  pending,
  editing,
  onAdd,
  onDropPending,
  onRemoveSaved,
}: {
  projectId: number;
  kind: ProjectDocumentKind;
  saved: ProjectDocument[];
  pending: File[];
  editing: boolean;
  onAdd: (files: File[]) => void;
  onDropPending: (index: number) => void;
  onRemoveSaved: (id: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!editing && saved.length === 0) return null;
  return (
    <div className="bb-doc-files">
      {saved.length > 0 || pending.length > 0 ? (
        <ul className="bb-doc-list">
          {saved.map((doc) => (
            <li key={doc.id}>
              <a
                href={`/api/projects/${projectId}/documents/${doc.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {doc.filename}
              </a>
              <span className="bb-muted">{formatSize(doc.size)}</span>
              {editing ? (
                <button type="button" className="bb-btn bb-btn-ghost" onClick={() => onRemoveSaved(doc.id)}>
                  移除
                </button>
              ) : null}
            </li>
          ))}
          {pending.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span>{file.name}</span>
              <span className="bb-muted">待保存</span>
              <button type="button" className="bb-btn bb-btn-ghost" onClick={() => onDropPending(index)}>
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt,.md,.zip,.mp4,.webm,.mov,.mp3,.wav,.ogg,.m4a"
            onChange={(event) => {
              const picked = event.target.files ? Array.from(event.target.files) : [];
              if (picked.length > 0) onAdd(picked);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="bb-btn bb-btn-secondary"
            onClick={() => inputRef.current?.click()}
          >
            上传附件
          </button>
        </>
      ) : null}
    </div>
  );
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function ProfileRow({
  label,
  value,
  href = null,
  empty = !value,
}: {
  label: string;
  value: string;
  href?: string | null;
  empty?: boolean;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {empty ? (
          <span className="bb-muted">未填写</span>
        ) : href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </>
  );
}
