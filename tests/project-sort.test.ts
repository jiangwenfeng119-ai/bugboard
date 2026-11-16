import { describe, expect, it } from "vitest";
import {
  PROJECT_SORT_LABELS,
  resolveProjectSort,
  sortProjects,
} from "../src/lib/project-sort";

const projects = [
  {
    id: 1,
    name: "brandonapp",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-16T02:00:00.000Z",
  },
  {
    id: 2,
    name: "Bugboard",
    created_at: "2026-11-10T00:00:00.000Z",
    updated_at: "2026-11-16T04:00:00.000Z",
  },
  {
    id: 3,
    name: "Enterprise Hub",
    created_at: "2026-11-04T00:00:00.000Z",
    updated_at: "2026-11-15T00:00:00.000Z",
  },
];

describe("resolveProjectSort", () => {
  it("defaults to name", () => {
    expect(resolveProjectSort(undefined)).toBe("name");
    expect(resolveProjectSort(null)).toBe("name");
    expect(resolveProjectSort("")).toBe("name");
    expect(resolveProjectSort("nope")).toBe("name");
  });

  it("accepts known keys", () => {
    expect(resolveProjectSort("name")).toBe("name");
    expect(resolveProjectSort("updated")).toBe("updated");
    expect(resolveProjectSort("count")).toBe("count");
    expect(resolveProjectSort("created")).toBe("created");
  });
});

describe("sortProjects", () => {
  it("sorts by name with zh locale by default", () => {
    const names = sortProjects(projects, "name", {}).map((p) => p.name);
    expect(names).toEqual(["brandonapp", "Bugboard", "Enterprise Hub"]);
  });

  it("sorts by recent update descending", () => {
    const names = sortProjects(projects, "updated", {}).map((p) => p.name);
    expect(names).toEqual(["Bugboard", "brandonapp", "Enterprise Hub"]);
  });

  it("sorts by created time descending", () => {
    const names = sortProjects(projects, "created", {}).map((p) => p.name);
    expect(names).toEqual(["Bugboard", "Enterprise Hub", "brandonapp"]);
  });

  it("sorts by total count descending then name", () => {
    const names = sortProjects(projects, "count", { 1: 9, 2: 4, 3: 4 }).map(
      (p) => p.name
    );
    expect(names).toEqual(["brandonapp", "Bugboard", "Enterprise Hub"]);
  });
});

describe("PROJECT_SORT_LABELS", () => {
  it("covers every sort key", () => {
    expect(Object.keys(PROJECT_SORT_LABELS).sort()).toEqual(
      ["count", "created", "name", "updated"].sort()
    );
  });
});
