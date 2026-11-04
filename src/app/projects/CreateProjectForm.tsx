"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@/components/Icons";

export function CreateProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error || "创建失败");
      return;
    }
    setOpen(false);
    setName("");
    setDescription("");
    router.push(`/projects/${data.project.id}/bugs`);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="bb-btn" onClick={() => setOpen(true)}>
        <IconPlus size={15} />
        新建项目
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="bb-card"
      style={{ padding: "0.9rem", minWidth: 320 }}
    >
      <div className="bb-field">
        <label className="bb-label">项目名称</label>
        <input
          className="bb-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="bb-field">
        <label className="bb-label">说明</label>
        <input
          className="bb-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {error ? <p className="bb-error">{error}</p> : null}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="bb-btn" type="submit" disabled={loading}>
          {loading ? "创建中…" : "创建"}
        </button>
        <button
          type="button"
          className="bb-btn bb-btn-ghost"
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
    </form>
  );
}
