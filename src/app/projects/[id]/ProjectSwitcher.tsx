"use client";

import { useRouter } from "next/navigation";

export function ProjectSwitcher({
  currentId,
  projects,
}: {
  currentId: number;
  projects: { id: number; name: string }[];
}) {
  const router = useRouter();
  return (
    <select
      className="bb-select"
      style={{ maxWidth: 280 }}
      value={currentId}
      aria-label="切换项目"
      onChange={(e) => router.push(`/projects/${e.target.value}/bugs`)}
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
