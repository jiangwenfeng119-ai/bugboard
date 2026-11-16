"use client";

import { useRouter } from "next/navigation";
import {
  PROJECT_SORT_KEYS,
  PROJECT_SORT_LABELS,
  type ProjectSortKey,
} from "@/lib/project-sort";

export function ProjectSortSelect({ sort }: { sort: ProjectSortKey }) {
  const router = useRouter();

  return (
    <label className="bb-project-sort">
      <span className="bb-muted">排序</span>
      <select
        className="bb-select"
        style={{ width: "auto" }}
        value={sort}
        aria-label="项目排序"
        onChange={(e) => {
          const next = e.target.value as ProjectSortKey;
          const sp = new URLSearchParams();
          if (next !== "name") sp.set("sort", next);
          const qs = sp.toString();
          router.push(`/projects${qs ? `?${qs}` : ""}`);
        }}
      >
        {PROJECT_SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {PROJECT_SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
