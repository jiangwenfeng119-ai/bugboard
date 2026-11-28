import { describe, expect, it } from "vitest";
import {
  REPORTER_PROJECT_PILL_LIMIT,
  reporterProjectOverflow,
  visibleReporterProjects,
} from "../src/lib/reporter-project-pills";

describe("reporter project pills", () => {
  const projects = ["a", "b", "c", "d", "e", "f"];

  it("shows only the first three when collapsed", () => {
    expect(visibleReporterProjects(projects, false)).toEqual(["a", "b", "c"]);
    expect(reporterProjectOverflow(projects.length)).toBe(3);
  });

  it("shows every project when expanded", () => {
    expect(visibleReporterProjects(projects, true)).toEqual(projects);
    expect(reporterProjectOverflow(projects.length)).toBe(3);
  });

  it("does not offer overflow when there are at most three", () => {
    expect(visibleReporterProjects(["a", "b"], false)).toEqual(["a", "b"]);
    expect(reporterProjectOverflow(2)).toBe(0);
    expect(reporterProjectOverflow(REPORTER_PROJECT_PILL_LIMIT)).toBe(0);
  });
});
