export const PROJECT_SORT_KEYS = ["name", "updated", "count", "created"] as const;

export type ProjectSortKey = (typeof PROJECT_SORT_KEYS)[number];

export const PROJECT_SORT_LABELS: Record<ProjectSortKey, string> = {
  name: "按名称",
  updated: "按最近更新",
  count: "按报障数量",
  created: "按创建时间",
};

export function resolveProjectSort(raw?: string | null): ProjectSortKey {
  if ((PROJECT_SORT_KEYS as readonly string[]).includes(raw || "")) {
    return raw as ProjectSortKey;
  }
  return "name";
}

type SortableProject = {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
};

export function sortProjects<T extends SortableProject>(
  projects: T[],
  sort: ProjectSortKey,
  counts: Record<number, number> = {}
): T[] {
  const list = [...projects];
  list.sort((a, b) => {
    if (sort === "updated") {
      const byUpdated = b.updated_at.localeCompare(a.updated_at);
      return byUpdated || a.id - b.id;
    }
    if (sort === "created") {
      const byCreated = b.created_at.localeCompare(a.created_at);
      return byCreated || a.id - b.id;
    }
    if (sort === "count") {
      const byCount = (counts[b.id] ?? 0) - (counts[a.id] ?? 0);
      if (byCount) return byCount;
      const byName = a.name.localeCompare(b.name, "zh-CN");
      return byName || a.id - b.id;
    }
    const byName = a.name.localeCompare(b.name, "zh-CN");
    return byName || a.id - b.id;
  });
  return list;
}
