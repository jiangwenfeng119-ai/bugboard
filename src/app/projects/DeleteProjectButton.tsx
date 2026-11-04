"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconMinus } from "@/components/Icons";

export function DeleteProjectButton({
  projectId,
  projectName,
  redirectTo,
  compact,
}: {
  projectId: number;
  projectName: string;
  redirectTo?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    if (
      !window.confirm(
        `确定删除项目「${projectName}」？报障、附件和成员关系会一并删除，且不可恢复。`
      )
    ) {
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      window.alert(data.error || "删除失败");
      return;
    }
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  if (compact) {
    return (
      <button
        type="button"
        className="bb-quiet-remove"
        onClick={onDelete}
        disabled={loading}
        aria-label={loading ? "删除中" : `删除项目 ${projectName}`}
        title={loading ? "删除中" : "删除项目"}
      >
        <IconMinus size={11} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="bb-btn bb-btn-danger"
      onClick={onDelete}
      disabled={loading}
    >
      {loading ? "删除中…" : "删除项目"}
    </button>
  );
}
