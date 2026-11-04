"use client";

import { useRouter } from "next/navigation";

export function DaysSwitcher({
  projectId,
  days,
}: {
  projectId: number;
  days: number;
}) {
  const router = useRouter();
  return (
    <select
      className="bb-select"
      style={{ width: "auto" }}
      value={days}
      aria-label="时间窗"
      onChange={(e) =>
        router.push(`/projects/${projectId}/summary?days=${e.target.value}`)
      }
    >
      <option value={7}>近 7 天</option>
      <option value={30}>近 30 天</option>
      <option value={90}>近 90 天</option>
    </select>
  );
}
