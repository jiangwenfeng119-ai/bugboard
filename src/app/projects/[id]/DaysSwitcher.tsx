"use client";

import { useRouter } from "next/navigation";

export function DaysSwitcher({
  projectId,
  days,
  showAll = false,
}: {
  projectId: number;
  days: number;
  showAll?: boolean;
}) {
  const router = useRouter();
  return (
    <select
      className="bb-select"
      style={{ width: "auto" }}
      value={days}
      aria-label="时间窗"
      onChange={(e) => {
        const query = new URLSearchParams({ days: e.target.value });
        if (showAll) query.set("showAll", "1");
        router.push(`/projects/${projectId}/summary?${query}`);
      }}
    >
      <option value={7}>近 7 天</option>
      <option value={30}>近 30 天</option>
      <option value={90}>近 90 天</option>
    </select>
  );
}
