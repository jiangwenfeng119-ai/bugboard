import { describe, expect, it } from "vitest";
import {
  STATUS_FILTER_GROUPS,
  STATUS_LABEL,
  type BugStatus,
} from "../src/lib/types";

describe("status filter groups", () => {
  it("splits every status into 进行中 or 终态 without overlap", () => {
    expect(STATUS_FILTER_GROUPS.map((g) => g.label)).toEqual(["进行中", "终态"]);

    const flat = STATUS_FILTER_GROUPS.flatMap((g) => g.statuses);
    const all = Object.keys(STATUS_LABEL) as BugStatus[];

    expect(new Set(flat).size).toBe(flat.length);
    expect(flat.sort()).toEqual([...all].sort());
  });
});
