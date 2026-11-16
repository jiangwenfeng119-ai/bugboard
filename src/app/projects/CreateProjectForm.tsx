"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IconPlus } from "@/components/Icons";
import {
  PROFILE_GROUPS,
  VERIFY_ENV_OPTIONS,
  emptyProfile,
  profileField,
  type ProfileFieldKey,
  type ProjectProfile,
  type VerifyEnv,
} from "@/lib/project-profile";

export function CreateProjectForm() {
  const router = useRouter();
  const titleId = useId();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [profile, setProfile] = useState<ProjectProfile>(emptyProfile);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("bb-modal-open");
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || loading) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("bb-modal-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [open, loading]);

  function reset() {
    setName("");
    setCode("");
    setDescription("");
    setProfile(emptyProfile());
    setError("");
  }

  function close() {
    if (loading) return;
    setOpen(false);
    reset();
  }

  function setField(key: ProfileFieldKey, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        ...(code.trim() ? { code: code.trim() } : {}),
        ...profile,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError((data as { error?: string }).error || "创建失败");
      return;
    }
    const projectId = (data as { project?: { id?: number } }).project?.id;
    setOpen(false);
    reset();
    if (projectId) {
      router.push(`/projects/${projectId}/bugs`);
    }
    router.refresh();
  }

  const dialog =
    open && mounted
      ? createPortal(
          <div className="bb-modal" role="presentation">
            <button
              type="button"
              className="bb-modal-backdrop"
              aria-label="关闭新建项目"
              onClick={close}
            />
            <div
              className="bb-modal-card bb-create-project-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <div className="bb-sheet-head">
                <div>
                  <h2 id={titleId}>新建项目</h2>
                  <p className="bb-muted">
                    先填名称即可创建。其余基础信息均为选填：想填就填，也可以留空，后续由
                    Agent 按代码仓库实际情况补全。
                  </p>
                </div>
                <button
                  type="button"
                  className="bb-btn bb-btn-ghost"
                  onClick={close}
                  disabled={loading}
                >
                  关闭
                </button>
              </div>

              <div className="bb-sheet-body">
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
                          onChange={(e) => setName(e.target.value)}
                          required
                          autoFocus
                        />
                      </div>
                      <div className="bb-field is-wide">
                        <label className="bb-label" htmlFor={`${formId}-code`}>
                          缩写（选填）
                        </label>
                        <input
                          id={`${formId}-code`}
                          className="bb-input"
                          value={code}
                          placeholder="如 SOC，留空自动生成"
                          onChange={(e) => setCode(e.target.value.toUpperCase())}
                          maxLength={8}
                          spellCheck={false}
                        />
                      </div>
                      <div className="bb-field is-wide">
                        <label className="bb-label" htmlFor={`${formId}-desc`}>
                          说明（选填）
                        </label>
                        <input
                          id={`${formId}-desc`}
                          className="bb-input"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                      </div>
                    </div>
                  </section>

                  {PROFILE_GROUPS.map((group) => (
                    <section key={group.title} className="bb-profile-group">
                      <h3>
                        {group.title}
                        <span className="bb-muted"> · 选填</span>
                      </h3>
                      <div className="bb-profile-fields">
                        {group.keys.map((key) => {
                          const field = profileField(key);
                          const inputId = `${formId}-${key}`;
                          const wide = field.wide ? "is-wide" : "";
                          return (
                            <div key={key} className={`bb-field ${wide}`.trim()}>
                              <label className="bb-label" htmlFor={inputId}>
                                {field.label}（选填）
                              </label>
                              {field.kind === "textarea" ? (
                                <textarea
                                  id={inputId}
                                  className="bb-textarea bb-profile-notes-input"
                                  value={profile[key]}
                                  onChange={(e) => setField(key, e.target.value)}
                                  rows={5}
                                  maxLength={field.max}
                                  placeholder="可留空，后续按仓库实际情况填写"
                                />
                              ) : field.kind === "verify" ? (
                                <select
                                  id={inputId}
                                  className="bb-select"
                                  value={profile.verify_env}
                                  onChange={(e) =>
                                    setField("verify_env", e.target.value as VerifyEnv)
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
                                  onChange={(e) => setField(key, e.target.value)}
                                  inputMode={field.kind === "url" ? "url" : "text"}
                                  spellCheck={field.kind !== "url" && key !== "default_branch"}
                                  maxLength={field.max}
                                  placeholder="可留空"
                                />
                              )}
                              {field.hint ? (
                                <p className="bb-muted bb-field-hint">{field.hint}</p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                  {error ? <p className="bb-error">{error}</p> : null}
                </form>
              </div>

              <div className="bb-sheet-foot">
                <button
                  type="button"
                  className="bb-btn bb-btn-ghost"
                  onClick={close}
                  disabled={loading}
                >
                  取消
                </button>
                <button className="bb-btn" type="submit" form={formId} disabled={loading}>
                  {loading ? "创建中…" : "创建"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button type="button" className="bb-btn" onClick={() => setOpen(true)}>
        <IconPlus size={15} />
        新建项目
      </button>
      {dialog}
    </>
  );
}
