/** How many project pills show before the +N control in the reporter analytics table. */
export const REPORTER_PROJECT_PILL_LIMIT = 3;

/** Projects to render in the cell: all when expanded, otherwise the first `limit`. */
export function visibleReporterProjects<T>(
  projects: T[],
  expanded: boolean,
  limit = REPORTER_PROJECT_PILL_LIMIT
): T[] {
  if (expanded || projects.length <= limit) return projects;
  return projects.slice(0, limit);
}

/** How many projects are hidden behind +N when collapsed. */
export function reporterProjectOverflow(
  count: number,
  limit = REPORTER_PROJECT_PILL_LIMIT
): number {
  return Math.max(0, count - limit);
}
