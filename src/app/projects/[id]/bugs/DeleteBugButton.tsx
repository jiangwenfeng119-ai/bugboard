"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconMinus } from "@/components/Icons";

export function DeleteBugButton({
  bugId,
  title,
}: {
  bugId: number;
  title: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onDelete() {
    if (
      !window.confirm(
        `确定删除报障「${title}」？附件和流转记录会一并删除，且不可恢复。`
      )
    ) {
      return;
    }
    setLoading(true);
    const res = await fetch(`/api/bugs/${bugId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      window.alert(data.error || "删除失败");
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      className="bb-quiet-remove"
      onClick={onDelete}
      disabled={loading}
      aria-label={loading ? "删除中" : `删除报障 ${title}`}
      title={loading ? "删除中" : "删除报障"}
    >
      <IconMinus size={11} />
    </button>
  );
}
