"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconPencil } from "@/components/Icons";
import { DeleteProjectButton } from "../DeleteProjectButton";

export function ProjectHeader({
  projectId,
  name,
  description,
  isAdmin,
  canDelete,
}: {
  projectId: number;
  name: string;
  description: string;
  isAdmin: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [shownName, setShownName] = useState(name);
  const [shownDescription, setShownDescription] = useState(description);
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setShownName(name);
    setShownDescription(description);
    setEditing(false);
  }, [projectId, name, description]);

  function startEdit() {
    setDraftName(shownName);
    setDraftDescription(shownDescription);
    setError("");
    setEditing(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draftName,
        description: draftDescription,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "保存失败");
      return;
    }
    setShownName(data.project.name);
    setShownDescription(data.project.description);
    setEditing(false);
    router.refresh();
  }

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <Link href="/projects" className="bb-muted" style={{ fontSize: "0.9rem" }}>
        ← 全部项目
      </Link>
      {editing ? (
        <form onSubmit={onSubmit} className="bb-card bb-project-edit">
          <div className="bb-field">
            <label className="bb-label" htmlFor="project-name">
              项目名称
            </label>
            <input
              id="project-name"
              className="bb-input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              required
            />
          </div>
          <div className="bb-field">
            <label className="bb-label" htmlFor="project-description">
              说明
            </label>
            <input
              id="project-description"
              className="bb-input"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
            />
          </div>
          {error ? <p className="bb-error">{error}</p> : null}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button className="bb-btn" type="submit" disabled={loading}>
              {loading ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className="bb-btn bb-btn-ghost"
              onClick={() => setEditing(false)}
              disabled={loading}
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="bb-project-heading">
            <h1>{shownName}</h1>
            {isAdmin ? (
              <button type="button" className="bb-btn bb-btn-ghost" onClick={startEdit}>
                <IconPencil size={15} />
                编辑
              </button>
            ) : null}
            {canDelete ? (
              <DeleteProjectButton
                projectId={projectId}
                projectName={shownName}
                redirectTo="/projects"
                compact
              />
            ) : null}
          </div>
          {shownDescription ? (
            <p className="bb-muted" style={{ margin: 0 }}>
              {shownDescription}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
